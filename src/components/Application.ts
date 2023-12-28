import type { Item } from "@/utils/data";
import { buildData, swapRows, updateData } from "@/utils/data";
import { ListComponent } from "./list";
import { Cell } from "@/utils/reactive";
import { renderComponent, type ComponentReturnType } from "@/utils/component";
import { Header } from "./Header";
import { RemoveIcon } from "./RemoveIcon";
import { Row } from "./Row";
export class Application {
  _items = new Cell<Item[]>([], "items");
  get items() {
    return this._items.value;
  }
  set items(value: Item[]) {
    this._items.update(value);
  }
  list: ListComponent<Item>;
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
    const ItemComponent = (item: Item) => {
      return Row({ 
        item, 
        selectedCell: this.selectedCell, 
        onRemove: () => this.removeItem(item) 
      });
    }
    this.list = new ListComponent<Item>({ tag: this._items, ItemComponent }, container);

    /* benchmark icon preload span start */
    renderComponent(RemoveIcon(), container);
  
    document.body.appendChild(container);
    /* benchmark icon preload span end */

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
