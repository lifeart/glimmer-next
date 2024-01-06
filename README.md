# gNext [![Netlify Status](https://api.netlify.com/api/v1/badges/43af359b-56a7-4607-9e01-04ca3a545470/deploy-status)](https://app.netlify.com/sites/g-next/deploys)

<img align="right" width="95" height="95"
     alt="Philosopher’s stone, logo of PostCSS"
     src="./public/logo.png">

`gNext` is a cutting-edge, compilable runtime environment designed as `glimmer-vm` experiment, showcasing the power and flexibility of modern web component development. This runtime is a live example of how Glimmer-VM can be used in real-world applications, providing developers with a practical and interactive experience. Explore our [sample](https://g-next.netlify.app/) at netlify.

## Quick Links

- Related issue: [glimmer-vm/issues/1540](https://github.com/glimmerjs/glimmer-vm/issues/1540)
- Related PR: [glimmer-vm/pull/1541](https://github.com/glimmerjs/glimmer-vm/pull/1541)
- Sample App: [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark/pull/1554)

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
  };
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

### Notes

#

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

- `cell<T>(value)` - reactive primitive, for mutable state. We could update cel calling `cell.update(value)`, to get cell value we could use `cell.value`.
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


### Setup

```
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

const Instance = renderComponent(new App(), document.getElementById("app"));

```

To destroy component, use `destroyElement` function.

```js

import { destroyElement } from "@lifeart/gxt";

destroyElement(Instance);

```

