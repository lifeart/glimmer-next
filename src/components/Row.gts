import { RemoveIcon } from "./RemoveIcon.gts";
import type { Item } from "@/utils/data";
import { type Cell, cellFor } from "@/utils/reactive";
import { Component } from '@/utils/component';
import type { ModifierReturn } from '@glint/template/-private/integration';

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
  get className() {
    return this.isSelected ? "danger" : "";
  };
  onClick = () => {
    this.selected = this.isSelected ? 0 : this.id;
  };
  onClickRemove = (e: Event) => {
    if (e.isTrusted) {
      this.isClicked = true;
    }
    this.args.onRemove(this.args.item);
  };
  modifier = (element: HTMLDivElement): ModifierReturn => {
    const result  = async () => {
      if (!this.isClicked) {
        return;
      }
      const scrollTop  = document.documentElement.scrollTop;
      if (Math.random() > 0.5) {
        const rect = element.getBoundingClientRect();
        element.style.position = "absolute";
        element.style.top = `${rect.top + scrollTop}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = "blue";
        element.style.transition = "all 1.4s ease";
        element.style.transform = "scale(0)";
        await new Promise((resolve) => setTimeout(resolve, 1400)); 
      } else {
        const rect = element.getBoundingClientRect();
        element.style.position = "absolute";
        element.style.top = `${rect.top + scrollTop}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = "blue";
        element.style.transition = "all 1.4s ease";
        element.style.transform = "translateX(100%)";
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
      
    };
    return result as unknown as ModifierReturn;
  }
  <template>
    <tr class={{this.className}} {{this.modifier}}>
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
