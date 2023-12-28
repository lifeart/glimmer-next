import type { Item } from "@/utils/data";
import { buildData, swapRows, updateData } from "@/utils/data";
import { cell } from "@/utils/reactive";
import { renderComponent, type ComponentReturnType } from "@/utils/component";
import { App } from "./AppLayout";
export class Application {
  itemsCell = cell<Item[]>([], "items");
  get items() {
    return this.itemsCell.value;
  }
  set items(value: Item[]) {
    this.itemsCell.value = value;
  }
  selectedCell = cell(0, "selectedCell");
  constructor() {
    this.removeItem = this.removeItem.bind(this);
    renderComponent(App({ app: this }), document.getElementById('app')!);
  }
  removeItem(item: Item) {
    this.items = this.items.filter((i) => i.id !== item.id);
  }
  create_1_000itemsCell() {
    this.items = buildData(1000);
  }
  append_1_000itemsCell() {
    this.items = [...this.items, ...buildData(1000)];
  }
  create_5_000itemsCell() {
    this.items = buildData(5000);
  }
  swapRows() {
    this.items = swapRows(this.items);
  }
  clear() {
    this.items = [];
  }
  updateEvery_10th_row() {
    updateData(this.items, 10);
  }
}
