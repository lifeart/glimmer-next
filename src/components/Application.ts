import type { Item } from "@/utils/data";
import { buildData, swapRows, updateData } from "@/utils/data";
import { cell } from "@/utils/reactive";
import { renderComponent, runDestructors } from "@/utils/component";
import { App } from "./AppLayout";
export class Application {
  itemsCell = cell<Item[]>([], "items");
  rootNode!: HTMLElement;
  get items() {
    return this.itemsCell.value;
  }
  set items(value: Item[]) {
    this.itemsCell.value = value;
  }
  selectedCell = cell(0, "selectedCell");
  destroy() {
    runDestructors(this.rootNode);
    this.rootNode.innerHTML = "";
    this.rootNode = null!;
  }
  constructor(rootNode: HTMLElement) {
    this.removeItem = this.removeItem.bind(this);
    this.rootNode = rootNode;
    renderComponent(App({ app: this }), this.rootNode);
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
