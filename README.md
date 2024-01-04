This is [sample](https://g-next.netlify.app/) `compilable` runtime for `glimmer-vm` experiment. [![Netlify Status](https://api.netlify.com/api/v1/badges/43af359b-56a7-4607-9e01-04ca3a545470/deploy-status)](https://app.netlify.com/sites/g-next/deploys)

Related issue:
    https://github.com/glimmerjs/glimmer-vm/issues/1540

Related PR:
    https://github.com/glimmerjs/glimmer-vm/pull/1541


### Component sample

```gts
import { RemoveIcon } from "./RemoveIcon.gts";
import type { Item } from "@/utils/data";
import { Cell, cellFor, formula } from "@/utils/reactive";
import { Component } from '@/utils/component';

type RowArgs = {
  Args: {
    item: Item;
    selectedCell: Cell<number>;
    onRemove: (item: Item) => void;
  }
};

export class Row extends Component<RowArgs> {
  isClicked = false;
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
  className = formula(() => {
    return this.isSelected ? "danger" : "";
  });
  onClick = () => {
    this.selected = this.isSelected ? 0 : this.id;
  };
  onClickRemove = (e: Event) => {
    if (e.isTrusted) {
      this.isClicked = true;
    }
    this.args.onRemove(this.args.item);
  };
  <template>
    <tr class={{this.className}}>
      <td class="col-md-1">{{this.id}}</td>
      <td class="col-md-4">
        <a {{on "click" this.onClick}}  data-test-select>{{this.labelCell}}</a>
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

### Notes

* every component is a function, it's running only once
* only default slot is supported for now (`{{yield}}`)
* modifiers API: 
```js
function modifier(element: Element, ...args: Args) {
    return () => {
        // destructor
    }
}
```
* helpers API:
```js
function helper(...args: Args): string | boolean | number | null {
  // helper logic
  return 3 + 2;
}
```

### Reactive primitives

* `cell<T>(value)` - reactive primitive, for mutable state. We could update cel calling `cell.update(value)`, to get cell value we could use `cell.value`.
* `formula(fn: () => unknown)` - reactive primitive, for derived state.

`formula` could be used to create derived state from `Cell`'s. It's autotrack dependencies and update when any of them changed.

`scope` function is used to suspend `ts` error about unused variables. It's not required for runtime, but required for `ts` compilation.

`destructors` supported.
```ts
import { hbs, scope } from "@/utils/template";
import { registerDestructor } from "@/utils/destroyable";


export function Icon() {
   registerDestructor(this, () => {
      console.log('destructor');
   });

   return hbs`<i class="glyphicon glyphicon-remove"></i>`;
}
```