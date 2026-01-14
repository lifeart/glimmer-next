# GXT (Glimmer-Next) Development Guide

This guide provides comprehensive instructions for AI agents and developers on how to write frontend applications using GXT (glimmer-next).

## Table of Contents

1. [Overview](#overview)
2. [Project Setup](#project-setup)
3. [Component Patterns](#component-patterns)
4. [Reactivity System](#reactivity-system)
5. [Template Syntax](#template-syntax)
6. [Control Flow](#control-flow)
7. [Modifiers and Helpers](#modifiers-and-helpers)
8. [Context API](#context-api)
9. [Suspense and Lazy Loading](#suspense-and-lazy-loading)
10. [Testing](#testing)
11. [SSR and Rehydration](#ssr-and-rehydration)
12. [Architecture Patterns](#architecture-patterns)
13. [Best Practices](#best-practices)
14. [API Reference](#api-reference)
15. [Example: Complete Component](#example-complete-component)

---

## Overview

GXT is a modern, compilable runtime environment designed as a Glimmer-VM alternative. It features:

- Hot Module Replacement (HMR)
- Native shadow-dom support
- Server-Side Rendering (SSR) with rehydration
- Built-in reactivity system
- 40% performance improvement over GlimmerVM
- 2x less memory usage
- Runtime code tree-shaking
- TypeScript support with Glint integration

---

## Project Setup

### Installation

```bash
pnpm create vite my-app --template vanilla-ts
pnpm install @lifeart/gxt
```

### Vite Configuration

```typescript
// vite.config.mts
import { defineConfig } from "vite";
import { compiler } from "@lifeart/gxt/compiler";

export default defineConfig(({ mode }) => ({
  plugins: [compiler(mode)],
}));
```

### TypeScript Configuration (Glint)

```json
{
  "compilerOptions": {
    // your options
  },
  "glint": {
    "environment": "glint-environment-gxt"
  }
}
```

### Entry Point

```typescript
import { renderComponent } from "@lifeart/gxt";
import App from "./App.gts";

const instance = renderComponent(App, {
  args: { name: "My App" },
  element: document.getElementById("app"),
});

// To destroy
import { destroyElement } from "@lifeart/gxt";
destroyElement(instance);
```

---

## Component Patterns

### Class-Based Components

```typescript
import { Component } from "@lifeart/gxt";

type MyComponentArgs = {
  Args: {
    name: string;
    onSubmit?: (value: string) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
};

export class MyComponent extends Component<MyComponentArgs> {
  // Computed property
  get displayName() {
    return `Hello, ${this.args.name}`;
  }

  // Event handler (arrow function to preserve `this`)
  handleSubmit = () => {
    this.args.onSubmit?.("submitted");
  };

  <template>
    <div>
      <h1>{{this.displayName}}</h1>
      <button {{on "click" this.handleSubmit}}>Submit</button>
      {{yield}}
    </div>
  </template>
}
```

**Key Points:**
- Extend `Component<T>` with type signature
- Define `Args`, `Blocks` (slots), and `Element` types
- Access arguments via `this.args`
- Use arrow functions for event handlers
- Template block defines the component's UI

### Function Components

```typescript
import type { ComponentLike } from "@lifeart/gxt";

type ButtonSignature = {
  Args: {
    onClick?: () => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement;
};

export const Button: ComponentLike<ButtonSignature> = <template>
  <button {{on "click" @onClick}} type="button" ...attributes>
    {{yield}}
  </button>
</template>;
```

**Key Points:**
- Simpler syntax for stateless components
- Use `@` prefix for arguments (e.g., `@onClick`)
- `{{yield}}` renders block content
- `...attributes` spreads passed attributes

### Template-Only Components

```typescript
// Simple.gts
<template>
  <div class="simple">{{@message}}</div>
</template>
```

---

## Reactivity System

### Cell (Mutable State)

```typescript
import { cell, type Cell } from "@lifeart/gxt";

// Create a cell
const count = cell(0);

// Read value
console.log(count.value); // 0

// Update value
count.update(1);
// or
count.value = 1;

// In templates, cells auto-unwrap
<template>
  <div>Count: {{count}}</div>
</template>
```

### CellFor (Object Property Tracking)

```typescript
import { cellFor } from "@lifeart/gxt";

const user = { name: "Alice", age: 30 };

// Create reactive cell for property
const nameCell = cellFor(user, "name");

// Bidirectional binding
nameCell.update("Bob");
console.log(user.name); // "Bob"

user.name = "Carol";
console.log(nameCell.value); // "Carol"
```

### @tracked Decorator

```typescript
import { Component } from "@lifeart/gxt";
import "decorator-transforms/globals"; // Required at top level!

export class Counter extends Component {
  @tracked count = 0;

  increment = () => {
    this.count++; // Automatically triggers re-render
  };

  <template>
    <div>{{this.count}}</div>
    <button {{on "click" this.increment}}>+</button>
  </template>
}
```

**Important:** Add `import 'decorator-transforms/globals';` to your entry file.

---

## Template Syntax

### Interpolation

```gts
<template>
  {{! Static values }}
  <div>Hello, {{@name}}</div>

  {{! Computed values }}
  <div>{{this.computedValue}}</div>

  {{! Helper expressions }}
  <div>{{if @isActive "Active" "Inactive"}}</div>
</template>
```

### HTML Attributes

```gts
<template>
  {{! Static attributes }}
  <div class="container"></div>

  {{! Dynamic attributes }}
  <div class={{this.className}}></div>

  {{! Conditional classes }}
  <div class={{if @isActive "active" "inactive"}}></div>

  {{! Style binding }}
  <div style={{this.styleString}}></div>
  <div style.color={{this.color}}></div>
</template>
```

### Event Handling

```gts
<template>
  {{! Basic event }}
  <button {{on "click" this.handleClick}}>Click</button>

  {{! With arguments }}
  <button {{on "click" (fn this.handleClick @id)}}>Click</button>

  {{! Multiple events }}
  <input
    {{on "input" this.handleInput}}
    {{on "blur" this.handleBlur}}
  />
</template>
```

### Slots (Yielding Content)

```gts
{{! Parent component }}
<Card @title="My Card">
  <p>Card content here</p>
</Card>

{{! Card component }}
<template>
  <div class="card">
    <h2>{{@title}}</h2>
    <div class="card-body">
      {{yield}}
    </div>
  </div>
</template>
```

### Named Blocks

```gts
{{! Parent }}
<Modal>
  <:header>Modal Title</:header>
  <:body>Modal content</:body>
  <:footer>
    <button>Close</button>
  </:footer>
</Modal>

{{! Modal component }}
<template>
  <div class="modal">
    <header>{{yield to="header"}}</header>
    <main>{{yield to="body"}}</main>
    <footer>{{yield to="footer"}}</footer>
  </div>
</template>
```

---

## Control Flow

### Conditionals with `{{#if}}`

```gts
<template>
  {{#if this.isLoading}}
    <LoadingSpinner />
  {{else if this.hasError}}
    <ErrorMessage @error={{this.error}} />
  {{else}}
    <Content @data={{this.data}} />
  {{/if}}
</template>
```

### Lists with `{{#each}}`

```gts
<template>
  <ul>
    {{#each this.items key="id" as |item index|}}
      <li>{{index}}: {{item.name}}</li>
    {{/each}}
  </ul>
</template>
```

**Key Attribute Options:**
- `key="propertyName"` - Track by property value (recommended)
- `key="@identity"` - Track by object identity

**Multiple Root Nodes:**

```gts
{{#each this.definitions key="term" as |def|}}
  <dt>{{def.term}}</dt>
  <dd>{{def.definition}}</dd>
{{/each}}
```

### Variable Binding with `{{#let}}`

```gts
<template>
  {{#let (hash name="John" age=30) as |person|}}
    <div>{{person.name}} is {{person.age}}</div>
  {{/let}}
</template>
```

---

## Modifiers and Helpers

### Built-in Helpers

| Helper | Description | Example |
|--------|-------------|---------|
| `eq` | Equality check | `{{eq a b}}` |
| `and` | Logical AND | `{{and a b}}` |
| `or` | Logical OR | `{{or a b}}` |
| `not` | Logical NOT | `{{not a}}` |
| `if` | Inline conditional | `{{if cond "yes" "no"}}` |
| `hash` | Create object | `{{hash key=value}}` |
| `array` | Create array | `{{array 1 2 3}}` |
| `fn` | Partial application | `{{fn this.method arg}}` |
| `log` | Console log | `{{log value}}` |
| `debugger` | Debugger breakpoint | `{{debugger}}` |

### Custom Helpers

```typescript
// helpers/format-date.ts
export function formatDate(date: Date, format: string): string {
  // Implementation
  return formattedString;
}

// Usage in template
import { formatDate } from "./helpers/format-date";

<template>
  <span>{{formatDate @date "YYYY-MM-DD"}}</span>
</template>
```

### Custom Modifiers

```typescript
// modifiers/auto-focus.ts
export function autoFocus(element: HTMLElement) {
  element.focus();

  // Optional cleanup function
  return () => {
    // Cleanup logic
  };
}

// Usage
import { autoFocus } from "./modifiers/auto-focus";

<template>
  <input {{autoFocus}} />
</template>
```

### Modifier with Arguments

```typescript
export function tooltip(element: HTMLElement, text: string, position = "top") {
  const tip = document.createElement("div");
  tip.className = `tooltip tooltip-${position}`;
  tip.textContent = text;

  element.addEventListener("mouseenter", () => {
    document.body.appendChild(tip);
  });

  element.addEventListener("mouseleave", () => {
    tip.remove();
  });

  return () => {
    tip.remove();
  };
}

// Usage
<template>
  <button {{tooltip "Click me!" "bottom"}}>Hover</button>
</template>
```

---

## Context API

### Providing Context

```typescript
import { Component, provideContext } from "@lifeart/gxt";

export const THEME_CONTEXT = Symbol("theme");

export class ThemeProvider extends Component<{
  Args: { theme: "light" | "dark" };
  Blocks: { default: [] };
}> {
  constructor() {
    super(...arguments);
    provideContext(this, THEME_CONTEXT, {
      theme: this.args.theme,
      toggle: this.toggleTheme,
    });
  }

  toggleTheme = () => {
    // Toggle logic
  };

  <template>{{yield}}</template>
}
```

### Consuming Context

```typescript
import { Component, getContext } from "@lifeart/gxt";
import { THEME_CONTEXT } from "./ThemeProvider";

export class ThemedButton extends Component {
  get themeContext() {
    return getContext(this, THEME_CONTEXT);
  }

  get buttonClass() {
    return `btn btn-${this.themeContext?.theme}`;
  }

  <template>
    <button class={{this.buttonClass}}>
      {{yield}}
    </button>
  </template>
}
```

---

## Suspense and Lazy Loading

### Lazy Components

```typescript
import { lazy } from "@lifeart/gxt/suspense";

// Code-split component
const HeavyChart = lazy(() => import("./HeavyChart"));
const UserProfile = lazy(() => import("./UserProfile"));
```

### Suspense Boundaries

```typescript
import { Suspense, lazy } from "@lifeart/gxt/suspense";

const AsyncDashboard = lazy(() => import("./Dashboard"));

function LoadingFallback() {
  <template>
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading...</p>
    </div>
  </template>
}

export class App extends Component {
  <template>
    <Suspense @fallback={{LoadingFallback}}>
      <AsyncDashboard />
    </Suspense>
  </template>
}
```

### Nested Suspense

```gts
<Suspense @fallback={{PageSkeleton}}>
  <Header />
  <Suspense @fallback={{ContentSkeleton}}>
    <MainContent />
  </Suspense>
  <Suspense @fallback={{SidebarSkeleton}}>
    <Sidebar />
  </Suspense>
</Suspense>
```

### Tracking Custom Async Operations

```typescript
import { Component } from "@lifeart/gxt";
import { followPromise } from "@lifeart/gxt/suspense";

export class DataFetcher extends Component {
  @tracked data = null;

  constructor() {
    super(...arguments);
    this.loadData();
  }

  async loadData() {
    // Track this promise in nearest Suspense boundary
    // When await completes, suspense end() has been called
    this.data = await followPromise(
      this,
      fetch("/api/data").then((r) => r.json())
    );
  }

  <template>
    {{#if this.data}}
      <DataDisplay @data={{this.data}} />
    {{/if}}
  </template>
}
```

---

## Testing

### Test Setup

```typescript
import {
  render,
  rerender,
  click,
  find,
  findAll,
} from "@lifeart/gxt/test-utils";
import { cell } from "@lifeart/gxt";

// Your test container needs id="ember-testing"
```

### Writing Tests

```typescript
import { describe, test, expect } from "vitest";
import { render, click, rerender, find } from "@lifeart/gxt/test-utils";
import { cell } from "@lifeart/gxt";

describe("Counter", () => {
  test("increments on click", async () => {
    const count = cell(0);
    const increment = () => count.update(count.value + 1);

    await render(
      <template>
        <button {{on "click" increment}}>
          Count: {{count}}
        </button>
      </template>
    );

    expect(find("button").textContent).toBe("Count: 0");

    await click("button");
    await rerender();

    expect(find("button").textContent).toBe("Count: 1");
  });
});
```

### Test Utilities Reference

| Function | Description |
|----------|-------------|
| `render(template)` | Render template to test container |
| `rerender(timeout?)` | Wait for pending updates |
| `click(selector)` | Trigger click event |
| `find(selector)` | Find single element |
| `findAll(selector)` | Find all matching elements |
| `cleanupRender()` | Clean up after test |

---

## SSR and Rehydration

### Server-Side Rendering

```typescript
import { ssr } from "@lifeart/gxt/test-utils";
import App from "./App.gts";

async function renderPage() {
  const html = await ssr(App, { title: "My Page" });
  return `
    <!DOCTYPE html>
    <html>
      <head><title>My App</title></head>
      <body>${html}</body>
    </html>
  `;
}
```

### Client Rehydration

```typescript
import { rehydrate } from "@lifeart/gxt/test-utils";
import App from "./App.gts";

// Rehydrate server-rendered HTML
rehydrate(App, { title: "My Page" });
```

---

## Architecture Patterns

### Project Structure

Organize your project by feature rather than by type:

```
src/
├── components/
│   ├── shared/           # Reusable UI components
│   │   ├── Button.gts
│   │   ├── Modal.gts
│   │   └── Input.gts
│   └── pages/            # Page-level components
│       ├── dashboard/
│       │   ├── Dashboard.gts
│       │   ├── DashboardHeader.gts
│       │   └── repo.ts   # Feature-specific state
│       └── todomvc/
│           ├── page.gts
│           ├── TodoItem.gts
│           └── repo.ts
├── services/             # Application-wide services
│   ├── router.ts
│   └── auth.ts
├── utils/                # Pure utility functions
└── index.ts              # App entry point
```

### State Management Patterns

#### 1. Local Component State (Simple)

Use `@tracked` for component-local state:

```typescript
export class Counter extends Component {
  @tracked count = 0;

  increment = () => this.count++;

  <template>
    <button {{on "click" this.increment}}>{{this.count}}</button>
  </template>
}
```

#### 2. Singleton Service Pattern (Shared State)

Create a singleton class for shared state across components:

```typescript
// services/auth.ts
import { tracked } from "@lifeart/gxt";

class AuthService {
  @tracked currentUser: User | null = null;
  @tracked isAuthenticated = false;

  login = async (credentials: Credentials) => {
    const user = await api.login(credentials);
    this.currentUser = user;
    this.isAuthenticated = true;
  };

  logout = () => {
    this.currentUser = null;
    this.isAuthenticated = false;
  };
}

export const auth = new AuthService();
```

```typescript
// Usage in any component
import { auth } from "@/services/auth";

export class Header extends Component {
  auth = auth;

  <template>
    {{#if this.auth.isAuthenticated}}
      <span>{{this.auth.currentUser.name}}</span>
      <button {{on "click" this.auth.logout}}>Logout</button>
    {{else}}
      <a href="/login">Login</a>
    {{/if}}
  </template>
}
```

#### 3. Repository Pattern (Data Layer)

Encapsulate data access and persistence:

```typescript
// features/todos/repo.ts
import { tracked } from "@lifeart/gxt";

type Todo = { id: string; title: string; completed: boolean };

class TodoRepo {
  @tracked data: Record<string, Todo> = this.load();

  private load(): Record<string, Todo> {
    if (import.meta.env.SSR) return {};
    const stored = localStorage.getItem("todos");
    return stored ? JSON.parse(stored) : {};
  }

  private persist() {
    localStorage.setItem("todos", JSON.stringify(Object.values(this.data)));
  }

  // Computed getters
  get all() { return Object.values(this.data); }
  get completed() { return this.all.filter(t => t.completed); }
  get active() { return this.all.filter(t => !t.completed); }

  // Actions (always use arrow functions)
  add = (title: string) => {
    const id = crypto.randomUUID();
    this.data = { ...this.data, [id]: { id, title, completed: false } };
    this.persist();
  };

  toggle = (id: string) => {
    const todo = this.data[id];
    if (todo) {
      this.data = { ...this.data, [id]: { ...todo, completed: !todo.completed } };
      this.persist();
    }
  };

  delete = (id: string) => {
    const { [id]: _, ...rest } = this.data;
    this.data = rest;
    this.persist();
  };
}

export const todoRepo = new TodoRepo();
```

#### 4. Context Pattern (Dependency Injection)

Use context for deep prop drilling or theming:

```typescript
// contexts/theme.ts
import { Component, provideContext, getContext } from "@lifeart/gxt";

export const THEME = Symbol("theme");

export type ThemeContext = {
  mode: "light" | "dark";
  toggle: () => void;
};

export class ThemeProvider extends Component<{
  Blocks: { default: [] };
}> {
  @tracked mode: "light" | "dark" = "light";

  constructor() {
    super(...arguments);
    provideContext(this, THEME, {
      get mode() { return this.mode; },
      toggle: this.toggle,
    });
  }

  toggle = () => {
    this.mode = this.mode === "light" ? "dark" : "light";
  };

  <template>{{yield}}</template>
}

// Consuming context
export class ThemedButton extends Component {
  get theme() {
    return getContext<ThemeContext>(this, THEME);
  }

  <template>
    <button class="btn-{{this.theme?.mode}}">{{yield}}</button>
  </template>
}
```

### Component Patterns

#### Container vs Presentational Components

**Presentational** (UI only, no business logic):

```typescript
// Presentational - receives data via args
export const TodoItemView: ComponentLike<{
  Args: { title: string; completed: boolean; onToggle: () => void };
}> = <template>
  <li class={{if @completed "done"}}>
    <input type="checkbox" checked={{@completed}} {{on "change" @onToggle}} />
    <span>{{@title}}</span>
  </li>
</template>;
```

**Container** (manages state, passes to presentational):

```typescript
// Container - manages data and logic
import { todoRepo } from "./repo";
import { TodoItemView } from "./TodoItemView";

export class TodoListContainer extends Component {
  repo = todoRepo;

  <template>
    <ul>
      {{#each this.repo.all key="id" as |todo|}}
        <TodoItemView
          @title={{todo.title}}
          @completed={{todo.completed}}
          @onToggle={{fn this.repo.toggle todo.id}}
        />
      {{/each}}
    </ul>
  </template>
}
```

#### Compound Components (Slots Pattern)

Build flexible, composable components:

```typescript
// Card.gts
export class Card extends Component<{
  Args: { variant?: "default" | "elevated" };
  Blocks: { header: []; default: []; footer?: [] };
}> {
  get variantClass() {
    return this.args.variant === "elevated" ? "shadow-lg" : "shadow";
  }

  <template>
    <div class="card {{this.variantClass}}">
      <header class="card-header">
        {{yield to="header"}}
      </header>
      <div class="card-body">
        {{yield}}
      </div>
      {{#if (has-block "footer")}}
        <footer class="card-footer">
          {{yield to="footer"}}
        </footer>
      {{/if}}
    </div>
  </template>
}
```

```gts
{{! Usage }}
<Card @variant="elevated">
  <:header>
    <h2>Card Title</h2>
  </:header>

  <p>Card content goes here</p>

  <:footer>
    <button>Action</button>
  </:footer>
</Card>
```

### Data Flow Patterns

#### Actions Up, Data Down

Components receive data via `@args` and emit actions via callbacks:

```typescript
// Parent owns the state
export class ParentComponent extends Component {
  @tracked items: string[] = [];

  addItem = (item: string) => {
    this.items = [...this.items, item];
  };

  removeItem = (index: number) => {
    this.items = this.items.filter((_, i) => i !== index);
  };

  <template>
    <ItemForm @onSubmit={{this.addItem}} />
    <ItemList @items={{this.items}} @onRemove={{this.removeItem}} />
  </template>
}

// Child receives data and emits actions
export class ItemList extends Component<{
  Args: { items: string[]; onRemove: (index: number) => void };
}> {
  <template>
    <ul>
      {{#each @items key="@index" as |item index|}}
        <li>
          {{item}}
          <button {{on "click" (fn @onRemove index)}}>×</button>
        </li>
      {{/each}}
    </ul>
  </template>
}
```

#### Immutable Updates

Always create new references when updating tracked data:

```typescript
// ✅ Good - creates new array reference
this.items = [...this.items, newItem];
this.items = this.items.filter(item => item.id !== id);
this.items = this.items.map(item =>
  item.id === id ? { ...item, completed: true } : item
);

// ✅ Good - creates new object reference
this.user = { ...this.user, name: newName };
this.data = { ...this.data, [key]: value };

// ❌ Bad - mutates in place (won't trigger re-render)
this.items.push(newItem);
this.items[0].completed = true;
this.user.name = newName;
```

### Error Handling Patterns

#### Async Error Handling with Suspense

```typescript
export class DataLoader extends Component {
  @tracked data: Data | null = null;
  @tracked error: Error | null = null;

  constructor() {
    super(...arguments);
    this.loadData();
  }

  async loadData() {
    try {
      this.data = await fetchData();
    } catch (err) {
      this.error = err as Error;
    }
  }

  retry = () => {
    this.error = null;
    this.loadData();
  };

  <template>
    {{#if this.error}}
      <div class="error">
        <p>{{this.error.message}}</p>
        <button {{on "click" this.retry}}>Retry</button>
      </div>
    {{else if this.data}}
      <DataDisplay @data={{this.data}} />
    {{else}}
      <LoadingSpinner />
    {{/if}}
  </template>
}
```

### SSR Considerations

#### Environment-Aware Code

```typescript
// Check for SSR environment
if (import.meta.env.SSR) {
  // Server-side only code
} else {
  // Client-side only code (localStorage, window, etc.)
}

// Safe localStorage access
function loadFromStorage<T>(key: string, fallback: T): T {
  if (import.meta.env.SSR) return fallback;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : fallback;
}
```

#### Avoiding Rehydration Mismatches

```typescript
export class ClientOnlyComponent extends Component {
  @tracked isMounted = false;

  constructor() {
    super(...arguments);
    // Defer client-specific state to avoid mismatch
    if (!import.meta.env.SSR) {
      queueMicrotask(() => {
        this.isMounted = true;
      });
    }
  }

  <template>
    {{#if this.isMounted}}
      <ClientSpecificContent />
    {{else}}
      <Placeholder />
    {{/if}}
  </template>
}
```

---

## Best Practices

### Component Design

1. **Keep components focused** - Single responsibility
2. **Use function components for simple UI** - Less overhead
3. **Use class components for stateful logic** - Better organization
4. **Prefer composition over inheritance**
5. **Co-locate related files** - Keep component, styles, tests together

### Reactivity

1. **Use `cell()` for simple standalone state**
2. **Use `cellFor()` for object properties** - Forms, nested data
3. **Use `@tracked` for class properties** - Cleaner syntax
4. **Use getters for derived values** - Computed from other state
5. **Create new references for updates** - Immutable patterns

### Performance

1. **Always use `key` in `{{#each}}`** - Stable identity
2. **Lazy load heavy components** - Code splitting
3. **Use Suspense boundaries** - Better loading UX
4. **Avoid unnecessary nesting** - Flat component trees
5. **Extract expensive computations to getters** - Cached until deps change

### Templates

1. **Keep templates readable** - Extract complex logic to getters
2. **Use helpers for reusable logic**
3. **Use modifiers for DOM interactions**
4. **Prefer named blocks for complex layouts**
5. **Use `...attributes` for flexible components**

### Event Handlers

1. **Use arrow functions for methods** - Preserves `this` context
2. **Use `fn` helper for partial application** - `{{fn this.method arg}}`
3. **Handle events at the right level** - Don't bubble unnecessarily
4. **Debounce expensive operations** - Input handlers, scroll events

### Testing

1. **Test behavior, not implementation** - User-centric tests
2. **Use `await rerender()` after state changes**
3. **Test edge cases** - Empty states, error states, loading
4. **Keep test files co-located with components**

---

## API Reference

### Core Exports (`@lifeart/gxt`)

| Export | Description |
|--------|-------------|
| `Component` | Base class for components |
| `cell<T>(value)` | Create mutable reactive state |
| `cellFor(obj, prop)` | Create cell for object property |
| `tracked` | Decorator for reactive properties |
| `renderComponent(comp, opts)` | Render root component |
| `destroyElement(instance)` | Destroy component |
| `registerDestructor(ctx, fn)` | Register cleanup function |
| `provideContext(ctx, key, val)` | Provide context value |
| `getContext<T>(ctx, key)` | Get context value |
| `hbs` | Template tag (compile-time) |
| `scope(vars)` | Suppress unused variable errors |

### Suspense Exports (`@lifeart/gxt/suspense`)

| Export | Description |
|--------|-------------|
| `Suspense` | Async boundary component |
| `lazy(factory)` | Create lazy-loaded component |
| `followPromise(ctx, promise)` | Track async operation; returns promise that guarantees `end()` called on await |
| `SUSPENSE_CONTEXT` | Context symbol for suspense |

### Test Exports (`@lifeart/gxt/test-utils`)

| Export | Description |
|--------|-------------|
| `render(template)` | Render to test container |
| `rerender(timeout?)` | Wait for updates |
| `click(selector)` | Trigger click |
| `find(selector)` | Find element |
| `findAll(selector)` | Find all elements |
| `ssr(component)` | Server-side render |
| `rehydrate(comp, args)` | Rehydrate SSR content |

---

## File Extensions

- `.gts` - TypeScript with templates
- `.gjs` - JavaScript with templates
- `.ts` / `.js` - Standard TypeScript/JavaScript

---

## Example: Complete Component

```typescript
// components/TodoList.gts
import { Component, tracked } from "@lifeart/gxt";
import "decorator-transforms/globals";

type Todo = {
  id: number;
  title: string;
  completed: boolean;
};

type TodoListArgs = {
  Args: {
    initialTodos?: Todo[];
  };
};

export class TodoList extends Component<TodoListArgs> {
  @tracked todos: Todo[] = this.args.initialTodos ?? [];
  @tracked newTodoText = "";

  // Getter for derived value (recommended pattern)
  get completedCount() {
    return this.todos.filter((todo) => todo.completed).length;
  }

  get remainingCount() {
    return this.todos.length - this.completedCount;
  }

  addTodo = () => {
    if (!this.newTodoText.trim()) return;

    this.todos = [
      ...this.todos,
      {
        id: Date.now(),
        title: this.newTodoText,
        completed: false,
      },
    ];
    this.newTodoText = "";
  };

  toggleTodo = (id: number) => {
    this.todos = this.todos.map((todo) =>
      todo.id === id ? { ...todo, completed: !todo.completed } : todo
    );
  };

  removeTodo = (id: number) => {
    this.todos = this.todos.filter((todo) => todo.id !== id);
  };

  handleInput = (e: Event) => {
    this.newTodoText = (e.target as HTMLInputElement).value;
  };

  <template>
    <div class="todo-list">
      <form {{on "submit" this.addTodo}}>
        <input
          type="text"
          value={{this.newTodoText}}
          {{on "input" this.handleInput}}
          placeholder="Add a todo..."
        />
        <button type="submit">Add</button>
      </form>

      <ul>
        {{#each this.todos key="id" as |todo|}}
          <li class={{if todo.completed "completed"}}>
            <input
              type="checkbox"
              checked={{todo.completed}}
              {{on "change" (fn this.toggleTodo todo.id)}}
            />
            <span>{{todo.title}}</span>
            <button {{on "click" (fn this.removeTodo todo.id)}}>
              Delete
            </button>
          </li>
        {{/each}}
      </ul>

      <p>{{this.remainingCount}} items left, {{this.completedCount}} completed</p>
    </div>
  </template>
}
```

---

This guide covers the essential patterns and APIs for building applications with GXT. For more examples, see the `src/components/pages/todomvc/` directory which contains a complete TodoMVC implementation demonstrating real-world patterns.
