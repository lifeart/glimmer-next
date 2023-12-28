import type { Item } from "@/utils/data";
import { buildData, swapRows, updateData } from "@/utils/data";
import { Cell } from "@/utils/reactive";
import { renderComponent, type ComponentReturnType } from "@/utils/component";
import { App } from "./App";
export class Application {
  _items = new Cell<Item[]>([], "items");
  get items() {
    return this._items.value;
  }
  set items(value: Item[]) {
    this._items.update(value);
  }
  children: ComponentReturnType[] = [];
  selectedCell = new Cell(0, "selectedCell");
  constructor() {
    this.removeItem = this.removeItem.bind(this);
    const app = App({ app: this });
    renderComponent(app, document.body);
  }
  removeItem(item: Item) {
    this.items = this.items.filter((i) => i.id !== item.id);
  }
  create_1_000_Items() {
    this.items = buildData(1000);
  }
  append_1_000_Items() {
    this.items = [...this.items, ...buildData(1000)];
  }
  create_5_000_Items() {
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
