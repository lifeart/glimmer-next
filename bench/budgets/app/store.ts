import { cell } from '@lifeart/gxt';
import { type Item, buildData, swapRows, updateData } from './data';

/** krausest app state, shared by every row kind (same cells, same ops). */
export class Store {
  itemsCell = cell<Item[]>([]);
  selectedCell = cell(0);
  get items(): Item[] {
    return this.itemsCell.value;
  }
  set items(value: Item[]) {
    this.itemsCell.value = value;
  }
  get selected(): number {
    return this.selectedCell.value;
  }
  set selected(value: number) {
    this.selectedCell.value = value;
  }
  select = (item: Item) => {
    this.selected = this.selected === item.id ? 0 : item.id;
  };
  remove = (item: Item) => {
    this.items = this.items.filter((i) => i !== item);
  };
  run(count: number) {
    this.items = buildData(count);
  }
  add(count: number) {
    this.items = this.items.concat(buildData(count));
  }
  update() {
    updateData(this.items, 10);
  }
  swap() {
    this.items = swapRows(this.items);
  }
  clear() {
    this.items = [];
  }
}
