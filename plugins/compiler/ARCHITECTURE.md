# Glimmer-Next Compiler Architecture

This document explains the **why** behind the compiler's design decisions. For API reference and usage, see [SPEC_V2.md](./SPEC_V2.md).

## Table of Contents

1. [Core Design Principles](#1-core-design-principles)
2. [Reactive Model: Why Getters Everywhere](#2-reactive-model-why-getters-everywhere)
3. [Single-Pass Compilation: Why Not Multi-Pass](#3-single-pass-compilation-why-not-multi-pass)
4. [The isConst Optimization](#4-the-isconst-optimization)
5. [Circular Dependency Resolution](#5-circular-dependency-resolution)
6. [Source Mapping Strategy](#6-source-mapping-strategy)
7. [Memory and Performance Characteristics](#7-memory-and-performance-characteristics)
8. [Trade-offs and Constraints](#8-trade-offs-and-constraints)

---

## 1. Core Design Principles

### 1.1 Dependency Injection Over Global State

Every compiler function receives `CompilerContext` as its first parameter. This eliminates global state and enables:

- **Testability**: Each compilation is isolated
- **Parallelization**: Multiple compilations can run concurrently
- **Debugging**: State is inspectable at any point

```typescript
// ❌ Old pattern (V1)
let globalBindings = new Set();
function compile(template) { /* uses globalBindings */ }

// ✅ New pattern (V2)
function compile(template, options): CompileResult {
  const ctx = createContext(template, options);
  // All state flows through ctx
}
```

### 1.2 Explicit Types Over Magic Strings

V1 used `$:` prefix for dynamic values:
```typescript
// V1: Magic string prefix
"$:this.foo"  // Is this a path? A raw expression? Who knows!
```

V2 uses discriminated unions:
```typescript
// V2: Explicit types
{ kind: 'path', expression: 'this.foo', isArg: false }
{ kind: 'raw', code: '() => this.foo' }
{ kind: 'helper', name: 'if', positional: [...] }
```

Benefits:
- **Type safety**: TypeScript catches errors at compile time
- **Tooling**: IDE autocomplete, refactoring support
- **Clarity**: No need to parse strings to understand intent

### 1.3 Builder Pattern Over String Concatenation

```typescript
// ❌ String concatenation (error-prone)
const code = `$_tag('${tag}', ${props}, [${children.join(',')}])`;

// ✅ Builder pattern (composable, type-safe)
const code = B.call('$_tag', [
  B.string(tag),
  props,
  B.array(children)
]);
```

The builder pattern enables:
- **Source mapping**: Each node carries its source range
- **Transformation**: AST can be modified before serialization
- **Validation**: Structure is guaranteed correct

---

## 2. Reactive Model: Why Getters Everywhere

### 2.1 The Fundamental Question

> "Why does every path expression become `() => this.x` instead of just `this.x`?"

This is the most common question about the architecture. The answer lies in **automatic dependency tracking**.

### 2.2 How Reactive Tracking Works

The runtime uses a pull-based reactive model with automatic dependency discovery:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRACKING MECHANISM                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  // Global tracking context                                     │
│  let currentTracker: Set<Cell> | null = null;                   │
│                                                                 │
│  // When formula evaluates:                                     │
│  formula.value → {                                              │
│    currentTracker = new Set();     // 1. Start tracking         │
│    result = this.fn();             // 2. Execute getter         │
│    // During execution, any Cell access does:                   │
│    //   currentTracker.add(this)   // 3. Self-register          │
│    this.deps = currentTracker;     // 4. Save dependencies      │
│    currentTracker = null;          // 5. Stop tracking          │
│    return result;                                               │
│  }                                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 Why Getters Are Required

**Without getter:**
```javascript
// Template: {{this.count}}
// If compiled to direct access:
$_tag('span', [], [this.count], this)
//                  ^^^^^^^^^^
// Problem: this.count is evaluated IMMEDIATELY when $_tag is called
// The tracking context hasn't been set up yet!
// Result: No dependency tracked, no reactivity
```

**With getter:**
```javascript
// Compiled with getter:
$_tag('span', [], [() => this.count], this)
//                 ^^^^^^^^^^^^^^^^^
// The function is stored, not evaluated
// Later, when rendering:
//   1. Runtime sets up tracking context
//   2. Calls the getter: () => this.count
//   3. Accessing this.count registers the dependency
// Result: Reactive updates work!
```

### 2.4 The Tracking Window

```
Timeline:
─────────────────────────────────────────────────────────────────→

  Compile Time          │         Runtime
                        │
  Generate getter       │    Set tracker → Call getter → Clear tracker
  () => this.x          │         ↑              ↓
                        │         └── Dependencies recorded ──┘
                        │
  If we evaluated       │    Tracking context not set up
  this.x directly       │    = No dependencies recorded
  here ────────────────→│    = No reactivity!
```

### 2.5 Compat Mode Flag

`IS_GLIMMER_COMPAT_MODE` controls whether paths are wrapped:

| Flag | Output | Use Case |
|------|--------|----------|
| `true` (default) | `() => this.x` | Normal reactive rendering |
| `false` | `this.x` | SSR, static generation, testing |

The name "compat" refers to compatibility with Glimmer's reactive expectations, not Ember compatibility.

---

## 3. Single-Pass Compilation: Why Not Multi-Pass

### 3.1 The Single-Pass Flow

```
Template String
      │
      ▼
   Parse (AST)
      │
      ▼
   Visit + Serialize  ← Single unified pass
      │
      ▼
JavaScript String + Source Map
```

### 3.2 Why Not Separate Passes?

**Reason 1: Circular Dependencies**

The let block creates a fundamental cycle:

```
visitors/block.ts
    │
    │ Let block needs to serialize its children
    ▼
serializers/index.ts
    │
    │ Serializing children may need to visit nested nodes
    ▼
visitors/index.ts
    │
    │ Visiting may encounter another let block
    ▼
visitors/block.ts  ← CYCLE!
```

**Single-pass solution: Dependency injection**

```typescript
// In block.ts - declare without importing
let serializeChildFn: SerializeFn | null = null;

export function setBlockSerializeFunction(fn: SerializeFn) {
  serializeChildFn = fn;
}

// In compile.ts - wire up at runtime
import { setBlockSerializeFunction } from './visitors/block';
import { serialize } from './serializers';

setBlockSerializeFunction(serialize);  // Breaks the cycle!
```

**Reason 2: Source Mapping Simplicity**

Single-pass allows real-time position tracking:

```typescript
class CodeEmitter {
  private position = 0;

  emit(code: string) {
    this.code += code;
    this.position += code.length;  // Always accurate!
  }

  emitMapped(code: string, sourceRange: SourceRange) {
    const startPos = this.position;
    this.emit(code);
    this.recordMapping(sourceRange, { start: startPos, end: this.position });
  }
}
```

Multi-pass would require:
1. Generate code (pass 1)
2. Rebuild position mappings (pass 2)
3. Risk: positions can drift if transformations aren't perfectly tracked

**Reason 3: Performance**

- Single-pass: O(n) - each node visited once
- Multi-pass: O(n × k) where k = number of passes
- For large templates, this matters

### 3.3 What Single-Pass Prevents

Some optimizations require multiple passes:

| Optimization | Requires | Status |
|--------------|----------|--------|
| Dead code elimination | Control flow analysis | Not implemented |
| Common subexpression | Expression graph | Not implemented |
| Tree shaking | Usage analysis | Delegated to bundler |
| Constant folding | Can be done inline | Partially implemented |

These are acceptable trade-offs because:
1. Templates are typically small (< 1000 nodes)
2. Bundlers (Vite, Rollup) handle tree shaking
3. Runtime `isConst` handles constant optimization

---

## 4. The isConst Optimization

### 4.1 Self-Optimizing Formulas

The runtime automatically detects constant expressions:

```typescript
class MergedCell {
  isConst: boolean = false;

  get value() {
    if (this.isConst) {
      return this.fn();  // Fast path: skip tracking
    }

    const tracker = new Set();
    setTracker(tracker);
    const result = this.fn();
    setTracker(null);

    // If no dependencies were tracked, mark as constant
    this.isConst = tracker.size === 0;

    return result;
  }
}
```

### 4.2 Why Compile-Time Static Analysis Is Hard

```typescript
// Can the compiler know this is constant?
() => this.config.title

// It depends on:
// 1. Is this.config a Cell? (runtime knowledge)
// 2. Is title reactive? (runtime knowledge)
// 3. Will config ever change? (runtime knowledge)
```

The compiler can't know—but the runtime can discover it on first evaluation.

### 4.3 What isConst Optimizes

After first evaluation, constant formulas:
- Skip the tracking setup/teardown
- Don't allocate dependency Sets
- Are effectively as fast as direct values

```typescript
// Template: {{"static string"}}
// Compiled: () => "static string"
// After first eval: isConst = true
// Subsequent reads: just returns "static string" (no overhead)
```

### 4.4 Why We Still Create Getters

Even for obviously static values, we create getters because:

1. **Uniformity**: All template expressions have the same shape
2. **Simplicity**: Compiler doesn't need static analysis
3. **Correctness**: Runtime always makes the right decision
4. **Low overhead**: isConst makes constant getters nearly free

---

## 5. Circular Dependency Resolution

### 5.1 The Visitor Registry Pattern

```typescript
// In context.ts
interface VisitorRegistry {
  visit: VisitFn;
  visitChildren: VisitChildrenFn;
  serializeChild: SerializeChildFn;
}

interface CompilerContext {
  readonly visitors: VisitorRegistry;
}
```

### 5.2 How It Breaks Cycles

```typescript
// In compile.ts - the only place that imports everything
import { visit, visitChildren } from './visitors';
import { serialize } from './serializers';
import { setBlockSerializeFunction } from './visitors/block';

function compile(template, options) {
  // 1. Create context with visitor registry
  const ctx = createContext(template, options);

  // 2. Initialize visitors (breaks the cycle)
  initializeVisitors(ctx, visit, visitChildren);
  setBlockSerializeFunction(serialize);

  // 3. Now compilation can proceed
  // ...
}
```

### 5.3 Module Dependency Graph

```
compile.ts (orchestrator)
    │
    ├──→ visitors/index.ts
    │        │
    │        ├──→ visitors/element.ts ──→ context (for visitors registry)
    │        ├──→ visitors/block.ts ───→ context (for visitors registry)
    │        └──→ visitors/mustache.ts → context (for visitors registry)
    │
    └──→ serializers/index.ts
             │
             ├──→ serializers/element.ts
             ├──→ serializers/control.ts
             └──→ serializers/value.ts

Note: visitors/* don't import serializers/* directly
      They access serialize via ctx.visitors.serializeChild
```

---

## 6. Source Mapping Strategy

### 6.1 Hierarchical Mapping Tree

Instead of flat source maps, we use a tree structure:

```typescript
interface MappingTreeNode {
  sourceRange: { start: number; end: number };
  generatedRange: { start: number; end: number };
  sourceNode: MappingSource;  // 'ElementNode', 'MustacheStatement', etc.
  children: MappingTreeNode[];
}
```

### 6.2 Why a Tree?

**Benefit 1: Debugging**

```
Template:        <div>{{name}}</div>
                 ├──┘ └──┬──┘ └──┤
                 │       │       │
Generated:       $_tag('div',[...],[() => name],this)
                 │                  └────┬────┘
                 │                       │
                 └── ElementNode ────────┴── MustacheStatement
```

The tree preserves the nesting relationship.

**Benefit 2: IDE Integration**

- Click on `() => name` → jump to `{{name}}` in template
- Hover over `$_tag` → show the full `<div>...</div>` element

**Benefit 3: Error Attribution**

When runtime errors occur, the tree can identify:
- Which template element caused it
- The exact expression that failed

### 6.3 Real-Time Position Tracking

```typescript
// CodeEmitter tracks position as code is emitted
class CodeEmitter {
  emit(code: string) {
    const startPos = this.position;
    this.code += code;
    this.position += code.length;
    // Position is always accurate - no reconstruction needed
  }
}
```

---

## 7. Memory and Performance Characteristics

### 7.1 Compile-Time Complexity

| Phase | Time | Space |
|-------|------|-------|
| Parse | O(n) | O(n) for AST |
| Visit | O(n) | O(d) stack depth |
| Serialize | O(n) | O(n) for output |
| **Total** | **O(n)** | **O(n)** |

### 7.2 Runtime Characteristics

| Operation | First Access | Subsequent (const) | Subsequent (reactive) |
|-----------|--------------|--------------------|-----------------------|
| Formula eval | O(1) + tracking | O(1) | O(1) + tracking |
| Dependency set | Allocated | Skipped | Reused |
| Cell registration | O(1) per cell | Skipped | O(1) per cell |

### 7.3 Memory Layout

```
Compilation:
┌─────────────────────────────────────────┐
│ CompilerContext                         │
│ ├── scopeTracker: ScopeTracker         │  O(bindings)
│ ├── seenNodes: WeakSet<ASTNode>        │  O(nodes)
│ ├── errors: Error[]                     │  O(errors)
│ └── formatter: Formatter                │  O(1)
└─────────────────────────────────────────┘

Runtime:
┌─────────────────────────────────────────┐
│ Per Component                           │
│ ├── formulas: MergedCell[]             │  O(expressions)
│ ├── relatedTags: Map<id, Set>          │  O(deps)
│ └── opsForTag: Map<id, Op[]>           │  O(subscriptions)
└─────────────────────────────────────────┘
```

---

## 8. Trade-offs and Constraints

### 8.1 Accepted Trade-offs

| Trade-off | Choice | Rationale |
|-----------|--------|-----------|
| Static analysis | Deferred to runtime | Runtime has complete information |
| Multi-pass opts | Not implemented | Single-pass is simpler, fast enough |
| IR optimization | Minimal | Bundler handles tree-shaking |
| Getter overhead | Accepted | isConst eliminates it for constants |

### 8.2 Architectural Constraints

**Cannot change:**
- Getter wrapping in compat mode (reactive model depends on it)
- Single-pass flow (circular dependency solution)
- Dependency injection pattern (enables testing, parallelization)

**Can extend:**
- Post-processing passes (after serialization)
- Additional visitor types
- New SerializedValue kinds
- Builder node types

### 8.3 Future-Proofing

The architecture supports:
- **Streaming compilation**: CodeEmitter could write to a stream
- **Incremental parsing**: AST caching at parse level is safe
- **Plugin system**: Visitors/serializers are already modular
- **Alternative backends**: JSExpression could serialize to other targets

---

## Summary

The glimmer-next compiler architecture prioritizes:

1. **Correctness** over cleverness (runtime isConst vs compile-time guessing)
2. **Simplicity** over optimization (single-pass vs multi-pass)
3. **Explicitness** over magic (typed IR vs string prefixes)
4. **Testability** over performance (dependency injection vs globals)

These choices result in a compiler that is:
- Easy to understand and maintain
- Reliable and predictable
- Fast enough for real-world use
- Extensible for future needs
