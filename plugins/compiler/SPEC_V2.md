# Glimmer-Next Compiler V2 Specification

This document provides a complete technical specification of the Glimmer-Next V2 template compiler architecture. The V2 compiler is a ground-up rewrite with improved architecture, explicit dependency injection, proper source mapping, and a cleaner code generation pipeline.

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Module Structure](#3-module-structure)
4. [Type System](#4-type-system)
5. [Compilation Flow](#5-compilation-flow)
6. [Visitor Pattern](#6-visitor-pattern)
7. [Builder Pattern](#7-builder-pattern)
8. [Serializers](#8-serializers)
9. [Scope Tracking](#9-scope-tracking)
10. [Source Mapping](#10-source-mapping)
11. [Runtime Symbols](#11-runtime-symbols)
12. [Compiler Flags](#12-compiler-flags)
13. [Control Flow Compilation](#13-control-flow-compilation)
14. [Component Compilation](#14-component-compilation)
15. [Event and Modifier Handling](#15-event-and-modifier-handling)

---

## 1. Overview

The V2 compiler transforms Glimmer/Handlebars templates into optimized JavaScript code with source mapping support. Key improvements over V1:

- **Explicit Context**: All state is passed through `CompilerContext`, eliminating global state
- **Typed Intermediate Representation**: Uses `SerializedValue` types instead of `$:` magic string prefixes
- **Builder Pattern**: `JSExpression` AST nodes for code generation instead of string concatenation
- **Hierarchical Source Mapping**: `MappingTreeNode` provides accurate source-to-generated position tracking
- **Stack-based Scope Management**: `ScopeTracker` properly handles nested scopes and variable shadowing

### Input Format
```hbs
<div class="container">
  {{#if this.isVisible}}
    <Button @onClick={{this.handleClick}}>
      {{this.label}}
    </Button>
  {{/if}}
</div>
```

### Output Format
```javascript
[$_tag('div', [[], [['class', 'container']], []], [
  $_if(
    () => this.isVisible,
    (ctx0) => [$_c(Button, $_args({ onClick: () => this.handleClick }, { default_: false, default: (ctx1) => [() => this.label] }, $_edp), ctx0)],
    () => [],
    this
  )
], this)]
```

---

## 2. Architecture

### Design Principles

1. **Dependency Injection**: All compiler functions receive `CompilerContext` as first parameter
2. **Immutable Types**: Core types like `CompilerFlags`, `SourceRange` are readonly
3. **Single Responsibility**: Each module handles one concern (visiting, serializing, tracking)
4. **No Circular Dependencies**: Visitor registry pattern breaks import cycles

### Data Flow

```
Template String
      │
      ▼
┌─────────────────┐
│  @glimmer/syntax │  ← Parses to ASTv1
└─────────────────┘
      │
      ▼
┌─────────────────┐
│    Visitors     │  ← Converts AST to IR (HBSNode, HBSControlExpression, SerializedValue)
└─────────────────┘
      │
      ▼
┌─────────────────┐
│    Builders     │  ← Converts IR to JSExpression AST
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   Serializers   │  ← Converts JSExpression to JavaScript strings
└─────────────────┘
      │
      ▼
┌─────────────────┐
│   CodeEmitter   │  ← Tracks positions for source mapping
└─────────────────┘
      │
      ▼
JavaScript + SourceMap
```

---

## 3. Module Structure

```
plugins/compiler/
├── index.ts              # Public API exports
├── compile.ts            # Main compile() entry point
├── context.ts            # CompilerContext and Formatter
├── types.ts              # Core type definitions
├── adapter.ts            # V1 API compatibility layer
│
├── visitors/
│   ├── index.ts          # visit() dispatcher
│   ├── element.ts        # Element/component visiting
│   ├── block.ts          # Block statement visiting (if, each, let)
│   ├── mustache.ts       # Mustache expression visiting
│   ├── text.ts           # Text node visiting
│   └── utils.ts          # Path resolution, node ranges
│
├── serializers/
│   ├── index.ts          # serialize() dispatcher
│   ├── value.ts          # SerializedValue → JavaScript
│   ├── element.ts        # HBSNode → $_tag/$_c calls
│   ├── control.ts        # HBSControlExpression → $_if/$_each calls
│   └── symbols.ts        # Runtime symbol constants
│
├── builder/
│   ├── index.ts          # Builder exports
│   ├── types.ts          # JSExpression type definitions
│   ├── builders.ts       # B.* factory functions
│   └── serialize.ts      # serializeJS() function
│
├── tracking/
│   ├── index.ts          # Tracking exports
│   ├── scope-tracker.ts  # ScopeTracker class
│   └── code-emitter.ts   # CodeEmitter class
│
├── sourcemap/
│   └── index.ts          # V3 sourcemap generation
│
└── formatting/
    └── index.ts          # Prettier integration
```

---

## 4. Type System

### 4.1 SerializedValue (Intermediate Representation)

Replaces V1's `$:` magic string prefix with discriminated union types:

```typescript
type SerializedValue =
  | LiteralValue      // { kind: 'literal', value: string | number | boolean | null | undefined }
  | PathValue         // { kind: 'path', expression: string, isArg: boolean }
  | SpreadValue       // { kind: 'spread', expression: string }
  | RawValue          // { kind: 'raw', code: string }
  | HelperValue       // { kind: 'helper', name: string, positional: [], named: Map }
  | GetterValue;      // { kind: 'getter', value: SerializedValue }
```

**Factory Functions:**
```typescript
import { literal, path, spread, raw, helper, getter } from './types';

literal('hello')           // LiteralValue
path('this.name', false)   // PathValue
raw('() => this.x')        // RawValue
getter(path('this.x'))     // GetterValue wrapping PathValue
```

### 4.2 HBSNode (Element/Component IR)

```typescript
interface HBSNode {
  _nodeType: 'element';              // Discriminator
  tag: HBSTag;                       // string | RuntimeTag
  attributes: AttributeTuple[];      // [name, SerializedValue, SourceRange?]
  properties: PropertyTuple[];       // [name, SerializedValue, SourceRange?]
  events: EventTuple[];              // [eventName, SerializedValue, SourceRange?]
  children: HBSChild[];
  blockParams: string[];
  selfClosing: boolean;
  hasStableChild: boolean;
  sourceRange?: SourceRange;
}
```

### 4.3 HBSControlExpression (Control Flow IR)

```typescript
interface HBSControlExpression {
  _nodeType: 'control';              // Discriminator
  type: 'if' | 'each' | 'yield' | 'in-element';
  condition: SerializedValue;
  children: HBSChild[];
  inverse: HBSChild[] | null;
  blockParams: string[];
  key: string | null;                // For each: key expression, for yield: slot name
  isSync: boolean;
  sourceRange?: SourceRange;
}
```

### 4.4 HBSChild (Union Type)

```typescript
type HBSChild =
  | string                  // Text content
  | SerializedValue         // Expression
  | HBSNode                 // Element/component
  | HBSControlExpression;   // Control flow
```

### 4.5 Type Guards

```typescript
isHBSNode(value)              // Checks _nodeType === 'element'
isHBSControlExpression(value) // Checks _nodeType === 'control'
isSerializedValue(value)      // Checks 'kind' property exists
isTextChild(child)            // typeof child === 'string'
isRuntimeTag(tag)             // tag.type === 'runtime'
```

---

## 5. Compilation Flow

### 5.1 Entry Point

```typescript
function compile(template: string, options: CompileOptions = {}): CompileResult
```

### 5.2 CompileOptions

| Option | Type | Description |
|--------|------|-------------|
| `flags` | `Partial<CompilerFlags>` | Compiler behavior flags |
| `bindings` | `ReadonlySet<string>` | Known component/helper names |
| `filename` | `string` | Source filename for errors |
| `format` | `FormatOptions \| boolean` | Output formatting |
| `sourceMap` | `SourceMapOptions \| boolean` | Source map generation |

### 5.3 CompileResult

```typescript
interface CompileResult {
  code: string;                      // Generated JavaScript
  mappingTree: MappingTreeNode;      // Source mapping tree
  errors: CompilerError[];           // Compilation errors
  warnings: CompilerWarning[];       // Compilation warnings
  bindings: ReadonlySet<string>;     // All visible bindings
  sourceMap?: SourceMapV3;           // V3 sourcemap (if enabled)
}
```

### 5.4 Compilation Steps

1. **Create Context**: `createContext(template, options)`
2. **Initialize Visitors**: `initializeVisitors(ctx, visit, visitChildren)`
3. **Parse Template**: `preprocess(template)` from @glimmer/syntax
4. **Visit AST**: `visitChildren(ctx, ast.body)` → `HBSChild[]`
5. **Build Expressions**: `build(ctx, child, 'this')` → `JSExpression`
6. **Serialize**: `serializeJS(expr)` → JavaScript string
7. **Generate Sourcemap**: `generateSourceMap(mappingTree, ...)`

---

## 6. Visitor Pattern

### 6.1 Main Dispatcher

```typescript
function visit(ctx: CompilerContext, node: ASTv1.Node, wrap = true): VisitResult
```

The `wrap` parameter controls whether expressions are wrapped in getters for reactivity.

### 6.2 Node Type Routing

| Node Type | Handler | Output |
|-----------|---------|--------|
| `UndefinedLiteral` | inline | `LiteralValue` |
| `NullLiteral` | inline | `LiteralValue` |
| `BooleanLiteral` | inline | `LiteralValue` |
| `NumberLiteral` | inline | `LiteralValue` |
| `StringLiteral` | inline | `LiteralValue` |
| `TextNode` | `visitText()` | `string \| null` |
| `PathExpression` | `visitPathExpression()` | `PathValue` |
| `ConcatStatement` | `visitConcatStatement()` | `RawValue` |
| `SubExpression` | `visitSubExpression()` | `HelperValue \| GetterValue` |
| `MustacheStatement` | `visitMustache()` | `SerializedValue \| HBSControlExpression` |
| `BlockStatement` | `visitBlock()` | `HBSControlExpression \| RawValue` |
| `ElementNode` | `visitElement()` | `HBSNode` |

### 6.3 Path Resolution

```typescript
function resolvePath(ctx: CompilerContext, path: string): string
```

**Resolution Rules:**

| Input | Output |
|-------|--------|
| `@arg` | `this[$args].arg` |
| `@arg.foo.bar` | `this[$args].arg?.foo?.bar` |
| `this.foo.bar` | `this.foo.bar` |
| `blockParam` (in scope) | `blockParam` |
| `Component` (in bindings) | `Component` |

### 6.4 Visitor Children

```typescript
function visitChildren(ctx: CompilerContext, children: ASTv1.Statement[]): HBSChild[]
```

- Filters whitespace-only text nodes
- Tracks visited nodes in `ctx.seenNodes`
- Returns array of `HBSChild`

---

## 7. Builder Pattern

### 7.1 JSExpression Types

```typescript
type JSExpression =
  | JSLiteral           // Primitives: string, number, boolean, null, undefined
  | JSIdentifier        // Variable reference: foo
  | JSMemberExpression  // Property access: foo.bar
  | JSCallExpression    // Function call: foo(args)
  | JSMethodCall        // Method call: obj.method(args)
  | JSArrowFunction     // Arrow: (x) => body
  | JSArrayExpression   // Array: [a, b, c]
  | JSObjectExpression  // Object: { key: value }
  | JSSpreadElement     // Spread: ...expr
  | JSRaw               // Raw code string
  | JSRuntimeRef        // Runtime reference (not wrapped)
  | JSReactiveGetter    // Getter wrapper: () => expr
  | JSMethodBinding     // Method binding: obj.method.bind(obj, args)
  | JSIife;             // IIFE: (() => { ... })()
```

### 7.2 Builder Factory Functions (B.*)

```typescript
import { B } from './builder';

// Literals
B.string('hello')        // JSLiteral { kind: 'string', value: 'hello' }
B.num(42)                // JSLiteral { kind: 'number', value: 42 }
B.bool(true)             // JSLiteral { kind: 'boolean', value: true }
B.nil()                  // JSLiteral { kind: 'null' }
B.undef()                // JSLiteral { kind: 'undefined' }

// Identifiers and paths
B.id('foo')              // JSIdentifier
B.member(B.id('a'), 'b') // JSMemberExpression: a.b
B.path('this.foo.bar')   // Parses dotted path

// Calls
B.call('fn', [B.num(1)]) // JSCallExpression: fn(1)
B.methodCall(obj, 'method', []) // JSMethodCall: obj.method()

// Functions
B.arrow(['x'], body)     // JSArrowFunction: (x) => body
B.getter(expr)           // JSReactiveGetter: () => expr

// Arrays and objects
B.array([...])           // JSArrayExpression
B.object([B.prop('key', val)]) // JSObjectExpression
B.emptyArray()           // []
B.emptyObject()          // {}

// Runtime references
B.runtimeRef('this.x')   // Not wrapped in getter
B.reactiveGetter(expr)   // () => expr (for reactive paths)

// Raw code
B.raw('complex code')    // JSRaw - emitted as-is
```

### 7.3 Serialization

```typescript
import { serializeJS } from './builder';

const expr = B.call('$_tag', [B.string('div'), B.array([])]);
const code = serializeJS(expr);  // '$_tag("div", [])'
```

---

## 8. Serializers

### 8.1 Value Serialization

```typescript
function serializeValue(ctx: CompilerContext, value: SerializedValue, ctxName: string): string
function buildValue(ctx: CompilerContext, value: SerializedValue, ctxName: string): JSExpression
```

**Serialization by Kind:**

| Kind | Output |
|------|--------|
| `literal` | `"string"`, `42`, `true`, `null`, `undefined` |
| `path` | In compat mode: `() => this.foo` Otherwise: `this.foo` |
| `spread` | `...expr` |
| `raw` | Code as-is |
| `helper` | `$__helperName(args)` or `$_maybeHelper(...)` |
| `getter` | `() => innerValue` |

### 8.2 Element Serialization

```typescript
function serializeElement(ctx: CompilerContext, node: HBSNode, ctxName: string): string
function buildElement(ctx: CompilerContext, node: HBSNode, ctxName: string): JSExpression
```

**Output Format:**
```javascript
$_tag('tagName', [props, attrs, events], [children], ctx)
```

### 8.3 Component Serialization

```typescript
function serializeComponent(ctx: CompilerContext, node: HBSNode, ctxName: string): string
function buildComponent(ctx: CompilerContext, node: HBSNode, ctxName: string): JSExpression
```

**Output Format:**
```javascript
$_c(ComponentName, $_args(argsObj, slotsObj, propsArray), ctx)
// or for dynamic components:
$_dc(() => Dynamic.Component, $_args(...), ctx)
```

### 8.4 Control Serialization

```typescript
function serializeControl(ctx: CompilerContext, node: HBSControlExpression, ctxName: string): string
function buildControl(ctx: CompilerContext, node: HBSControlExpression, ctxName: string): JSExpression
```

**Output by Type:**

| Type | Output |
|------|--------|
| `if` | `$_if(condition, thenFn, elseFn, ctx)` |
| `each` | `$_each(array, itemFn, key, ctx)` or `$_eachSync(...)` |
| `yield` | `$_slot(slotName, paramsFn, $slots, ctx)` |
| `in-element` | `$_inElement(target, contentFn, ctx)` |

---

## 9. Scope Tracking

### 9.1 ScopeTracker

Stack-based scope management replacing V1's flat `Set<string>`:

```typescript
class ScopeTracker {
  // Scope management
  enterScope(name: string): void
  exitScope(): void
  withScope<T>(name: string, fn: () => T): T

  // Binding management
  addBinding(name: string, info: BindingInfo): void
  removeBinding(name: string): boolean

  // Binding resolution
  resolve(name: string): BindingInfo | undefined
  hasBinding(name: string): boolean
  hasLocalBinding(name: string): boolean
  getAllBindingNames(): Set<string>
}
```

### 9.2 BindingInfo

```typescript
interface BindingInfo {
  kind: 'component' | 'helper' | 'modifier' | 'block-param' | 'let-binding' | 'arg' | 'this';
  name: string;
  originalName?: string;    // For renamed bindings
  sourceRange?: SourceRange;
}
```

### 9.3 Scope Usage Example

```typescript
// Enter each block scope
ctx.scopeTracker.enterScope('each');
ctx.scopeTracker.addBinding('item', { kind: 'block-param', name: 'item' });
ctx.scopeTracker.addBinding('index', { kind: 'block-param', name: 'index' });

// Visit children (item and index are in scope)
const children = visitChildren(ctx, blockBody);

// Exit scope
ctx.scopeTracker.exitScope();
```

---

## 10. Source Mapping

### 10.1 MappingTreeNode

Hierarchical source mapping structure:

```typescript
interface MappingTreeNode {
  sourceRange: SourceRange;      // Position in original template
  generatedRange: GeneratedRange; // Position in generated code
  sourceNode: MappingSource;     // Node type (for debugging)
  children: MappingTreeNode[];   // Nested mappings
}

type MappingSource =
  | 'Template' | 'ElementNode' | 'TextNode' | 'MustacheStatement'
  | 'BlockStatement' | 'PathExpression' | 'StringLiteral' | 'NumberLiteral'
  | 'BooleanLiteral' | 'NullLiteral' | 'UndefinedLiteral' | 'SubExpression'
  | 'Hash' | 'HashPair' | 'AttrNode' | 'ConcatStatement' | 'ComponentNode'
  | 'ControlNode' | 'SlotNode' | 'Synthetic';
```

### 10.2 CodeEmitter

Tracks code generation with source positions:

```typescript
class CodeEmitter {
  emit(code: string): void
  emitMapped(code: string, sourceRange: SourceRange, sourceNode: MappingSource): void
  pushScope(sourceRange: SourceRange, sourceNode: MappingSource): void
  popScope(): void
  getCode(): string
  getMappingTree(): MappingTreeNode
}
```

### 10.3 V3 Sourcemap Generation

```typescript
function generateSourceMap(
  mappingTree: MappingTreeNode,
  source: string,
  generatedCode: string,
  options: SourceMapOptions
): SourceMapV3

function appendInlineSourceMap(
  code: string,
  mappingTree: MappingTreeNode,
  source: string,
  options: SourceMapOptions
): string  // Code with //# sourceMappingURL=... comment
```

---

## 11. Runtime Symbols

### 11.1 Core Symbols

| Symbol | Runtime Function | Description |
|--------|-----------------|-------------|
| `$_tag` | DOM element creation | Creates HTML/SVG/MathML elements |
| `$_c` | Component creation | Creates static component instances |
| `$_dc` | Dynamic component | Creates component from reactive reference |
| `$_fin` | Finalize component | Returns roots array from component |
| `$_args` | Args wrapper | Wraps component arguments (compat mode) |
| `$_edp` | Empty DOM props | `[[], [], []]` constant |
| `$_style` | Style modifier | Sets style.* bindings |

### 11.2 Control Flow Symbols

| Symbol | Description |
|--------|-------------|
| `$_if` | Conditional rendering |
| `$_each` | List rendering with destructors |
| `$_eachSync` | Synchronous list rendering |
| `$_slot` | Slot/yield rendering |
| `$_inElement` | Portal rendering |

### 11.3 Namespace Providers

| Symbol | Description |
|--------|-------------|
| `$_HTMLProvider` | HTML namespace context |
| `$_SVGProvider` | SVG namespace context |
| `$_MathMLProvider` | MathML namespace context |

### 11.4 Accessor Symbols

| Symbol | Description |
|--------|-------------|
| `$_GET_ARGS` | Extract args from arguments |
| `$_GET_SLOTS` | Extract slots from arguments |
| `$_GET_FW` | Get forwarded attributes |
| `$_TO_VALUE` | Convert to reactive value |
| `$args` | Args property key |

### 11.5 Built-in Helper Symbols

| Template Name | Symbol | Description |
|---------------|--------|-------------|
| `if` | `$__if` | Conditional helper |
| `eq` | `$__eq` | Equality comparison |
| `not` | `$__not` | Logical NOT |
| `or` | `$__or` | Logical OR |
| `and` | `$__and` | Logical AND |
| `array` | `$__array` | Array creation |
| `hash` | `$__hash` | Object creation |
| `fn` | `$__fn` | Function binding |
| `log` | `$__log` | Console logging |
| `debugger` | `$__debugger` | Debugger breakpoint |

### 11.6 Dynamic Resolution Symbols

| Symbol | Description |
|--------|-------------|
| `$_maybeHelper` | Runtime helper resolution |
| `$_maybeModifier` | Runtime modifier resolution |
| `$_componentHelper` | `(component ...)` helper |
| `$_helperHelper` | `(helper ...)` helper |
| `$_modifierHelper` | `(modifier ...)` helper |
| `$_hasBlock` | Check if slot exists |
| `$_hasBlockParams` | Check if slot has block params |

---

## 12. Compiler Flags

### 12.1 CompilerFlags

```typescript
interface CompilerFlags {
  IS_GLIMMER_COMPAT_MODE: boolean;   // Wrap paths in getters (default: true)
  WITH_HELPER_MANAGER: boolean;      // Use $_maybeHelper for unknown helpers
  WITH_MODIFIER_MANAGER: boolean;    // Use $_maybeModifier for unknown modifiers
}
```

### 12.2 IS_GLIMMER_COMPAT_MODE

When `true` (default), path expressions are wrapped in reactive getters:

```javascript
// Template: {{this.name}}
// Compat mode ON:  () => this.name
// Compat mode OFF: this.name
```

### 12.3 WITH_HELPER_MANAGER

When `true`, unknown helpers use runtime resolution:

```javascript
// Template: {{unknown-helper arg}}
// Flag ON:  $_maybeHelper("unknown-helper", [arg], { $_scope: ... })
// Flag OFF: unknownHelper(arg)
```

---

## 13. Control Flow Compilation

### 13.1 If Block

**Template:**
```hbs
{{#if this.condition}}
  <div>True</div>
{{else}}
  <div>False</div>
{{/if}}
```

**Output:**
```javascript
$_if(
  () => this.condition,        // Reactive condition
  (ctx0) => [$_tag('div', ...)], // True branch
  (ctx0) => [$_tag('div', ...)], // False branch
  this                          // Context
)
```

### 13.2 Unless Block

Compiled as inverted `if` (children and inverse swapped):

```hbs
{{#unless this.hidden}}content{{/unless}}
```

### 13.3 Each Block

**Template:**
```hbs
{{#each this.items as |item index|}}
  <li>{{item.name}}</li>
{{/each}}
```

**Output:**
```javascript
$_each(
  () => this.items,             // Reactive array
  (item, index, ctx0) => [      // Item renderer
    $_tag('li', [...], [() => item.name], ctx0)
  ],
  null,                         // Key (or key expression)
  this                          // Context
)
```

**With key:**
```hbs
{{#each this.items key="id" as |item|}}
```
```javascript
$_each(() => this.items, (...) => [...], item => item.id, this)
```

**Sync mode:**
```hbs
{{#each this.items sync=true as |item|}}
```
Uses `$_eachSync` for synchronous rendering without destructors.

### 13.4 Let Block

**Template:**
```hbs
{{#let (helper) as |result|}}
  {{result}}
{{/let}}
```

**Output:**
```javascript
...(() => {
  let self = this;
  let Let_result_scope0 = () => helper();
  return [Let_result_scope0()]
})()
```

### 13.5 In-Element Block

**Template:**
```hbs
{{#in-element this.portalTarget}}
  <div>Portal content</div>
{{/in-element}}
```

**Output:**
```javascript
$_inElement(
  () => this.portalTarget,
  (ctx0) => [$_tag('div', ...)],
  this
)
```

---

## 14. Component Compilation

### 14.1 Static Component

**Template:**
```hbs
<MyComponent @value={{this.x}} class="foo">
  Content
</MyComponent>
```

**Output:**
```javascript
$_c(
  MyComponent,
  $_args(
    { value: () => this.x },     // Args object
    {                             // Slots object
      default_: false,
      default: (ctx0) => ["Content"]
    },
    [[], [['class', 'foo']], []] // Props array
  ),
  this
)
```

### 14.2 Dynamic Component

**Template:**
```hbs
<this.Component @value={{this.x}} />
```

**Output:**
```javascript
$_dc(
  () => this.Component,          // Reactive component reference
  $_args({ value: () => this.x }, {}, $_edp),
  this
)
```

### 14.3 Named Slots

**Template:**
```hbs
<Card>
  <:header>Title</:header>
  <:body>Content</:body>
</Card>
```

**Output:**
```javascript
$_c(Card, $_args({}, {
  header_: false,
  header: (ctx0) => ["Title"],
  body_: false,
  body: (ctx0) => ["Content"]
}, $_edp), this)
```

### 14.4 Block Params on Slots

**Template:**
```hbs
<List @items={{this.data}} as |item|>
  {{item.name}}
</List>
```

**Output:**
```javascript
$_c(List, $_args(
  { items: () => this.data },
  {
    default_: true,              // Has block params
    default: (ctx0, item) => [() => item.name]
  },
  $_edp
), this)
```

### 14.5 Yield/Outlet

**Template (inside component):**
```hbs
{{yield this.item}}
{{yield to="footer" this.footerData}}
```

**Output:**
```javascript
$_slot('default', () => [this.item], $slots, this)
$_slot('footer', () => [this.footerData], $slots, this)
```

---

## 15. Event and Modifier Handling

### 15.1 Native Events (on modifier)

**Template:**
```hbs
<button {{on "click" this.handleClick}}>Click</button>
```

**Output:**
```javascript
$_tag('button', [[], [], [['click', ($e, $n) => this.handleClick($e, $n)]]], [...], this)
```

**With extra args:**
```hbs
<button {{on "click" this.handleClick this.item}}>
```
```javascript
[['click', ($e, $n) => this.handleClick($e, $n, this.item)]]
```

### 15.2 Custom Modifiers

**Template:**
```hbs
<div {{my-modifier arg1 key=value}}></div>
```

**Output (WITH_MODIFIER_MANAGER=false):**
```javascript
[['0', ($n) => myModifier($n, arg1, { key: value })]]
```

**Output (WITH_MODIFIER_MANAGER=true):**
```javascript
[['0', ($n) => $_maybeModifier(myModifier, $n, [arg1], { key: value })]]
```

### 15.3 Style Bindings

**Template:**
```hbs
<div style.color={{this.textColor}}></div>
```

**Output:**
```javascript
[['0', ($n) => $_style($n, 'color', this.textColor)]]
```

### 15.4 @oncreated and @textContent

**Template:**
```hbs
<div @oncreated={{this.onMount}} @textContent={{this.text}}></div>
```

**Output:**
```javascript
$_tag('div', [[], [], [
  ['0', ($n) => this.onMount($n)],     // ON_CREATED event
  ['1', () => this.text]                // TEXT_CONTENT event
]], [], this)
```

### 15.5 Event Type Constants

| Event Type | Value | Description |
|------------|-------|-------------|
| `ON_CREATED` | `'0'` | Modifier/lifecycle hook |
| `TEXT_CONTENT` | `'1'` | Text content setter |

---

## Appendix A: Complete Symbol Reference

```typescript
const SYMBOLS = {
  // Namespace providers
  HTML_NAMESPACE: '$_HTMLProvider',
  SVG_NAMESPACE: '$_SVGProvider',
  MATH_NAMESPACE: '$_MathMLProvider',

  // Core DOM functions
  TAG: '$_tag',
  FINALIZE_COMPONENT: '$_fin',
  EMPTY_DOM_PROPS: '$_edp',

  // Control flow
  IF: '$_if',
  EACH: '$_each',
  EACH_SYNC: '$_eachSync',
  SLOT: '$_slot',
  IN_ELEMENT: '$_inElement',

  // Component helpers
  COMPONENT: '$_c',
  DYNAMIC_COMPONENT: '$_dc',
  ARGS: '$_args',

  // Accessors
  GET_SLOTS: '$_GET_SLOTS',
  GET_ARGS: '$_GET_ARGS',
  GET_FW: '$_GET_FW',
  TO_VALUE: '$_TO_VALUE',
  STYLE: '$_style',
  ARGS_PROPERTY: '$args',

  // Built-in helpers
  IF_HELPER: '$__if',
  EQ: '$__eq',
  NOT: '$__not',
  OR: '$__or',
  AND: '$__and',
  ARRAY: '$__array',
  HASH: '$__hash',
  FN: '$__fn',
  DEBUGGER: '$__debugger',
  LOG: '$__log',

  // Dynamic resolution
  MAYBE_HELPER: '$_maybeHelper',
  MAYBE_MODIFIER: '$_maybeModifier',
  COMPONENT_HELPER: '$_componentHelper',
  HELPER_HELPER: '$_helperHelper',
  MODIFIER_HELPER: '$_modifierHelper',
  HAS_BLOCK: '$_hasBlock',
  HAS_BLOCK_PARAMS: '$_hasBlockParams',

  // Misc
  UCW: '$_ucw',
  TEMPLATE: '$template',
  SCOPE_KEY: '$_scope',
};

const EVENT_TYPE = {
  ON_CREATED: '0',
  TEXT_CONTENT: '1',
};
```

---

## Appendix B: Migration from V1

### Key API Changes

| V1 | V2 |
|----|-----|
| `convert(seenNodes, flags, bindings)` | `compile(template, options)` |
| Global `bindings` Set | `ctx.scopeTracker` |
| `$:` magic prefix | `SerializedValue` types |
| String concatenation | `B.*` builders + `serializeJS()` |

### Backward Compatibility

The adapter module (`adapter.ts`) provides V1-compatible APIs:

```typescript
import { templateToTypescript } from './compiler/adapter';

// V1-style call (still works)
const result = templateToTypescript(template, flags, bindings);
```

---

*This specification documents the Glimmer-Next compiler V2 architecture as implemented in `plugins/compiler/`.*
