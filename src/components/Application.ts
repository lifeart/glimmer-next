import type { Item } from "@/utils/data";
import { buildData, swapRows, updateData } from "@/utils/data";
import { ListComponent } from "./list";
import { Cell } from "@/utils/reactive";
import { renderComponent, type ComponentReturnType } from "@/utils/component";
import { bindUpdatingOpcode } from "@/utils/vm";
import { Header } from "./Header";
import { RemoveIcon } from "./RemoveIcon";
export class Application {
  _items = new Cell<Item[]>([], "items");
  get items() {
    return this._items.value;
  }
  set items(value: Item[]) {
    this._items.update(value);
  }
  list: ListComponent;
  children: ComponentReturnType[] = [];
  selectedCell = new Cell(0, "selectedCell");
  constructor() {
    /* benchmark bootstrap start */
    const container = document.createElement("container");
    container.className = "container";
    

    const header = Header({
      run: () => this.create_1_000_Items(),
      add: () => this.append_1_000_Items(),
      update: () => this.updateEvery_10th_row(),
      clear: () => this.clear(),
      swaprows: () => this.swapRows(),
      runlots: () => this.create_5_000_Items(),
    })

    renderComponent(header, container);
  
    this.items = [];
    this.list = new ListComponent({ app: this, items: this.items }, container);

    /* benchmark icon preload span start */
    renderComponent(RemoveIcon(), container);
  
    document.body.appendChild(container);
    /* benchmark icon preload span end */

    bindUpdatingOpcode(this._items, () => {
      this.list.syncList(this.items);
    });

    this.children.push(this.list);
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
