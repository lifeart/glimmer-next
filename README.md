This is [sample](https://g-next.netlify.app/) `compilable` runtime for `glimmer-vm` experiment. [![Netlify Status](https://api.netlify.com/api/v1/badges/43af359b-56a7-4607-9e01-04ca3a545470/deploy-status)](https://app.netlify.com/sites/g-next/deploys)

Related issue:
    https://github.com/glimmerjs/glimmer-vm/issues/1540

Related PR:
    https://github.com/glimmerjs/glimmer-vm/pull/1541


### Component sample

```ts
import { hbs, scope } from "@/utils/template";
import { RemoveIcon } from "./RemoveIcon";
import { Item } from "@/utils/data";
import { Cell, cellFor, formula } from "@/utils/reactive";

export function Row({
  item,
  selectedCell,
  onRemove,
}: {
  item: Item;
  selectedCell: Cell<number>;
  onRemove: (item: Item) => void;
}) {
  const id = item.id;
  const labelCell = cellFor(item, "label");

  const onClick = () => {
    if (selectedCell.value === id) {
      selectedCell.value = 0;
    } else {
      selectedCell.value = id;
    }
  };

  const className = formula(() => {
    return id === selectedCell.value ? "danger" : "";
  });

  const onClickRemove = () => {
    onRemove(item);
  };

  scope({ RemoveIcon, labelCell, onClick, className, onClickRemove });

  return hbs`
    <tr class={{className}}>
        <td class="col-md-1">{{id}}</td>
        <td class="col-md-4">
            <a {{on "click" onClick}}  data-test-select="true">{{labelCell}}</a>
        </td>
        <td class="col-md-1">
            <a {{on "click" onClickRemove}} data-test-remove="true">
                <RemoveIcon />
            </a>
        </td>
        <td class="col-md-6"></td>
    </tr>
  `;
}
```

### Notes

* every component is a function, it's running only once
* modifiers API: 
```js
function modifier(element: Element, ...args: Args) {
    return () => {
        // destructor
    }
}
```
* helpers composition is not supported


### Reactive primitives

* `cell<T>(value)` - reactive primitive, for mutable state. We could update cel calling `cell.update(value)`, to get cell value we could use `cell.value`.
* `formula(fn: () => unknown)` - reactive primitive, for derived state.

`formula` could be used to create derived state from `Cell`'s. It's autotrack dependencies and update when any of them changed.

`scope` function is used to suspend `ts` error about unused variables. It's not required for runtime, but required for `ts` compilation.

`destructors` supported, but not straighforward. We need to call crate const array, named `destructors` and send it to scope.
```ts
import { hbs, scope } from "@/utils/template";

export function Icon() {
   const destructors = [() => {
         console.log('destructor');
   }];

   scope({ destructors });

   return hbs`<i class="glyphicon glyphicon-remove"></i>`;
}
```