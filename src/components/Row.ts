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

  let isClicked = false;

  const onClickRemove = (e: Event) => {
    if (e.isTrusted) {
      isClicked = true;
    }
    onRemove(item);
  };

  const modifier = (element: HTMLDivElement) => {
    return async () => {
      if (!isClicked) {
        return;
      }
      if (Math.random() > 0.5) {
        const rect = element.getBoundingClientRect();
        element.style.position = "absolute";
        element.style.top = `${rect.top}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = "blue";
        element.style.transition = "all 0.4s ease";
        element.style.transform = "scale(0)";
        await new Promise((resolve) => setTimeout(resolve, 400)); 
      } else {
        const rect = element.getBoundingClientRect();
        element.style.position = "absolute";
        element.style.top = `${rect.top}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = "blue";
        element.style.transition = "all 0.4s ease";
        element.style.transform = "translateX(100%)";
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      
    }
  }

  scope({ RemoveIcon, labelCell, modifier, onClick, className, onClickRemove });

  return hbs`
    <tr class={{className}} {{modifier}}>
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
