This is sample `compilable` runtime for `glimmer-vm` experiment.

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

export function Row({item, selectedCell, onRemove}: {
    item: Item;
    selectedCell: Cell<number>;
    onRemove: (item: Item) => void;
}) {

    const id = item.id;
    const labelCell = cellFor(item, 'label');
    
    const onClick = () => {
        if (selectedCell.value === id) {
            return selectedCell.update(0);
        } else {
            selectedCell.update(id);
        }
    }

    const className = formula(() => {
        return  id === selectedCell.value ? 'danger' : '';
    });

    const onClickRemove = () => {
        onRemove(item);
    }

    scope({ RemoveIcon, labelCell, onClick, onRemove, className });

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
* modifiers except `on` are not supported
* helpers composition is not supported


### Reactive primitives

* `Cell<T>` - reactive primitive, for mutable state. We could update cel calling `cell.update(value)`, to get cell value we could use `cell.value`.
* `formula(fn: () => unknown)` - reactive primitive, for derived state.

`formula` could be used to create derived state from `Cell`'s. It's autotrack dependencies and update when any of them changed.

`scope` function is used to suspend `ts` error about unused variables. It's not required for runtime, but required for `ts` compilation.