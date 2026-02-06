# Research: Using Glint/TypeScript Property Information to Improve and Optimize the GXT Compiler

## Executive Summary

This document explores how **TypeScript type information** (via Glint and the TypeScript Compiler API) can be leveraged at build time to generate more efficient rendering code in the GXT compiler. The core insight is that the GXT compiler currently treats all template expressions as potentially reactive, requiring runtime checks (`isFn()`, `isTagLike()`, `isConst`), wrapper allocations (`formula()`, `MergedCell`), and opcode registration (`opcodeFor()`). With static type knowledge, many of these runtime costs can be eliminated at compile time.

No existing framework currently uses TypeScript's `ts.TypeChecker` at build time to generate **different optimized rendering code** based on property types. This represents a genuine gap and opportunity.

> **Critical Risk**: TypeScript 7 (Project Corsa), expected mid-2026, will rewrite the compiler in Go and will **not support the existing `ts.createProgram` / `ts.TypeChecker` API**. Any deep integration with the current TypeScript Compiler API should be considered at-risk. See [Section 8: Risks and Downsides](#8-risks-and-downsides) for details.

---

## Table of Contents

1. [Current Compiler Architecture](#1-current-compiler-architecture)
2. [What Glint Provides](#2-what-glint-provides)
3. [TypeScript Compiler API for Type Extraction](#3-typescript-compiler-api-for-type-extraction)
4. [Optimization Opportunities](#4-optimization-opportunities)
5. [Concrete Optimization Proposals for GXT](#5-concrete-optimization-proposals-for-gxt)
6. [How Other Frameworks Approach This](#6-how-other-frameworks-approach-this)
7. [Integration Approaches](#7-integration-approaches)
8. [Risks and Downsides](#8-risks-and-downsides)
9. [Alternative Approaches](#9-alternative-approaches)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Theoretical Limits](#11-theoretical-limits)
12. [Sources](#12-sources)

---

## 1. Current Compiler Architecture

### Pipeline

```
Template String (.gts/.gjs)
    |
    v
@glimmer/syntax Parser --> ASTv1
    |
    v
Visitors (AST -> IR: HBSChild = string | SerializedValue | HBSNode | HBSControlExpression)
    |
    v
Builders (IR -> JSExpression AST)
    |
    v
Serializers (JSExpression -> JavaScript strings)
    |
    v
JavaScript Code + Source Maps
```

Key files: `plugins/compiler/compile.ts`, `plugins/compiler/types.ts`, `plugins/compiler/visitors/`, `plugins/compiler/serializers/`

### How Reactivity Works Today

The reactivity system (`src/core/reactive.ts`) uses **pull-based tracking** with two core primitives:

- **`Cell<T>`** (line 133): A reactive data container. Reading a Cell during tracking adds it to the current tracker set. Writing to a Cell triggers invalidation.
- **`MergedCell`** (line 245): A derived/computed reactive container. Wraps a function and automatically discovers which `Cell` objects it depends on during evaluation via `currentTracker` (a `Set<Cell>` allocated at line 45).
- **`formula(fn, debugName)`**: Factory function that creates a `MergedCell` from a computation function.
- **`currentTracker`** (line 45): A module-level `Set<Cell> | null` that accumulates reactive dependencies during evaluation. When a `Cell` is read while `currentTracker` is non-null, the Cell adds itself to the set.

The flow for a template binding:

1. The compiler wraps reactive expressions in **getter functions**: `() => this.x`
2. At runtime, `resolveBindingValue()` in `src/core/dom.ts:238-257` checks:
   - Is it a function? -> Create a `formula()` (MergedCell), which calls `deepFnValue()` to recursively unwrap nested functions and tag-like values, then check `isConst`
   - Is the result a tag-like? -> Register an opcode for reactive updates
   - Otherwise -> Set the value directly (static path)
3. `MergedCell.value` getter discovers dependencies at runtime: it allocates a new `currentTracker` Set, evaluates the function, and collects all Cells that were read
4. If no dependencies are found (`tracker.size === 0`), `isConst = true` and the MergedCell is destroyed -- the value is treated as static thereafter
5. Note: When already inside a tracking context (`currentTracker !== null`), MergedCell skips its own tracking setup (line 288), reducing overhead for nested formulas

### The Problem

Every template expression pays the cost of:
- **Runtime type checking**: `isFn()`, `isTagLike()`, `isPrimitive()` on every binding
- **Wrapper allocation**: `formula()` creates a `MergedCell` even for static values (destroyed after first eval if const). This includes `deepFnValue()` recursive unwrapping.
- **Dependency tracking overhead**: `currentTracker` Set allocation and `Set.add()` for every Cell access during first evaluation
- **Opcode registration**: `opcodeFor()` (in `src/core/vm.ts:108`) calls `opsFor()` which accesses the `opsForTag` Map -- these form a single chain but involve Map lookups even when values never change

---

## 2. What Glint Provides

### Template-to-TypeScript Transform

Glint converts Handlebars template syntax into TypeScript DSL calls. For example:

```hbs
<FooComponent @desc="hello" />
```

Becomes (in the virtual TypeScript layer):

```typescript
const __glintY__ = __glintDSL__.emitComponent(
  __glintDSL__.resolve(__glintDSL__.Globals["FooComponent"])({
    desc: "hello",
    ...__glintDSL__.NamedArgsMarker
  })
);
```

### Component Signature Types

Components declare typed signatures:

```typescript
interface MySignature {
  Args: { name: string; count: number };
  Blocks: { default: [item: string] };
  Element: HTMLDivElement;
}
class MyComponent extends Component<MySignature> {}
```

The `Component` base class (`src/core/component-class.ts`) bridges to Glint via:
- `[Invoke]` symbol (from `@glint/template/-private/integration`): declares the callable signature for template invocation, allowing Glint to type-check how the component is called
- `[Context]` symbol: carries `TemplateContext<this, Args, Blocks, Element>` for type checking expressions within templates

### Extractable Type Information

| Information | Source | Compiler Use |
|---|---|---|
| Component Args shape | `Get<T, 'Args'>` from signature | Optimize prop passing, skip optional checks |
| Arg types (primitive vs object) | TypeScript type flags | Skip reactive wrapping for primitives |
| Required vs optional args | TypeScript optional property | Eliminate null checks for required args |
| Block names & yield params | `Get<T, 'Blocks'>` from signature | Dead block elimination, slot optimization |
| Root element type | `Get<T, 'Element'>` from signature | Use typed DOM APIs |
| Helper return types | `Return` from helper signature | Inline helpers returning primitives |
| `@tracked` vs plain properties | Decorator/getter analysis | Skip reactivity for non-tracked properties |
| `readonly` properties | TypeScript modifier flags | Emit static bindings |
| Event handler types | `EventTypeMap` in globals DSL | Type-safe event binding |

### GXT's Glint Environment

The project has a custom Glint environment at `glint-environment-gxt/` that:
- Points to `glint-environment-gxt/-private/dsl` for type resolution
- Maps keywords `if`, `unless`, `yield`, `component`, `modifier`, `helper` to special form handlers via `specialForms.globals`
- Registers `each` as a global (handled through the `EachKeyword` type in `globals.d.ts`, separate from the special forms mapping)
- Registers other globals: `on`, `array`, `hash`, `fn`, `eq`, `not`, `or`, `and`, `element`
- Handles `.gts` (typed) and `.gjs` (untyped) file extensions
- Includes typed event mapping (`EventTypeMap`) for all DOM events

---

## 3. TypeScript Compiler API for Type Extraction

### Setting Up

```typescript
import * as ts from "typescript";
const program = ts.createProgram(files, compilerOptions);
const checker = program.getTypeChecker();
```

### Key Methods

| Method | Returns | Use Case |
|---|---|---|
| `checker.getTypeAtLocation(node)` | `ts.Type` | Get type of any template expression |
| `checker.getPropertiesOfType(type)` | `ts.Symbol[]` | Extract component args shape |
| `checker.getSignaturesOfType(type, kind)` | `ts.Signature[]` | Detect functions, get return types |
| `sig.getReturnType()` | `ts.Type` | Helper return type analysis |
| `type.getCallSignatures()` | `ts.Signature[]` | Check if value is callable |
| `type.flags & ts.TypeFlags.XXX` | `boolean` | Primitive vs object classification |

### Primitive Detection

```typescript
function isPrimitiveType(type: ts.Type): boolean {
  return !!(type.flags & (
    ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean |
    ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral |
    ts.TypeFlags.BooleanLiteral | ts.TypeFlags.Null |
    ts.TypeFlags.Undefined | ts.TypeFlags.Void
  ));
}
```

### Readonly Detection

```typescript
function isReadonlyProperty(symbol: ts.Symbol): boolean {
  return symbol.getDeclarations()?.some(decl =>
    !!(ts.getCombinedModifierFlags(decl as ts.Declaration) & ts.ModifierFlags.Readonly)
  ) ?? false;
}
```

### Signal/Cell Type Detection

```typescript
function isCellType(checker: ts.TypeChecker, type: ts.Type): boolean {
  const typeName = checker.typeToString(type);
  return /^Cell</.test(typeName) || /^MergedCell/.test(typeName);
}
```

---

## 4. Optimization Opportunities

### 4.1 Elide Getter Wrappers for Known Primitives

**Current behavior**: All `this.x` references in templates become `() => this.x` (a `GetterValue`), which creates a `formula()` at runtime.

**With type info**: If `this.count` is typed as `number` (and not `@tracked`), emit a `LiteralValue` or direct value instead of a `GetterValue`.

```
// BEFORE (all expressions):
$_tag("div", [], [() => this.count], ctx)  // getter wrapper, runtime formula

// AFTER (when type is known primitive + non-tracked):
$_tag("div", [], [this.count], ctx)  // direct value, no formula overhead
```

**Impact**: Eliminates `MergedCell` allocation, `currentTracker` Set creation, `deepFnValue()` unwrapping, and `isConst` check for every static binding.

### 4.2 Skip Reactive Wrapping for Readonly Properties

**Current behavior**: `readonly title = "Hello"` still gets wrapped in `() => this.title`.

**With type info**: Detect `readonly` modifier, emit the value inline.

```
// BEFORE:
$_tag("h1", [], [() => this.title], ctx)

// AFTER:
$_tag("h1", [], ["Hello"], ctx)  // inlined constant
```

### 4.3 Optimize Component Arg Passing

**Current behavior**: In Glimmer compat mode, args are wrapped with a `Proxy` using `ArgProxyHandler` (`src/core/dom.ts:1263`) that lazily evaluates getter functions on each property access via `isFn()` checks. In non-compat mode, args are passed more directly. See `$_args()` at `src/core/dom.ts:1301-1350`.

**With type info**: Known arg shapes enable:
- Direct property assignment instead of Proxy-based lazy evaluation
- Skip `isFn()` checks on each arg access when types are known
- Skip null checks for required args
- Skip `Object.keys()` iteration for known fixed shapes

### 4.4 Specialize DOM Operations by Element Type

**Current behavior**: Generic `api.attr(element, key, value)` for all elements.

**With type info**: If `Element: HTMLInputElement` is known:
- Use `element.value = x` instead of `api.attr(element, 'value', x)` for input-specific properties
- Use typed event handlers (`InputEvent` for `input` events)

### 4.5 Helper Return Type Optimization

**Current behavior**: Helper results always go through `resolveBindingValue()` with full reactive check.

**With type info**: If a helper's return type is `string`:
- Skip `isFn()` check (strings are never functions)
- Skip `isTagLike()` check (strings are never reactive)
- Emit direct `api.textContent(element, helperResult)` call

### 4.6 Template Static Structure Hoisting

**Current behavior**: Every `$_tag("div", ...)` call creates a new DOM element at render time.

**With structural analysis** (no type info needed): Static template sections (HTML with no dynamic bindings) can be hoisted to module level as HTML strings and cloned via `cloneNode(true)` at render time, patching only dynamic parts afterward.

This is the approach used by SolidJS (`template()` + `innerHTML`) and Vue Vapor (`_createTemplateFromHTML()`). It delivers the largest performance win for template-heavy components and is **orthogonal to type-directed optimization** -- it requires only structural analysis of which parts are static vs dynamic.

**Impact**: Reduces DOM creation cost proportional to the ratio of static vs dynamic content. For a template with 20 static elements and 2 dynamic bindings, this avoids 20 individual `createElement` calls.

### 4.7 Event Handler Static Detection

**Current behavior**: Event handlers in `buildEvents()` (`plugins/compiler/serializers/element.ts:307`) are wrapped in arrow functions like `($e, $n) => handler($e, $n, ...tailArgs)`.

**With type info**: If `this.handleClick` is a bound method (non-reactive, not tracked), the handler reference can be passed directly without creating a new arrow function wrapper on every render.

### 4.8 List Rendering Optimization

**Current behavior**: `$_each` and `$_eachSync` (`src/core/dom.ts:1211-1240`) accept items with `{ id: number }` constraint.

**With type info**:
- **Key inference**: If the item type has a unique `id` property, the compiler can automatically infer the key without requiring `key=@id` in the template
- **Item type narrowing**: If items are primitives (e.g., `string[]`), skip the full component instantiation path and use a simpler text-node-only update
- **Stable reference detection**: If the array is `readonly` or items are immutable types, the diff algorithm can be simplified

### 4.9 Pre-compute Dependency Graph

**Current behavior**: Dependencies discovered at runtime via `currentTracker` during first evaluation.

**With type info**: If the compiler knows which properties are `@tracked` (Cells) and which expressions read them:
- Pre-wire dependency edges at compile time
- Skip the `currentTracker` protocol entirely
- Emit direct `opcodeFor(specificCell, updater)` calls

> **Feasibility warning**: This is rated **IMPRACTICAL** by review. It fundamentally conflicts with the pull-based reactive model. Pre-computing dependencies requires static analysis across getter boundaries and module boundaries -- a whole-program analysis problem that TypeScript types alone cannot solve. Defer until simpler optimizations prove their value.

### 4.10 Dead Template Branch Elimination

**Current behavior**: `{{if this.featureFlag content}}` always emits `$_if()` with both branches.

**With type info**: If `featureFlag` has literal type `false`, eliminate the entire `if` block. Only useful for narrow cases (compile-time constants, feature flags).

### 4.11 Classify Expression Reactivity Statically

Every template expression could be classified at compile time as one of three tiers:

| Tier | Condition | Generated Code |
|---|---|---|
| **Static** | No reactive dependencies | Direct DOM write, no tracking infrastructure |
| **Single-signal** | Depends on exactly one Cell | Direct `opcodeFor(cell, updater)`, no formula needed |
| **Multi-signal** | Depends on multiple Cells | Full `formula()` with dependency tracking |

This eliminates the branching in `resolveBindingValue()` for the first two tiers.

### 4.12 SSR/Rehydration Optimization

**Current behavior**: The SSR/rehydration system (`src/core/ssr/`) walks DOM nodes and matches them to component output using generic comment markers.

**With type info**:
- **Static subtree skipping**: If type analysis determines a component's entire output is static (no tracked properties, no reactive args), rehydration can skip that subtree entirely
- **Partial hydration / Islands**: Type info can identify which components are interactive (have tracked state or event handlers) vs. purely presentational, enabling automatic islands architecture

---

## 5. Concrete Optimization Proposals for GXT

### Proposal 1: Add Type Hints to CompileOptions

Extend `CompileOptions` (`plugins/compiler/types.ts:448-465`) to accept type metadata about component properties. This flows through the existing `CompileOptions` -> `createContext()` -> `CompilerContext` path, which all visitors and serializers already receive. The existing `lexicalScope` callback is a direct precedent for passing external build-time analysis through this same path.

```typescript
interface PropertyTypeHint {
  kind: 'primitive' | 'object' | 'function' | 'cell' | 'unknown';
  isReadonly?: boolean;
  isTracked?: boolean;
  literalValue?: string | number | boolean;
}

interface CompileOptions {
  // ... existing options ...
  typeHints?: {
    // Maps "this.propertyName" -> type hint
    properties?: Record<string, PropertyTypeHint>;
    // Maps "@argName" -> type hint
    args?: Record<string, PropertyTypeHint>;
    // Maps helper names -> return type hint
    helperReturns?: Record<string, PropertyTypeHint>;
  };
}
```

**Feasibility**: EASY. Pure additive change, no existing code breaks.

### Proposal 2: Extend SerializedValue with Reactivity Classification

Add a `reactivity` field to `SerializedValueBase` (`plugins/compiler/types.ts:143`). This is purely additive -- all existing code that constructs values via factory functions (`literal()`, `path()`, `getter()`, etc.) continues to work because the field is optional. All switch statements in serializers discriminate on `value.kind`, not on base fields.

```typescript
type ReactivityHint = 'static' | 'single-signal' | 'reactive' | 'unknown';

interface SerializedValueBase {
  readonly sourceRange?: SourceRange;
  readonly reactivity?: ReactivityHint;  // NEW
}
```

The serializer can then emit different code per classification:
- `static`: direct value, no wrapper
- `single-signal`: direct `opcodeFor(cell, updater)`, no formula
- `reactive`: full `formula()` path (current behavior)
- `unknown`: current runtime detection path (fallback)

**Feasibility**: EASY. Factory functions updated incrementally.

### Proposal 3: Vite Plugin Integration

Add a TypeScript analysis pass to the Vite plugin (`plugins/compiler.ts`). The natural consumption point is the **visitor phase** -- specifically `visitSimpleMustache()` in `mustache.ts:175`, where the visitor can look up `ctx.typeHints?.properties?.[pathExpression]` and attach the reactivity hint to the returned `SerializedValue`. The hint then cascades to `buildPathExpression()` in `value.ts:100`, where the getter wrapping decision is already isolated at line 137-139.

**Feasibility**: MODERATE. Approach A (external hints) is easy; Approach B (inline `ts.createProgram`) has build-time and TS7 migration risk.

### Proposal 4: Template Expression Classification

Before serialization, classify each template expression:

```
{{this.title}}          -> readonly string  -> STATIC  -> inline value
{{this.count}}          -> @tracked number  -> SINGLE  -> direct opcode
{{this.fullName}}       -> getter string    -> REACTIVE -> formula
{{formatDate this.date}} -> helper returns string -> depends on args
{{if this.show "yes"}}  -> @tracked boolean -> SINGLE  -> direct opcode on condition
```

Detection mechanism: `@tracked` properties are identified by analyzing the backing class source for the `@tracked` decorator (via AST inspection or Babel parse of the `.gts` file). This does not require full `ts.TypeChecker` -- a simple AST walk of the class body to find decorator applications suffices.

**Feasibility**: MODERATE. Static classification works. Single-signal requires new runtime functions.

### Proposal 5: New Compiler Flag

Add to `CompilerFlags` (`plugins/compiler/types.ts`), following the existing pattern of `IS_GLIMMER_COMPAT_MODE`, `WITH_HELPER_MANAGER`, etc. The `createFlags()` function handles defaults.

```typescript
interface CompilerFlags {
  // ... existing flags ...
  /** Enable type-directed optimization. Requires typeHints in CompileOptions. */
  readonly WITH_TYPE_OPTIMIZATION: boolean;
}
```

When enabled, the serializer emits specialized code paths. When disabled, behavior is unchanged (backward compatible).

**Feasibility**: EASY. Follows existing flag pattern exactly.

---

## 6. How Other Frameworks Approach This

### SolidJS

- Compiles JSX to direct DOM operations: `<div>{count()}</div>` -> `createEffect(() => el.textContent = count())`
- Detects constants: literal values never wrapped in `createEffect`
- Static template parts hoisted via `template()` + `innerHTML` + `cloneNode(true)`
- No virtual DOM, no component re-rendering
- Uses heuristics (not TypeScript types) for reactivity detection
- `/* @once */` directive provides explicit opt-out from reactive wrapping

### Svelte 5 (Runes)

- `$state`, `$derived`, `$effect` are compiler directives, not runtime functions
- Compiler tracks data flow statically -- "the generated code is highly efficient"
- Fine-grained updates at expression level
- Signals are an implementation detail, not user-facing API
- Performance "neck and neck with Solid" with less memory usage

### Vue Vapor Mode

- Same source code, different compilation output (no VDOM)
- Direct DOM API calls: `document.createElement`, `element.textContent = ...`
- `_renderEffect` for reactive, `_setText` for static
- 88% bundle size reduction (50KB -> 6KB)
- 100K components mounted in 100ms
- Alien-signals integration: 14% memory reduction
- Note: Vue Vapor has been delayed by compatibility issues and will likely land in 2026

### Angular AOT

- Generates "Type Check Blocks" (TCBs) -- synthetic TypeScript for template validation
- Template type narrowing: `*ngIf="person"` narrows type within block
- `strictTemplates` mode validates binding assignability
- Built on top of TypeScript compiler, extending it
- Signal-based change detection: 60% faster startup (zoneless)

### React Compiler (v1.0, October 2025)

- Infers types to determine what needs memoization
- `array.length` -> primitive -> skip memoization
- Escape analysis: only memoize values that "escape" the function
- Production results at Meta: up to 12% faster initial loads, 2.5x faster interactions in Meta Quest Store
- `"use memo"` directive provides explicit opt-in
- 1,231 out of 1,411 components compiled at Wakelet (~87% coverage)
- Compiler-enforced "Rules of React" -- the concept of compiler-enforced rules is worth studying for GXT

### Ezno

- Experimental TypeScript compiler in Rust with deep static analysis
- Type-directed dead code elimination: "if a method on a class is never called, it's not included"
- Aims for "maximum knowledge" of source including runtime exceptions
- Key limitation: "a single `any` type can poison the entire optimization chain"
- Still in early/experimental stage; does not support enough features for real-world projects yet

---

## 7. Integration Approaches

### Approach A: Lightweight (Type Hints from External Analysis)

- Build a separate tool that analyzes `.gts` files using `ts.createProgram`
- Extracts property types, readonly status, tracked status
- Outputs a `.type-hints.json` per component
- Vite plugin reads hints and passes to `compile()`

**Pros**: Minimal compiler changes, incremental adoption, works without Glint
**Cons**: Requires separate analysis step, hints may be stale

### Approach B: Medium (Integrated TypeScript Analysis in Vite Plugin)

- Add `typescript` as a dependency of the Vite plugin
- Create a `ts.Program` during the transform phase
- Extract types inline and pass to `compile()`

**Pros**: Always up-to-date, single build step
**Cons**: Slower builds (TypeScript program creation is expensive -- typically 200-500MB memory for medium projects), larger dependency, **at risk from TypeScript 7 API changes** (see Section 8)

### Approach C: Deep (Glint V2 + Volar Integration)

- Use Glint V2's Volar-based `VirtualCode` to get the TypeScript representation
- Query types through the Glint language server
- Feed type info back to the compiler

**Pros**: Full type fidelity, works with Glint's template-to-TS transform
**Cons**: Tight coupling to Glint internals, complex integration, Glint V2 is itself experimental

### Recommended Approach

**Start with Approach A** (lightweight hints) for maximum impact with minimum risk. The compiler changes are additive -- unknown types fall back to current behavior. This can be evolved to Approach B once TypeScript 7's Go-based API stabilizes, or combined with decorator-based approaches (see Section 9) for immediate wins without any TypeScript Compiler API dependency.

---

## 8. Risks and Downsides

### 8.1 TypeScript 7 API Breakage (Critical)

TypeScript 7 (Project Corsa), expected mid-2026, rewrites the compiler in Go for 10x faster builds. The VSCode codebase (1.5M lines) compiles in 8.74 seconds instead of 89. However, **the current `ts.createProgram` / `ts.TypeChecker` API will not be supported** by Corsa. The Corsa API is still a work in progress with no stable tooling integration.

**Impact**: Approaches B and C could be obsoleted within a year. Any current investment in deep `ts.TypeChecker` integration is at risk.

**Mitigation**: Start with Approach A (external hints) or decorator-based approaches. Plan for two futures: one where TypeScript 7's API enables fast type extraction, and one where it does not.

### 8.2 Correctness Risks (Wrong Type Hints)

If type hints are incorrect, the compiler may generate code that silently breaks reactivity:
- A developer marks a property as `readonly` but later adds `@tracked`. If hints are stale, the UI won't update.
- A helper is declared as returning `string` but actually returns `null` in edge cases. The compiler skips null checks.
- Type assertions (`as`) or `any` types provide incorrect type information that the compiler trusts.

**Mitigation**: Type-directed optimizations must be **conservative**. If there is any doubt (union types containing both primitive and reactive, `any`, `unknown`), fall back to the current runtime detection path. Ezno's discovery that "a single `any` can poison the chain" applies directly here.

### 8.3 `.gjs` File Coverage Gap

`.gjs` files are untyped JavaScript Glimmer files. Type-directed optimization is impossible for them -- they will always use the current runtime detection path. The document's optimizations only apply to `.gts` files.

### 8.4 Runtime Compiler Asymmetry

The runtime compiler (`plugins/runtime-compiler.ts`) uses `new Function()` to evaluate compiled templates at runtime with no access to TypeScript type information. The current branch is `runtime-compiler`, making this especially relevant:
- Runtime-compiled templates cannot benefit from type-directed optimization
- If type-directed optimizations change the semantics of compiled output, runtime-compiled and build-time-compiled templates could behave differently for the same template string
- This creates a **two-tier performance model** that should be explicitly documented

### 8.5 Maintenance Burden

Maintaining a type-aware compiler is significantly harder than a syntax-only compiler:
- Every change to the reactivity system (`Cell`, `MergedCell`, `formula`) must be mirrored in the type extraction logic
- TypeScript version upgrades may change type flag values or type checker behavior
- The testing surface area increases: every optimization must be tested with correct types, incorrect types, `any` types, union types, intersection types, conditional types, generic types, etc.

### 8.6 Bundle Size Considerations

Each optimization strategy has different bundle size tradeoffs:
- **Static tier code** (direct DOM writes) is smaller than the reactive tier (which requires `formula`, `MergedCell`, `opcodeFor` imports)
- However, multiple code paths (static/single-signal/multi-signal) increase total generated code pattern variety, which can hurt compression (gzip/brotli work best with repetitive patterns)
- The existing `PURE_FUNCTIONS` set and `/*#__PURE__*/` annotations (`plugins/compiler/serializers/symbols.ts`) enable tree-shaking. If the compiler generates code that never uses `formula()`, the bundler may tree-shake `MergedCell` out entirely -- this interaction should be validated

---

## 9. Alternative Approaches

### 9.1 Explicit Decorators (`@static`, `@reactive`)

Rather than inferring reactivity from types, the compiler can use explicit markers:

```typescript
class MyComponent extends Component {
  @static title = "Hello";        // Compiler emits direct value
  @tracked count = 0;             // Compiler emits reactive binding
  @derived get fullName() { ... } // Compiler emits formula
}
```

This is more explicit than type inference, avoids the correctness risk of wrong type hints, and is how Svelte 5 Runes work (`$state`, `$derived`, `$effect`). The `@tracked` decorator already exists in the codebase (`src/core/reactive.ts:78`). Adding `@static` as a complementary decorator would be a minimal change.

**Pros**: Zero TypeScript Compiler API dependency, works in `.gjs` files, no correctness risk, detectable via simple AST walk
**Cons**: Requires developer effort to annotate, not automatic

### 9.2 JSDoc Annotations

```javascript
/** @reactive */
get fullName() { return this.firstName + ' ' + this.lastName; }

/** @static */
readonly title = "Hello";
```

Works in `.gjs` files, does not require TypeScript, and is much cheaper to parse (regex or simple AST analysis). SolidJS's `@once` directive is a simpler version of this concept.

### 9.3 Template Comment Directives

Per-expression opt-in within templates:

```hbs
{{! @gxt-static }}{{this.title}}
{{! @gxt-reactive }}{{this.count}}
```

### 9.4 Babel Plugin for Type Extraction

Instead of using the TypeScript Compiler API (which is slow and will break with TypeScript 7), a Babel plugin could extract type information from TypeScript syntax:
- `@babel/plugin-transform-typescript` already strips types but could be extended to extract them first
- Integrates with existing Vite/Babel build pipelines without adding `typescript` as a dependency
- Faster than `ts.createProgram` because it does not perform full type checking

**Tradeoff**: Babel does not do type inference -- it can only see explicit type annotations, not inferred types. For the most common case (explicitly typed component signatures), this covers ~80% of the value.

---

## 10. Implementation Roadmap

Recommended order, from lowest risk to highest value:

### Phase 1: Zero-Risk Structural Optimizations (no type info needed)

1. **Template static structure hoisting** (Section 4.6): Purely structural analysis, no correctness risk, highest-impact optimization. Clone static HTML skeletons via `cloneNode(true)`.
2. **Literal value inlining**: Template expressions that are string/number/boolean literals (`{{42}}`, `{{"hello"}}`, `{{true}}`) can be inlined from the AST alone.

### Phase 2: Explicit Opt-In (minimal risk)

3. **Add `WITH_TYPE_OPTIMIZATION` compiler flag** (Proposal 5): Trivial, follows existing pattern in `CompilerFlags`.
4. **Add `typeHints` to `CompileOptions`** (Proposal 1): Pure additive change, ~1-2 hours of work.
5. **Add `reactivity` field to `SerializedValue`** (Proposal 2): ~1 hour of work.
6. **Add `@static` decorator** (Section 9.1): Complement to existing `@tracked`, detectable via AST walk, no TypeScript API needed.
7. **Elide getter wrappers for `readonly` and `@static`** (Sections 4.1, 4.2): Modify `buildPathExpression()` in `value.ts:137-139` to check reactivity hint before wrapping.

### Phase 3: Automatic Optimization (moderate risk)

8. **Approach A integration** (lightweight external type hints): Build separate analysis tool, output `.type-hints.json` per component.
9. **Template expression classification** (Proposal 4): Visitors attach reactivity hints, serializers emit optimized code.
10. **Helper return type optimization** (Section 4.5): Skip reactive checks for known-primitive returns.
11. **Component arg optimization** (Section 4.3): Bypass `ArgProxyHandler` for known-shape args.

### Phase 4: Advanced (higher risk, defer)

12. **Event handler static detection** (Section 4.7)
13. **List rendering optimization** (Section 4.8)
14. **Dead branch elimination** (Section 4.10)
15. **SSR/rehydration optimization** (Section 4.12)

### Deferred / Not Recommended

- **Pre-compute dependency graph** (Section 4.9): Rated impractical -- conflicts with pull-based reactive model
- **Deep TypeScript API integration** (Approaches B and C): Defer until TypeScript 7's Go-based Corsa API stabilizes (mid-2026+)
- **Full Glint V2/Volar integration**: Glint V2 is itself experimental; building on two experimental layers compounds risk

### Files to Modify (in order)

| File | Change |
|---|---|
| `plugins/compiler/types.ts` | Add `WITH_TYPE_OPTIMIZATION` flag, `typeHints` in `CompileOptions`, `reactivity` in `SerializedValueBase` |
| `plugins/compiler/context.ts` | Store `typeHints` in `CompilerContext` via `createContext()` |
| `plugins/compiler/visitors/mustache.ts` | Look up type hints in `visitSimpleMustache()`, attach to `SerializedValue` |
| `plugins/compiler/serializers/value.ts` | Check `reactivity` hint in `buildPathExpression()` before getter wrapping |
| `plugins/compiler/serializers/element.ts` | Cascade optimized values through `buildTupleArray()`, `buildArgsObject()` |
| `plugins/compiler.ts` | Read `.type-hints.json` in Vite plugin, pass to `compile()` |
| `src/core/reactive.ts` | Add `@static` decorator (complement to `@tracked`) |

---

## 11. Theoretical Limits

### What CAN Be Optimized

- Static template structure (hoisted HTML creation via `cloneNode`)
- Known-constant expressions (inlined values)
- Dependency graph topology (pre-computed update order -- in theory)
- Static component trees (inlined children)
- Primitive bindings (simplified update code)

### What CANNOT Be Optimized

- Dynamic data (user input, API responses)
- Dynamic component resolution (`{{component this.currentView}}`)
- Turing-complete computed properties
- Cross-module boundaries with `any` types (Ezno's discovery)
- Dynamic property access (`this[dynamicKey]`)

### The Theoretical Optimal

A reactive UI compiler achieving:
- Zero reactive overhead for constant values
- Exactly one opcode per reactive binding (no intermediate formulas)
- Pre-computed, topologically-sorted update schedule
- No runtime type checks (`isFn`, `isTagLike`, etc.)
- Zero intermediate object allocations during updates
- O(1) per changed signal to locate and execute affected DOM operations

Current frameworks achieve ~60-70% of this optimal. Type-directed optimization could close the gap to ~85-90%.

---

## 12. Sources

### Glint & GXT
- [Glint GitHub Repository](https://github.com/typed-ember/glint)
- [Glint Architecture](https://github.com/typed-ember/glint/blob/main/ARCHITECTURE.md)
- [Glint Types Documentation](https://typed-ember.gitbook.io/glint/using-glint/glint-types)
- [RFC 0748: Glimmer Component Signature](https://rfcs.emberjs.com/id/0748-glimmer-component-signature/)
- [Ember TypeScript Invokables Guide](https://guides.emberjs.com/v5.5.0/typescript/core-concepts/invokables/)
- [@glint/template Type Definitions](https://cdn.jsdelivr.net/npm/@glint/template@1.4.0/-private/index.d.ts)
- [Introducing Glint (Salsify Blog)](https://www.salsify.com/blog/engineering/introducing-glint-a-typed-template-solution-for-glimmerx-and-ember)

### TypeScript Compiler API
- [Using the Compiler API (TypeScript Wiki)](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [Going Beyond the AST with TypeScript Type Checker](https://www.satellytes.com/blog/post/typescript-ast-type-checker/)
- [Detecting UI Components with TS Compiler API](https://fwouts.com/articles/previewjs-detecting-components)
- [@jitl/ts-simple-type](https://www.npmjs.com/package/@jitl/ts-simple-type)
- [Progress on TypeScript 7 - December 2025](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)

### Framework Approaches
- [SolidJS: Thinking Granular](https://dev.to/ryansolid/thinking-granular-how-is-solidjs-so-performant-4g37)
- [SolidJS Compilation Process](https://app.studyraid.com/en/read/8387/231141/solidjs-compilation-process)
- [SolidJS @once directive](https://docs.solidjs.com/reference/jsx-attributes/once)
- [Svelte 5 Runes](https://svelte.dev/blog/runes)
- [Svelte Compiler: How It Works](https://daily.dev/blog/svelte-compiler-how-it-works)
- [Svelte Issue #418: Leverage Types for Perf](https://github.com/sveltejs/svelte/issues/418)
- [Vue Vapor Mode Preview](https://vueschool.io/articles/news/vn-talk-evan-you-preview-of-vue-3-6-vapor-mode/)
- [Vue Vapor Mode Future](https://www.vuemastery.com/blog/the-future-of-vue-vapor-mode/)
- [Angular Compiler Internals](https://blog.angular.dev/how-the-angular-compiler-works-42111f9d2549)
- [Angular Template Type Checking](https://angular.dev/tools/cli/template-typecheck)
- [Angular Signals Guide](https://blog.angular-university.io/angular-signals/)
- [React Compiler v1.0](https://react.dev/blog/2025/10/07/react-compiler-1)
- [React Compiler Internals](https://gitnation.com/contents/react-compiter-internals)

### Research & Theory
- [Signal-First Architectures (arXiv:2506.13815)](https://arxiv.org/html/2506.13815)
- [Ezno TypeScript Compiler](https://github.com/kaleidawave/ezno)
- [Ezno 2025 Update](https://kaleidawave.github.io/posts/ezno-25/)
- [TC39 Signals Proposal](https://github.com/tc39/proposal-signals)
- [Alien Signals](https://github.com/stackblitz/alien-signals)
- [Glimmer: Blazing Fast Rendering (LinkedIn)](https://www.linkedin.com/blog/engineering/open-source/glimmer-blazing-fast-rendering-for-ember-js-part-1)
