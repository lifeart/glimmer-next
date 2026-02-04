# GXT Runtime Compiler

The runtime compiler enables compiling Glimmer/Handlebars templates to executable JavaScript at runtime in the browser. This is useful for dynamic templates, CMS-driven content, or development tools.

## Table of Contents

- [When to Use](#when-to-use)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [template](#template)
  - [createCompiler](#createcompiler)
  - [compileTemplate](#compiletemplate)
  - [compile](#compile)
  - [createTemplateFactory](#createtemplatefactory)
- [Globals Setup](#globals-setup)
  - [How It Works](#how-it-works)
  - [GXT_RUNTIME_SYMBOLS](#gxt_runtime_symbols)
  - [setupGlobalScope](#setupglobalscope)
  - [isGlobalScopeReady](#isglobalscopeready)
  - [Manual Setup](#manual-setup)
- [Configuration](#configuration)
- [Working with Scope](#working-with-scope)
- [Error Handling](#error-handling)
- [Security Considerations](#security-considerations)
- [Performance](#performance)
- [Troubleshooting](#troubleshooting)

---

## When to Use

| Scenario | Recommended Approach |
|----------|---------------------|
| Static templates known at build time | Build-time compilation (default) |
| Templates from CMS/database | Runtime compiler |
| User-generated templates | Runtime compiler |
| Development tools / playgrounds | Runtime compiler |
| Hot reloading custom templates | Runtime compiler |

**Build-time compilation** is always preferred when possible because:
- Zero runtime compilation overhead
- Smaller bundle (no compiler in browser)
- Better error messages at build time
- Tree-shaking of unused template code

**Runtime compilation** is necessary when:
- Template content is not known until runtime
- Templates are loaded dynamically from external sources
- Building development tools or template editors

---

## Installation

The runtime compiler is included in the `@lifeart/gxt` package as a separate entry point:

```typescript
import { createCompiler } from '@lifeart/gxt/runtime-compiler';
```

This entry point is tree-shaken from the main bundle - importing `@lifeart/gxt` does NOT include the runtime compiler.

---

## Quick Start

### Basic Usage

```typescript
import { createCompiler } from '@lifeart/gxt/runtime-compiler';
import { Button, Card } from './components';

// 1. Create a compiler with your components in scope
const compile = createCompiler({ Button, Card });

// 2. Compile templates - they can reference Button and Card
const buttonTemplate = compile('<Button @label="Click me" />');
const cardTemplate = compile('<Card @title={{this.title}}><p>Content</p></Card>');

// 3. Use in a component
class MyComponent {
  title = 'Hello';

  template = buttonTemplate; // or use directly
}
```

### One-off Compilation

For single templates without reusable scope:

```typescript
import { compileTemplate } from '@lifeart/gxt/runtime-compiler';

const result = compileTemplate('<div class="greeting">Hello, {{this.name}}!</div>');

if (result.errors.length === 0) {
  const templateFn = result.templateFn;
  // Use templateFn.call(context) to render
}
```

---

## API Reference

### template

Creates a universal template function for class-based or template-only components. **Recommended for component templates.**

```typescript
function template(
  templateSource: string,
  options?: TemplateOptions
): UniversalTemplate;
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `templateSource` | `string` | Template source code |
| `options` | `TemplateOptions` | Optional configuration |

#### Options

```typescript
interface TemplateOptions {
  /** Components, helpers, and values available in the template */
  scope?: Record<string, unknown>;

  /** Function to resolve unknown bindings at runtime. Use arguments[0] to avoid shadowing. */
  eval?: (...args: string[]) => unknown;

  /** Additional known bindings beyond scope keys */
  bindings?: Set<string>;

  /** Compiler flags */
  flags?: Partial<Flags>;

  /** Additional scope values */
  scopeValues?: Record<string, unknown>;
}
```

#### The `eval` Option

The `eval` option enables dynamic resolution of unknown bindings at runtime. This is useful when:
- Template variables are defined in the lexical scope of the calling code
- You need to access variables that aren't known at compile time
- Building REPL-style interfaces or template editors

```typescript
import { template } from '@lifeart/gxt/runtime-compiler';

// Define a variable in the outer scope
const greeting = 'Hello, World!';

// Create template with eval to access outer scope
const MyTemplate = template('<div>{{greeting}}</div>', {
  eval() {
    return eval(arguments[0]); // Resolves 'greeting' from outer scope
  }
});

// The template will render: <div>Hello, World!</div>
```

> **Important:** Always use `arguments[0]` instead of a named parameter like `eval(name)`. A named parameter would shadow any outer variable with the same name, making it impossible to resolve. For example, `eval(name) { return eval(name); }` would always return the parameter itself when resolving `{{name}}`.

#### How `eval` Works

1. When the template encounters an unknown binding (not in `scope` or `bindings`), it calls `$_maybeHelper`
2. `$_maybeHelper` checks if an `eval` function is available
3. If yes, it calls `eval(bindingName)` to resolve the value
4. If the result is a function (helper), it's called with any provided arguments

#### Performance Note: `WITH_EVAL_SUPPORT` Optimization

When you use the `eval` option, the compiler automatically sets `WITH_EVAL_SUPPORT: true`. This flag:
- Passes component context to `$_maybeHelper` for eval resolution
- Enables deferred eval resolution in control flow blocks (`{{#if}}`, `{{#each}}`)

**Without `eval` option** (default): Context is NOT passed, resulting in smaller generated code:
```javascript
// Generated code without eval
$_maybeHelper("unknownBinding", [])
```

**With `eval` option**: Context IS passed for eval access:
```javascript
// Generated code with eval
$_maybeHelper("unknownBinding", [], this)
```

This optimization reduces bundle size when eval isn't needed.

#### Example: Class-based Component

```typescript
import { Component, $template } from '@lifeart/gxt';
import { template } from '@lifeart/gxt/runtime-compiler';
import { Card } from './components';

class MyComponent extends Component {
  message = 'Hello!';

  [$template] = template('<Card @title={{this.message}} />', {
    scope: { Card }
  });
}
```

#### Example: Template-only Component with Eval

```typescript
import { template } from '@lifeart/gxt/runtime-compiler';

// Variables in outer scope
const formatDate = (d: Date) => d.toLocaleDateString();
const title = 'Dashboard';

// Template can access these via eval
const Dashboard = template(`
  <div class="dashboard">
    <h1>{{title}}</h1>
    <p>Last updated: {{formatDate now}}</p>
  </div>
`, {
  eval(name) {
    return eval(name);
  }
});
```

#### Example: Reactive Values with Eval

```typescript
import { cell } from '@lifeart/gxt';
import { template } from '@lifeart/gxt/runtime-compiler';

const countCell = cell(0);

const Counter = template(`
  <button {{on "click" increment}}>Count: {{count.value}}</button>
`, {
  eval(name) {
    const count = countCell;
    const increment = () => countCell.update(c => c + 1);
    return eval(name);
  }
});
```

#### Example: Deferred Rendering with Eval

Eval works correctly even when content renders later (e.g., inside `{{#if}}` that becomes true):

```typescript
import { cell } from '@lifeart/gxt';
import { template } from '@lifeart/gxt/runtime-compiler';

const showContent = cell(false);
const secretMessage = 'Revealed!';

const Revealer = template(`
  {{#if @show}}
    <div class="secret">{{secretMessage}}</div>
  {{/if}}
`, {
  eval(name) {
    return eval(name);
  }
});

// When showContent changes to true, secretMessage is resolved via eval
```

---

### createCompiler

Creates a compiler factory bound to a specific scope. **Recommended for most use cases.**

```typescript
function createCompiler(
  scopeValues: Record<string, unknown>,
  options?: CreateCompilerOptions
): ScopedCompiler;
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `scopeValues` | `Record<string, unknown>` | Components, helpers, and values available in templates |
| `options` | `CreateCompilerOptions` | Optional configuration |

#### Options

```typescript
interface CreateCompilerOptions {
  /** Module name for debugging (default: 'runtime-template') */
  moduleName?: string;

  /** Additional known bindings beyond scopeValues keys */
  bindings?: Set<string>;

  /** Compiler flags */
  flags?: Partial<Flags>;

  /** Throw on compilation errors (default: true) */
  throwOnError?: boolean;
}
```

#### Returns: `ScopedCompiler`

```typescript
interface ScopedCompiler {
  // Compile and return template function (throws on error by default)
  (template: string, options?: Partial<CreateCompilerOptions>): TemplateFn;

  // Compile and return full result with metadata
  withMeta(template: string, options?: Partial<CreateCompilerOptions>): RuntimeCompileResult;

  // Read-only view of bound scope
  readonly scope: Readonly<Record<string, unknown>>;

  // Create new compiler with extended scope (immutable)
  extend(additionalScope: Record<string, unknown>): ScopedCompiler;
}
```

#### Example

```typescript
import { createCompiler } from '@lifeart/gxt/runtime-compiler';
import { Button, Input, formatDate } from './lib';

// Create base compiler
const compile = createCompiler({
  Button,
  Input,
  formatDate,
});

// Compile templates
const formTemplate = compile(`
  <form>
    <Input @value={{this.name}} @placeholder="Name" />
    <Button @onClick={{this.submit}}>Submit</Button>
  </form>
`);

// Inspect scope
console.log(Object.keys(compile.scope)); // ['Button', 'Input', 'formatDate']

// Extend for specific features
const adminCompile = compile.extend({
  AdminPanel,
  UserTable,
});

const adminTemplate = adminCompile('<AdminPanel><UserTable @users={{this.users}} /></AdminPanel>');
```

---

### compileTemplate

Low-level compilation function. Returns full result with errors/warnings.

```typescript
function compileTemplate(
  template: string,
  options?: RuntimeCompileOptions
): RuntimeCompileResult;
```

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `template` | `string` | Template source code |
| `options` | `RuntimeCompileOptions` | Compilation options |

#### Options

```typescript
interface RuntimeCompileOptions {
  /** Module name for debugging */
  moduleName?: string;

  /** Known bindings (component/helper names in scope) */
  bindings?: Set<string>;

  /** Compiler flags */
  flags?: Partial<Flags>;

  /** Scope values to inject into template */
  scopeValues?: Record<string, unknown>;
}
```

#### Returns

```typescript
interface RuntimeCompileResult {
  /** The compiled template function */
  templateFn: (this: any, ...args: any[]) => any;

  /** Generated JavaScript code (for debugging) */
  code: string;

  /** Compilation errors */
  errors: Array<{ message: string; code: string; line?: number; column?: number }>;

  /** Compilation warnings */
  warnings: Array<{ message: string; code: string }>;
}
```

#### Example

```typescript
import { compileTemplate } from '@lifeart/gxt/runtime-compiler';

const result = compileTemplate('<div>{{this.message}}</div>', {
  moduleName: 'greeting-template',
});

if (result.errors.length > 0) {
  console.error('Compilation failed:', result.errors);
} else {
  console.log('Generated code:', result.code);
  const html = result.templateFn.call({ message: 'Hello!' });
}
```

---

### compile

Convenience function that compiles and returns just the template function. Throws on errors.

```typescript
function compile(
  template: string,
  options?: RuntimeCompileOptions
): TemplateFn;
```

#### Example

```typescript
import { compile } from '@lifeart/gxt/runtime-compiler';

try {
  const templateFn = compile('<div>{{this.name}}</div>');
  // Use templateFn
} catch (error) {
  console.error('Compilation failed:', error.message);
}
```

---

### createTemplateFactory

Creates an Ember-compatible template factory object.

```typescript
function createTemplateFactory(
  template: string,
  options?: RuntimeCompileOptions
): TemplateFactory;
```

#### Returns

```typescript
interface TemplateFactory {
  __gxtCompiled: true;
  __gxtRuntimeCompiled: true;
  moduleName: string;
  render(context: any, target: Element): { nodes: Node[]; ctx: any };
}
```

#### Example

```typescript
import { createTemplateFactory } from '@lifeart/gxt/runtime-compiler';

const factory = createTemplateFactory('<div>{{this.title}}</div>', {
  moduleName: 'my-component',
});

// Render to DOM
const container = document.getElementById('app');
const { nodes } = factory.render({ title: 'Hello' }, container);
```

---

## Globals Setup

Runtime-compiled templates execute code that references GXT runtime functions like `$_tag`, `$_c`, `$_if`, etc. These must be available on `globalThis` for the compiled code to work.

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Compilation Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. compileTemplate('<div>{{this.name}}</div>')             │
│                         │                                    │
│                         ▼                                    │
│  2. Check: isGlobalScopeReady()?                            │
│                         │                                    │
│            ┌───────────┴───────────┐                        │
│            │ No                    │ Yes                     │
│            ▼                       ▼                         │
│  3. setupGlobalScope()      (skip setup)                    │
│     - Sets globalThis.$_tag                                 │
│     - Sets globalThis.$_c                                   │
│     - Sets globalThis.$_if                                  │
│     - ... (35+ symbols)                                     │
│     - Sets __GXT_RUNTIME_INITIALIZED__ = true               │
│                         │                                    │
│                         ▼                                    │
│  4. Compile template → generates code string                │
│     Output: "[$_tag('div', [...], [...])]"                  │
│                         │                                    │
│                         ▼                                    │
│  5. new Function(code) → creates template function          │
│     Function body references $_tag from globalThis          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key point:** Globals are set up lazily on first compilation, not on module import.

### GXT_RUNTIME_SYMBOLS

All runtime symbols that get added to `globalThis`:

```typescript
import { GXT_RUNTIME_SYMBOLS } from '@lifeart/gxt/runtime-compiler';

// Contains 35+ functions:
console.log(Object.keys(GXT_RUNTIME_SYMBOLS));
// [
//   '$_tag',      // Create DOM elements
//   '$_c',        // Instantiate components
//   '$_if',       // Conditional rendering
//   '$_each',     // List rendering (async)
//   '$_eachSync', // List rendering (sync)
//   '$_slot',     // Slot rendering
//   '$_args',     // Args handling
//   '$_fin',      // Finalize component
//   '$_maybeHelper',   // Runtime helper resolution
//   '$_maybeModifier', // Runtime modifier resolution
//   '$__if',      // Built-in if helper
//   '$__eq',      // Built-in eq helper
//   '$__not',     // Built-in not helper
//   '$__and',     // Built-in and helper
//   '$__or',      // Built-in or helper
//   '$__array',   // Built-in array helper
//   '$__hash',    // Built-in hash helper
//   '$__fn',      // Built-in fn helper
//   '$__log',     // Built-in log helper
//   '$__debugger',// Built-in debugger helper
//   // ... and more
// ]
```

#### Using GXT_RUNTIME_SYMBOLS Directly

For advanced use cases, you can access symbols without global setup:

```typescript
import { GXT_RUNTIME_SYMBOLS } from '@lifeart/gxt/runtime-compiler';

const { $_tag, $_c, $_if } = GXT_RUNTIME_SYMBOLS;

// Use directly (not common, but possible)
const div = $_tag('div', [[], [], []], ['Hello'], context);
```

### setupGlobalScope

Adds all runtime symbols to `globalThis`.

```typescript
function setupGlobalScope(): void;
```

#### What It Does

```typescript
// Simplified implementation:
function setupGlobalScope() {
  const g = globalThis;

  // Add all runtime functions
  g.$_tag = $_tag;
  g.$_c = $_c;
  g.$_if = $_if;
  // ... 30+ more symbols

  // Add special symbols for slots/props access
  g.$SLOTS_SYMBOL = $SLOTS_SYMBOL;  // Symbol('slots')
  g.$PROPS_SYMBOL = $PROPS_SYMBOL;  // Symbol('props')
  g.$args = 'args';                  // String constant

  // Mark as initialized
  g.__GXT_RUNTIME_INITIALIZED__ = true;
}
```

#### When Called

| Scenario | Automatic? |
|----------|------------|
| `compileTemplate()` | Yes - calls if not ready |
| `compile()` | Yes - via compileTemplate |
| `createCompiler()` | Yes - on first compile |
| `createTemplateFactory()` | Yes - via compileTemplate |
| Module import | No - lazy initialization |

### isGlobalScopeReady

Check if globals have been initialized.

```typescript
function isGlobalScopeReady(): boolean;
```

```typescript
import { isGlobalScopeReady } from '@lifeart/gxt/runtime-compiler';

console.log(isGlobalScopeReady()); // false (before any compilation)

// After first compilation...
compileTemplate('<div />');

console.log(isGlobalScopeReady()); // true
```

### Manual Setup

#### When You Need Manual Setup

1. **Testing:** Ensure clean state between tests
2. **Pre-initialization:** Set up before async template loading
3. **Custom environments:** Workers, iframes, etc.

#### Test Isolation

```typescript
import { describe, beforeEach, afterEach } from 'vitest';
import { setupGlobalScope, GXT_RUNTIME_SYMBOLS } from '@lifeart/gxt/runtime-compiler';

describe('My Template Tests', () => {
  beforeEach(() => {
    // Ensure globals are set up before each test
    setupGlobalScope();
  });

  afterEach(() => {
    // Optional: Clean up globals
    const g = globalThis as any;
    delete g.__GXT_RUNTIME_INITIALIZED__;
    Object.keys(GXT_RUNTIME_SYMBOLS).forEach(key => {
      delete g[key];
    });
  });

  test('compiles template', () => {
    // Globals are guaranteed to be ready
  });
});
```

#### Pre-initialization

```typescript
import { setupGlobalScope, compileTemplate } from '@lifeart/gxt/runtime-compiler';

// Initialize immediately (before async operations)
setupGlobalScope();

// Later, templates can compile without setup delay
async function loadAndCompile(url: string) {
  const template = await fetch(url).then(r => r.text());
  return compileTemplate(template); // No setup needed
}
```

#### Web Workers

```typescript
// worker.ts
import { setupGlobalScope, compileTemplate } from '@lifeart/gxt/runtime-compiler';

// Workers have their own globalThis
setupGlobalScope();

self.onmessage = (e) => {
  const result = compileTemplate(e.data.template);
  self.postMessage({ code: result.code, errors: result.errors });
};
```

#### Iframes

```typescript
// In parent window
import { GXT_RUNTIME_SYMBOLS } from '@lifeart/gxt/runtime-compiler';

const iframe = document.createElement('iframe');
document.body.appendChild(iframe);

// Copy symbols to iframe's globalThis
const iframeGlobal = iframe.contentWindow as any;
Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
  iframeGlobal[name] = value;
});
iframeGlobal.__GXT_RUNTIME_INITIALIZED__ = true;

// Now iframe can execute compiled templates
```

### Symbols Reference

| Global | Type | Purpose |
|--------|------|---------|
| `$_tag` | Function | Create DOM elements |
| `$_c` | Function | Instantiate components |
| `$_if` | Function | Conditional rendering |
| `$_each` | Function | Async list iteration |
| `$_eachSync` | Function | Sync list iteration |
| `$_slot` | Function | Render named slots |
| `$_args` | Function | Create args object |
| `$_fin` | Function | Finalize component rendering |
| `$_edp` | Constant | Empty DOM props |
| `$_maybeHelper` | Function | Runtime helper resolution |
| `$_maybeModifier` | Function | Runtime modifier resolution |
| `$_componentHelper` | Function | Component helper currying |
| `$_helperHelper` | Function | Helper currying |
| `$_modifierHelper` | Function | Modifier currying |
| `$_hasBlock` | Function | Check if block exists |
| `$_hasBlockParams` | Function | Check block params |
| `$_inElement` | Function | Render in external element |
| `$_ucw` | Function | Unstable child wrapper |
| `$_dc` | Function | Dynamic component |
| `$_GET_SLOTS` | Function | Get slots from args |
| `$_GET_ARGS` | Function | Get args from context |
| `$_GET_FW` | Function | Get forwarded attrs |
| `$_TO_VALUE` | Function | Resolve to value |
| `$_api` | Function | Get DOM API |
| `$SLOTS_SYMBOL` | Symbol | Key for slots in args |
| `$PROPS_SYMBOL` | Symbol | Key for props in args |
| `$args` | String | Constant 'args' |
| `$__if` | Function | Built-in if helper |
| `$__eq` | Function | Built-in eq helper |
| `$__not` | Function | Built-in not helper |
| `$__and` | Function | Built-in and helper |
| `$__or` | Function | Built-in or helper |
| `$__array` | Function | Built-in array helper |
| `$__hash` | Function | Built-in hash helper |
| `$__fn` | Function | Built-in fn helper |
| `$__log` | Function | Built-in log helper |
| `$__debugger` | Function | Built-in debugger helper |
| `$_HTMLProvider` | Class | HTML DOM provider |
| `$_SVGProvider` | Class | SVG DOM provider |
| `$_MathMLProvider` | Class | MathML DOM provider |
| `__GXT_RUNTIME_INITIALIZED__` | Boolean | Initialization flag |

---

## Configuration

### Compiler Flags

Control compilation behavior via flags:

```typescript
const compile = createCompiler({ Button }, {
  flags: {
    IS_GLIMMER_COMPAT_MODE: true,      // Enable @arg syntax (default: true)
    WITH_EMBER_INTEGRATION: true,       // Ember compatibility (default: true)
    WITH_HELPER_MANAGER: true,          // Helper manager support (default: true)
    WITH_MODIFIER_MANAGER: true,        // Modifier manager support (default: true)
    WITH_EVAL_SUPPORT: false,           // Pass context for eval resolution (default: false)
    TRY_CATCH_ERROR_HANDLING: false,    // Wrap in try-catch (default: false)
  },
});
```

#### Flag Details

| Flag | Default | Description |
|------|---------|-------------|
| `IS_GLIMMER_COMPAT_MODE` | `true` | Enables `@arg` syntax and Glimmer-compatible features |
| `WITH_EMBER_INTEGRATION` | `true` | Enables Ember.js compatibility layer |
| `WITH_HELPER_MANAGER` | `true` | Enables helper manager protocol support |
| `WITH_MODIFIER_MANAGER` | `true` | Enables modifier manager protocol support |
| `WITH_EVAL_SUPPORT` | `false` | Passes context to `$_maybeHelper` for eval-based binding resolution. Automatically enabled when using `template()` with the `eval` option. |
| `TRY_CATCH_ERROR_HANDLING` | `false` | Wraps component rendering in try-catch for error boundaries |

#### `WITH_EVAL_SUPPORT` Flag

This flag controls whether the compiler generates code that passes context to `$_maybeHelper` for unknown bindings. This context is needed for the `eval` option to resolve bindings dynamically.

**When `false` (default):**
- Smaller generated code
- Unknown bindings return the binding name as-is (e.g., `{{foo}}` renders as "foo")
- No eval-based resolution

**When `true`:**
- Passes `this` context to `$_maybeHelper`
- Enables `eval` function to resolve unknown bindings
- Slightly larger generated code

**Automatic behavior:** When using `template(src, { eval: fn })`, the compiler automatically sets `WITH_EVAL_SUPPORT: true`. You don't need to set it manually.

#### `WITH_DYNAMIC_EVAL` Vite Plugin Flag

In addition to the compiler-level `WITH_EVAL_SUPPORT` flag, there is a **Vite plugin flag** `WITH_DYNAMIC_EVAL` that controls whether the runtime eval resolution code is included in the final bundle at all.

```typescript
// vite.config.ts
import { compiler } from '@lifeart/gxt/compiler';

export default defineConfig({
  plugins: [
    compiler('development', {
      flags: {
        WITH_DYNAMIC_EVAL: true, // Include eval resolution code in bundle
      },
    }),
  ],
});
```

**When `false` (default):**
- All eval-related runtime code is tree-shaken from the bundle
- `$_eval` propagation through control flow is removed
- Context detection in `$_maybeHelper` is simplified
- Smaller bundle size for apps that don't use the runtime compiler's `eval` option

**When `true`:**
- Eval resolution code is included in the bundle
- `$_eval` propagation through `{{#if}}`, `{{#each}}`, `{{in-element}}` works
- Required when using `template()` with the `eval` option

**Note:** This is separate from the compiler-level `WITH_EVAL_SUPPORT` flag. `WITH_EVAL_SUPPORT` controls what code the compiler *generates*. `WITH_DYNAMIC_EVAL` controls what code the runtime *includes*. If you use `template()` with the `eval` option, ensure both flags are enabled (the compiler flag is set automatically; the Vite flag must be set manually).

### Bindings

Bindings tell the compiler which identifiers are known components/helpers vs unknown:

```typescript
// Without bindings: MyComponent treated as unknown, uses $_maybeHelper
compile('<MyComponent />');

// With bindings: MyComponent treated as known component
compile('<MyComponent />', { bindings: new Set(['MyComponent']) });
```

When using `createCompiler`, scope keys are automatically added as bindings:

```typescript
const compile = createCompiler({ MyComponent }); // MyComponent is a known binding
```

---

## Working with Scope

### Scope Basics

Scope values are injected into compiled templates via `new Function()`:

```typescript
const compile = createCompiler({
  Button: ButtonComponent,
  formatDate: (d) => d.toLocaleDateString(),
});

// Templates can reference Button and formatDate directly
const template = compile('<Button>{{formatDate(this.date)}}</Button>');
```

### Extending Scope

Use `extend()` to create new compilers with additional scope (immutable pattern):

```typescript
// Base library scope
const libCompile = createCompiler({ Button, Input, Card });

// App-specific extensions
const appCompile = libCompile.extend({
  AppHeader,
  AppFooter,
});

// Feature-specific extensions
const dashboardCompile = appCompile.extend({
  Chart,
  DataTable,
});

// Each compiler has its own scope
console.log(Object.keys(libCompile.scope));       // ['Button', 'Input', 'Card']
console.log(Object.keys(appCompile.scope));       // ['Button', 'Input', 'Card', 'AppHeader', 'AppFooter']
console.log(Object.keys(dashboardCompile.scope)); // [...all above + 'Chart', 'DataTable']
```

### Scope Isolation

Each compiler's scope is frozen and isolated:

```typescript
const compile1 = createCompiler({ A: 1 });
const compile2 = createCompiler({ B: 2 });

// compile1 cannot see B, compile2 cannot see A
// Attempting to modify scope throws an error
compile1.scope.A = 999; // TypeError: Cannot assign to read only property
```

---

## Error Handling

### With createCompiler (default: throws)

```typescript
const compile = createCompiler({});

try {
  compile('<div><span></div>'); // Mismatched tags
} catch (error) {
  console.error(error.message);
  // "Template compilation failed:
  //  Closing tag </div> did not match last open tag <span>"
}
```

### Disable Throwing

```typescript
const compile = createCompiler({}, { throwOnError: false });

const templateFn = compile('<div><span></div>');
// Returns empty function instead of throwing
```

### With compileTemplate (returns errors)

```typescript
const result = compileTemplate('<div><span></div>');

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error(`[${error.code}] ${error.message}`);
    if (error.line) {
      console.error(`  at line ${error.line}, column ${error.column}`);
    }
  }
}
```

### Error Structure

```typescript
interface CompileError {
  message: string;      // Human-readable error message
  code: string;         // Error code (e.g., 'E007')
  line?: number;        // Line number (1-indexed)
  column?: number;      // Column number (1-indexed)
  snippet?: string;     // Code snippet showing error location
  hint?: string;        // Suggestion for fixing
}
```

---

## Security Considerations

### Content Security Policy (CSP)

The runtime compiler uses `new Function()` to create template functions. This requires:

```
Content-Security-Policy: script-src 'unsafe-eval'
```

**If your CSP doesn't allow `unsafe-eval`**, the runtime compiler will not work. Use build-time compilation instead.

### Template Injection

**Never compile untrusted user input directly:**

```typescript
// DANGEROUS - user could inject malicious code
const userTemplate = getUserInput();
compile(userTemplate); // DON'T DO THIS

// SAFER - sanitize or use allowlist
const allowedTemplates = {
  greeting: '<div>Hello, {{this.name}}</div>',
  farewell: '<div>Goodbye, {{this.name}}</div>',
};
const template = allowedTemplates[userChoice];
if (template) {
  compile(template);
}
```

### Scope Injection

Only include trusted values in scope:

```typescript
// DANGEROUS - exposing sensitive functions
const compile = createCompiler({
  fetch: window.fetch,        // Could make arbitrary requests
  localStorage: localStorage, // Could access stored data
});

// SAFER - expose only what templates need
const compile = createCompiler({
  Button,
  formatDate,
  // Only UI components and pure helpers
});
```

### The `eval` Option

**The `eval` option is the most security-sensitive feature of the runtime compiler.** When used, it passes binding names from templates directly to JavaScript's `eval()` function.

**Never use `eval` with untrusted templates:**

```typescript
// DANGEROUS - attacker controls template AND eval is enabled
const userTemplate = getUserInput();
template(userTemplate, {
  eval() { return eval(arguments[0]); } // Full code execution!
});

// The attacker could craft: {{constructor.constructor("malicious code")()}}
```

**Security guidelines for `eval`:**

- Only use `eval` with templates you fully control (hardcoded or from trusted sources)
- Templates using `eval` have the same security posture as directly executing code
- The combination of untrusted templates + `eval` option = arbitrary code execution
- If you need dynamic templates from a CMS, prefer `scope` over `eval` to limit what the template can access

**`globalThis.$_eval` note:** During synchronous rendering, `eval` is stored on `globalThis.$_eval` as a fallback. This is automatically restored after rendering. For deferred rendering (e.g., when `{{#if}}` becomes true later), the eval function is propagated via component instance properties. This design is safe for single-threaded synchronous rendering but is not designed for concurrent async rendering of multiple templates with different eval functions.

---

## Performance

### Compilation Cost

Template compilation is expensive. For best performance:

1. **Compile once, use many times:**
   ```typescript
   // GOOD - compile once
   const template = compile('<Button />');

   // BAD - compiling on every render
   function render() {
     return compile('<Button />'); // Recompiles every time!
   }
   ```

2. **Use createCompiler for multiple templates:**
   ```typescript
   // GOOD - scope computed once
   const compile = createCompiler({ Button, Card });
   const t1 = compile('<Button />');
   const t2 = compile('<Card />');
   ```

3. **Pre-compile if possible:**
   ```typescript
   // Compile during initialization, not during rendering
   const templates = {
     header: compile('<Header />'),
     footer: compile('<Footer />'),
     main: compile('<Main />'),
   };
   ```

### Bundle Size

The runtime compiler adds significant bundle size (~50-100KB minified) because it includes:
- Template parser
- AST transformation
- Code generator
- Runtime symbols

Only import it when needed:

```typescript
// Dynamic import for code splitting
const { createCompiler } = await import('@lifeart/gxt/runtime-compiler');
```

---

## Troubleshooting

### "Template compilation failed"

**Cause:** Syntax error in template.

**Solution:** Check the error message for details:
```typescript
const result = compileTemplate(template);
console.log(result.errors); // Detailed error info
```

### "X is not defined" at runtime

**Cause:** Component/helper not in scope.

**Solution:** Add to scope or bindings:
```typescript
// Add to scope
const compile = createCompiler({ MissingComponent });

// Or add to bindings (if available globally)
compile('<MissingComponent />', { bindings: new Set(['MissingComponent']) });
```

### CSP Error: "Refused to evaluate a string"

**Cause:** Content Security Policy blocks `new Function()`.

**Solution:**
- Add `'unsafe-eval'` to CSP (if acceptable)
- Or use build-time compilation instead

### "setupGlobalScope is not defined"

**Cause:** Importing from wrong entry point.

**Solution:** Import from runtime-compiler:
```typescript
// WRONG
import { setupGlobalScope } from '@lifeart/gxt';

// CORRECT
import { setupGlobalScope } from '@lifeart/gxt/runtime-compiler';
```

### Template works in dev but not in production

**Cause:** Usually minification or CSP differences.

**Solution:**
1. Check CSP headers in production
2. Verify scope values are available (not tree-shaken)
3. Check for minification issues with component names

---

## Full Example

```typescript
import { createCompiler } from '@lifeart/gxt/runtime-compiler';
import { renderComponent } from '@lifeart/gxt';

// Components
class Button {
  static template = /* will be set dynamically */;
  onClick = () => console.log('clicked');
}

class Card {
  static template = /* will be set dynamically */;
  title = 'Default Title';
}

// Helpers
const helpers = {
  uppercase: (str: string) => str.toUpperCase(),
  formatDate: (date: Date) => date.toLocaleDateString(),
};

// Create compiler with all dependencies
const compile = createCompiler({
  Button,
  Card,
  ...helpers,
});

// Compile templates (e.g., from CMS)
const templates = {
  button: compile('<button {{on "click" this.onClick}}>{{yield}}</button>'),
  card: compile(`
    <div class="card">
      <h2>{{uppercase this.title}}</h2>
      <div class="card-body">{{yield}}</div>
    </div>
  `),
};

// Assign templates to components
Button.template = templates.button;
Card.template = templates.card;

// Render application
class App {
  today = new Date();

  static template = compile(`
    <Card @title="Welcome">
      <p>Today is {{formatDate this.today}}</p>
      <Button>Click Me</Button>
    </Card>
  `);
}

renderComponent(App, { element: document.getElementById('app') });
```
