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