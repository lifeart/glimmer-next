# Compiler Architecture Refactoring Plan

## Overview

This document outlines the plan to refactor the Glimmer-to-JavaScript compiler from a global-state-based architecture to a clean, dependency-injected, single-pass design.

## Current Problems

| Issue | Severity | Description |
|-------|----------|-------------|
| **Global state** | CRITICAL | `flags`, `bindings`, `serializationContext` in utils.ts are module-level globals |
| **Dual conversion paths** | HIGH | `templateToTypescript()` vs `convert()` + `serializeNode()` do similar things differently |
| **seenNodes mutation** | HIGH | Tracking processed nodes via Set mutation without proper reset |
| **Magic strings** | MEDIUM | `$:`, `$placeholder`, `__wrapped_math__` used as markers |
| **Multiple AST traversals** | MEDIUM | Parse → convert → re-traverse is inefficient |
| **Lossy source maps** | MEDIUM | Only leaf nodes preserved in mapping tree |

## Proposed Architecture

### Core Principle: Dependency Injection Over Global State

All compiler state flows through an explicit `CompilerContext` object, making the code:
- Testable (no global state to reset)
- Parallelizable (each compilation has its own context)
- Debuggable (clear data flow)

### Module Structure

```
plugins/compiler/
├── index.ts              # Public API: compile(source, options)
├── types.ts              # All type definitions
├── context.ts            # CompilerContext factory
├── flags.ts              # Compiler flags (immutable)
│
├── tracking/
│   ├── scope-tracker.ts  # Stack-based binding/scope management
│   ├── code-emitter.ts   # Code generation with position tracking
│   └── mapping-tree.ts   # Hierarchical source mappings
│
├── visitors/
│   ├── index.ts          # Main visit() dispatcher
│   ├── element.ts        # visitElement()
│   ├── mustache.ts       # visitMustache()
│   ├── block.ts          # visitBlock()
│   └── text.ts           # visitText()
│
├── serializers/
│   ├── index.ts          # serializeNode() dispatcher
│   ├── element.ts        # serializeElement()
│   ├── component.ts      # serializeComponent()
│   └── control.ts        # serializeControl()
│
└── __tests__/
    ├── context.test.ts
    ├── scope-tracker.test.ts
    ├── visitors.test.ts
    └── integration.test.ts
```

### Key Design Decisions

#### 1. CompilerContext

```typescript
interface CompilerContext {
  readonly flags: CompilerFlags;
  readonly scopeTracker: ScopeTracker;
  readonly emitter: CodeEmitter;
  readonly errors: CompilerError[];
  readonly warnings: CompilerWarning[];
}
```

All functions receive context as first parameter - no implicit dependencies.

#### 2. ScopeTracker (Replaces Global Bindings)

Stack-based scope management:
- `enterScope()` / `exitScope()` for block boundaries
- `addBinding(name, info)` adds to current scope
- `resolve(name)` walks scope chain
- `hasBinding(name)` checks if name is bound

#### 3. CodeEmitter (Replaces Mapper)

Focused responsibilities:
- Append code strings
- Track source positions
- Build mapping tree
- No indentation logic (handled by serializers)

#### 4. Tagged Values (Replaces Magic Strings)

```typescript
type SerializedValue =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'path'; expression: string; sourceRange?: SourceRange }
  | { kind: 'spread'; expression: string }
  | { kind: 'raw'; code: string };
```

No more `$:` prefix parsing - values are explicitly tagged.

#### 5. Single-Pass Visitor

One AST traversal that:
1. Tracks scopes (enter/exit)
2. Resolves bindings
3. Emits code
4. Records mappings

## Migration Strategy

### Phase 1: Foundation (This PR) ✅ COMPLETED
- [x] Create plan.md
- [x] Create folder structure
- [x] Implement types.ts (all type definitions, type guards, value constructors)
- [x] Implement CompilerFlags (immutable, frozen)
- [x] Implement CompilerContext (dependency injection container)
- [x] Implement ScopeTracker (stack-based scope management)
- [x] Implement CodeEmitter (code generation with source mapping)
- [x] Write unit tests (130 tests passing)
- [x] Verify no regression (1806 total tests passing)

### Phase 2: Visitors ✅ COMPLETED
- [x] Implement visitor dispatcher (visitors/index.ts)
- [x] Implement visitElement (visitors/element.ts)
- [x] Implement visitMustache (visitors/mustache.ts)
- [x] Implement visitBlock (visitors/block.ts)
- [x] Implement visitText (visitors/text.ts)
- [x] Create shared utilities (visitors/utils.ts)
- [x] Write visitor tests (60 tests passing)
- [x] Verify no regression (1866 total tests passing)

### Phase 3: Serializers ✅ COMPLETED
- [x] Implement serializer dispatcher (serializers/index.ts)
- [x] Implement serializeElement (serializers/element.ts)
- [x] Implement serializeComponent (serializers/element.ts)
- [x] Implement serializeControl (serializers/control.ts)
- [x] Implement serializeValue (serializers/value.ts)
- [x] Create symbols module (serializers/symbols.ts)
- [x] Write serializer tests (49 tests passing)
- [x] Verify no regression (1915 total tests passing)

### Phase 4: Integration ✅ COMPLETED
- [x] Implement compile() entry point (compile.ts)
- [x] Integration tests against existing test cases (53 tests passing)
- [x] Fix component @args handling - put @-prefixed attributes in attributes array
- [x] Fix this.xxx path recognition - recognize 'this' paths as always valid
- [x] Integrate source mapping with CodeEmitter in compile function
- [x] Add source map integration tests (6 tests)
- [x] Verify no regression (1968 total tests passing)

### Phase 5: Migration ✅ COMPLETED
- [x] Create adapter layer for backward compatibility (adapter.ts)
  - [x] `templateToTypescript()` - compatible with converter-v2 API
  - [x] Mapping tree conversion (sourceRange/generatedRange → originalRange/transformedRange)
  - [x] Added methods: clone(), shiftOriginal(), shiftTransformed(), addChild()
  - [x] 15 adapter tests passing
- [x] Migrate existing code to use new compiler
  - [x] Update plugins/test.ts to use adapter (templateToTypescript)
  - [x] All 1983 tests passing after migration
- [ ] Future: Deprecate old utils.ts functions (optional, can be done incrementally)
- [ ] Future: Remove global state from converter-v2 (optional, can be done incrementally)

## Testing Strategy

1. **Unit Tests**: Each module tested in isolation
2. **Snapshot Tests**: Compare output against known-good results
3. **Integration Tests**: Full compilation pipeline
4. **Regression Tests**: Run existing test suite against new compiler

## Success Criteria

- [x] All existing tests pass (1983 tests after migration)
- [x] No global state in new compiler (CompilerContext pattern)
- [x] Single AST traversal (visitor pattern)
- [x] Clear module boundaries (types, context, tracking, visitors, serializers)
- [ ] 100% type safety (no `as` casts or `@ts-expect-error`)
- [x] Comprehensive test coverage (307 compiler tests)
- [x] Backward compatible adapter layer for gradual migration

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Output differences | Snapshot tests comparing old vs new |
| Performance regression | Benchmark before/after |
| Edge cases missed | Extensive integration testing |
| Breaking existing code | Adapter layer for gradual migration |
