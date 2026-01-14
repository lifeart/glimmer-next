# GXT [![Netlify Status](https://api.netlify.com/api/v1/badges/43af359b-56a7-4607-9e01-04ca3a545470/deploy-status)](https://app.netlify.com/sites/g-next/deploys)

<img align="right" width="95" height="95"
     alt="Philosopher’s stone, logo of PostCSS"
     src="./public/logo.png">

`GXT` is a cutting-edge, compilable runtime environment designed as `glimmer-vm` alternative, showcasing the power and flexibility of modern web component development. This repo includes a live example of how `GXT` can be used in real-world applications, providing developers with a practical and interactive experience. Explore our [sample](https://g-next.netlify.app/) at netlify.

## Benefits

- 🔥 Hot Module Replacement (Reloading)
- 🌑 Native shadow-dom support
- ⌛ Async element destructors support
- 🖥️ Server Side Rendering
- 💧 Rehydration
- 🔧 Ember Developer Tools support
- 🍃 Runtime code tree-shaking
- 📦 Small Bundle Size
- ✍️ Typed Templates with Glint
- 🤝 Ember syntax compatibility
- 🚀 40% performance improvement compared to GlimmerVM
- 💾 2x less memory usage compared to GlimmerVM
- 🧹 Template linting support via Ember Template Lint
- ⚛️ Built-in reactivity system

## Development tools for VS Code

- [Language Server](https://marketplace.visualstudio.com/items?itemName=lifeart.vscode-ember-unstable)
- [Template Syntax](https://marketplace.visualstudio.com/items?itemName=lifeart.vscode-glimmer-syntax)
- [Templates Type checking](https://marketplace.visualstudio.com/items?itemName=typed-ember.glint-vscode)

## Quick Links

- Related issue: [glimmer-vm/issues/1540](https://github.com/glimmerjs/glimmer-vm/issues/1540)
- Related PR: [glimmer-vm/pull/1541](https://github.com/glimmerjs/glimmer-vm/pull/1541)
- Sample App: [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark/tree/master/frameworks/keyed/gxt)

## Component sample

Based on [template imports RFC](https://rfcs.emberjs.com/id/0779-first-class-component-templates/)

```gjs
import { RemoveIcon } from "./RemoveIcon.gts";
import type { Item } from "@/utils/data";
import { type Cell, cellFor, Component } from "@lifeart/gxt";

type RowArgs = {
  Args: {
    item: Item;
    selectedCell: Cell<number>;
    onRemove: (item: Item) => void;
  };
};

export class Row extends Component<RowArgs> {
  get labelCell() {
    return cellFor(this.args.item, "label");
  }
  get id() {
    return this.args.item.id;
  }
  get selected() {
    return this.args.selectedCell.value;
  }
  set selected(value: number) {
    this.args.selectedCell.value = value;
  }
  get isSelected() {
    return this.selected === this.id;
  }
  get className() {
    return this.isSelected ? "danger" : "";
  }
  onClick = () => {
    this.selected = this.isSelected ? 0 : this.id;
  };
  onClickRemove = (e: Event) => {
    this.args.onRemove(this.args.item);
  };
  <template>
    <tr class={{this.className}}>
      <td class="col-md-1">{{this.id}}</td>
      <td class="col-md-4">
        <a {{on "click" this.onClick}} data-test-select>{{this.labelCell}}</a>
      </td>
      <td class="col-md-1">
        <a {{on "click" this.onClickRemove}} data-test-remove>
          <RemoveIcon />
        </a>
      </td>
      <td class="col-md-6"></td>
    </tr>
  </template>
}
```

## Key Features

### Simple and Expressive Component Model

- <b>Component as Functions:</b> Every component in gNext is a function, executed only once for efficiency and better performance.
- <b>Class based components:</b> Class based components are supported as well.
- <b>Basic Glint Support:</b> Integration with Glint for improved TypeScript support and developer experience.
- <b>Comprehensive Slot Support:</b> Full support for different kinds of slots, including {{yield}}, enhancing the flexibility in component composition.
- <b>Modifiers and Helpers APIs:</b>
  Modifiers for element-specific logic.
  Helpers for reusable logic across components.
- <b>Template Imports:</b> Import templates from other files, enabling better code organization and reusability.
- <b>Template Compilation:</b> Compile templates to JavaScript functions for improved performance and efficiency.
- <b>Opcodes tree-shaking:</b> Opcodes tree-shaking for smaller bundle size. We don't include unused DOM and component, flow-control opcodes in the bundle.

### Reactive Primitives

- <b>Mutable State with `cell<T>`:</b> Use cell<T> for creating reactive, mutable states. Updating and accessing cell values is straightforward and efficient.
- <b>Derived State with `formula`:</b> Create derived states that automatically update when dependencies change, ensuring reactive and responsive UIs.
- <b>Support for destructors:</b> Enables clean-up and resource management, preventing memory leaks.

## Benefits and Use Cases

<b>gNext</b> serves as a powerful tool for web developers looking to harness the capabilities of Glimmer-VM in a real-world setting. Its benefits and use cases include:

- <b>Efficient DOM Rendering:</b> Experience fast and efficient DOM updates and rendering, crucial for high-performance web applications.
- <b>Reactive State Management:</b> Manage component states reactively, ensuring UIs are always up-to-date with the underlying data.
- <b>Enhanced Developer Experience:</b> Enjoy a seamless development experience with features like TypeScript support, comprehensive API documentation, and easy-to-understand examples.
- <b>Flexible Component Composition:</b> Leverage advanced component composition techniques to build complex UIs with ease.
- <b>Resource Management:</b> Efficiently manage resources with destructors, preventing common issues like memory leaks.

<b>gNext</b> is not just a library; it's a gateway to building modern, efficient, and reactive web applications using Glimmer-VM. Whether you are building dynamic user interfaces, complex single-page applications, or just experimenting with new front-end technologies, gNext provides the tools and capabilities to bring your ideas to life.

Explore <b>gNext</b> and elevate your web development experience!

### Custom Renderers

GXT supports multiple rendering targets beyond the standard DOM. Each renderer provides its own API while maintaining full reactivity.

#### PDF Renderer

Build PDF documents using a declarative component-based API inspired by [react-pdf](https://react-pdf.org/):

```ts
import {
  PdfDocument,
  PdfPage,
  PdfView,
  PdfText,
  StyleSheet,
  createPdfApi,
} from "@/utils/renderers/pdf";

// Create styles
const styles = StyleSheet.create({
  page: { padding: 30 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 10 },
  text: { fontSize: 12, color: "#333", lineHeight: 1.6 },
});

// Build document programmatically
const api = createPdfApi();

const doc = new PdfDocument();
doc.title = "My Document";
doc.author = "GXT";

const page = new PdfPage();
page.size = "A4";
page.style = styles.page;

const view = new PdfView();

const title = new PdfText();
title.style = styles.title;
title.appendChild(new PdfTextNode("Hello World"));

const paragraph = new PdfText();
paragraph.style = styles.text;
paragraph.appendChild(new PdfTextNode("Generated with GXT PDF Renderer"));

view.appendChild(title);
view.appendChild(paragraph);
page.appendChild(view);
doc.appendChild(page);

api.setDocument(doc);

// Get JSON structure for PDF generation
const structure = api.toJSON();
```

**Available PDF Elements:**

- `PdfDocument` - Root container with metadata (title, author, subject, etc.)
- `PdfPage` - Individual pages with size, orientation, and styling
- `PdfView` - Layout container (like a div) with flexbox support
- `PdfText` - Text content with typography styling
- `PdfImage` - Image embedding (URL, buffer, or base64)
- `PdfLink` - Hyperlinks
- `PdfCanvas` - Custom drawing with paint function
- `PdfNote` - Annotations

**StyleSheet Utility:**

```ts
import { StyleSheet, PageSizes, parseUnit } from "@/utils/renderers/pdf";

// Create named styles
const styles = StyleSheet.create({
  container: { padding: 20, flexDirection: "row" },
  text: { fontSize: 12, color: "#333" },
});

// Flatten/compose styles
const merged = StyleSheet.compose(styles.container, { margin: 10 });

// Get page dimensions
const a4 = PageSizes.A4; // { width: 595, height: 842 }

// Parse CSS units to points
parseUnit("1in"); // 72
parseUnit("2.5cm"); // ~70.87
parseUnit("50%", 200); // 100
```

**Supported Style Properties:**

- Dimensions: width, height, minWidth, maxWidth, minHeight, maxHeight
- Spacing: margin, padding (with directional variants)
- Flexbox: flexDirection, justifyContent, alignItems, gap, etc.
- Positioning: position, top, right, bottom, left, zIndex
- Typography: fontSize, fontFamily, fontWeight, color, textAlign, lineHeight
- Borders: borderWidth, borderColor, borderRadius
- Background: backgroundColor, opacity

#### Other Renderers

- **Canvas Renderer** - Render to HTML Canvas with 2D primitives
- **SVG Renderer** - Native SVG with reactive attributes
- **MathML Renderer** - Mathematical notation
- **Three.js/Tres Renderer** - 3D WebGL graphics

See the [live demo](https://g-next.netlify.app/renderers) for interactive examples of all renderers.

### Notes

- modifiers API:

```js
function modifier(element: Element, ...args: Args) {
    return () => {
        // destructor
    }
}
```

- helpers API:

```js
function helper(...args: Args): string | boolean | number | null {
  // helper logic
  return 3 + 2;
}
```

### Reactive primitives

- `@tracked` - decorator to mark class property as reactive primitive. It's autotrack dependencies and update when any of them changed. Note, to use it you need to add `import 'decorator-transforms/globals';` in top-level file.

- `cell<T>(value)` - reactive primitive, for mutable state. We could update cel calling `cell.update(value)`, to get cell value we could use `cell.value`.
- `cellFor(object, property)` - creates a reactive cell for an object property, useful for tracking nested state.
- `formula(fn: () => unknown)` - reactive primitive, for derived state.

`formula` could be used to create derived state from `Cell`'s. It's autotrack dependencies and update when any of them changed.

`scope` function is used to suspend `ts` error about unused variables. It's not required for runtime, but required for `ts` compilation.

`destructors` supported.

```ts
import { registerDestructor, hbs, scope } from "@lifeart/gxt";

export function Icon() {
  registerDestructor(this, () => {
    console.log("destructor");
  });

  return hbs`<i class="glyphicon glyphicon-remove"></i>`;
}
```

### Control Flow

GXT provides built-in control flow components for conditional and list rendering.

#### Conditionals with `{{#if}}`

```gts
<template>
  {{#if this.isVisible}}
    <div>Content is visible</div>
  {{else}}
    <div>Content is hidden</div>
  {{/if}}
</template>
```

#### List rendering with `{{#each}}`

```gts
<template>
  <ul>
    {{#each this.items key="id" as |item index|}}
      <li>{{index}}: {{item.name}}</li>
    {{/each}}
  </ul>
</template>
```

The `key` attribute is important for efficient list updates - it helps GXT track which items have changed, been added, or removed. You can use `key="@identity"` for identity-based tracking.

GXT supports multiple root nodes per iteration (fragment-like rendering):

```gts
{{#each this.items key="id" as |item|}}
  <dt>{{item.term}}</dt>
  <dd>{{item.definition}}</dd>
{{/each}}
```

### Suspense and Lazy Loading

GXT provides built-in support for async component loading with suspense boundaries.

#### Lazy Components

Use `lazy()` to create code-split components that load on demand:

```ts
import { lazy } from "@lifeart/gxt/suspense";

const MyAsyncComponent = lazy(() => import("./MyComponent"));
```

The lazy component will trigger the suspense boundary while loading.

#### Suspense Boundaries

Wrap lazy components with `<Suspense>` to show fallback content during loading:

```gts
import { Suspense, lazy } from "@lifeart/gxt/suspense";

const AsyncComponent = lazy(() => import("./AsyncComponent"));

function LoadingSpinner() {
  return <template>
    <div>Loading...</div>
  </template>;
}

export function App() {
  return <template>
    <Suspense @fallback={{LoadingSpinner}}>
      <AsyncComponent />
    </Suspense>
  </template>;
}
```

Suspense boundaries can be nested for fine-grained loading states:

```gts
<Suspense @fallback={{PageLoader}}>
  <Header />
  <Suspense @fallback={{ContentLoader}}>
    <MainContent />
  </Suspense>
</Suspense>
```

#### Tracking Custom Async Operations

Use `followPromise()` to track custom async operations within a suspense boundary:

```ts
import { Component } from "@lifeart/gxt";
import { followPromise } from "@lifeart/gxt/suspense";

class DataLoader extends Component {
  async loadData() {
    // This promise will be tracked by the nearest suspense boundary
    const data = await followPromise(
      this,
      fetch("/api/data").then((r) => r.json()),
    );
    return data;
  }
}
```

The `followPromise` function:

- Calls `start()` on the nearest suspense context when the promise begins
- Calls `end()` when the promise resolves or rejects
- Returns a promise that resolves to the same value
- When you `await followPromise(...)`, `end()` is guaranteed to have been called

### Built-in Helpers

GXT includes several built-in helpers for common template operations:

- `{{eq a b}}` - equality comparison
- `{{and a b}}` - logical AND
- `{{or a b}}` - logical OR
- `{{not a}}` - logical NOT
- `{{if condition then else}}` - inline conditional
- `{{hash key=value}}` - creates an object
- `{{array a b c}}` - creates an array
- `{{fn this.method arg}}` - partial application
- `{{log value}}` - logs to console (for debugging)
- `{{debugger}}` - triggers debugger breakpoint

### Setup

Start project from this template: https://github.com/lifeart/template-gxt

or

```
pnpm create vite my-app --template vanilla-ts
pnpm install @lifeart/gxt
```

Edit `vite.config.mts` to import compiler:

```js
import { defineConfig } from "vite";
import { compiler } from "@lifeart/gxt/compiler";

export default defineConfig(({ mode }) => ({
  plugins: [compiler(mode)],
}));
```

To render root component, use `renderComponent` function.

```js
import { renderComponent } from "@lifeart/gxt";
import App from "./App.gts";

const Instance = renderComponent(App, {
  // application arguments
  args: {
    name: "My App",
  },
  // render target (append to)
  element: document.getElementById("app"),
});
```

To destroy component, use `destroyElement` function.

```js
import { destroyElement } from "@lifeart/gxt";

destroyElement(Instance);
```

### Testing

GXT provides test utilities for writing component tests with QUnit:

```ts
import { render, rerender, click, find, findAll } from "@lifeart/gxt/test-utils";
import { cell } from "@lifeart/gxt";

test("component renders correctly", async function (assert) {
  const count = cell(0);

  await render(
    <template>
      <button {{on "click" (fn count.update (inc count.value))}}>
        Count: {{count}}
      </button>
    </template>
  );

  assert.dom("button").hasText("Count: 0");

  await click("button");
  await rerender();

  assert.dom("button").hasText("Count: 1");
});
```

Available test utilities:

- `render(template)` - renders a template to the test container
- `rerender()` - waits for pending async updates
- `click(selector)` - triggers a click event on matching element
- `find(selector)` - returns first matching element
- `findAll(selector)` - returns all matching elements

### Glint Setup (TypeScript Template Type-Checking)

GXT includes a Glint environment for full template type-checking. Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    // ... your options
  },
  "glint": {
    "environment": "glint-environment-gxt"
  }
}
```

This enables type-safe templates with autocompletion and error checking in your IDE.
