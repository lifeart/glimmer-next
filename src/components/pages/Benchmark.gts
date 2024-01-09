import { buildData, swapRows, updateData, type Item } from '@/utils/data';
import { Component, cell } from '@lifeart/gxt';
import { Header } from './benchmark/Header.gts';
import { Row } from './benchmark/Row.gts';

export class Benchmark extends Component {
  itemsCell = cell<Item[]>([], 'items');
  selectedCell = cell(0, 'selectedCell');
  rootNode!: HTMLElement;
  get items() {
    return this.itemsCell.value;
  }
  set items(value: Item[]) {
    this.itemsCell.value = value;
  }
  get selected() {
    return this.selectedCell.value;
  }
  removeItem = (item: Item) => {
    this.items = this.items.filter((i) => i.id !== item.id);
  };
  onSelect = (item: Item) => {
    if (this.selectedCell.value === item.id) {
      this.selectedCell.value = 0;
      return;
    }
    this.selectedCell.value = item.id;
  };
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
  actions = {
    run: () => this.create_1_000itemsCell(),
    add: () => this.append_1_000itemsCell(),
    update: () => this.updateEvery_10th_row(),
    clear: () => this.clear(),
    swaprows: () => this.swapRows(),
    runlots: () => this.create_5_000itemsCell(),
  };
  <template>
    <div class='container'>
      <Header
        @run={{this.actions.run}}
        @add={{this.actions.add}}
        @update={{this.actions.update}}
        @clear={{this.actions.clear}}
        @swaprows={{this.actions.swaprows}}
        @runlots={{this.actions.runlots}}
      />
      <table class='table-auto'>
        <tbody>
          {{#each this.items as |item|}}
            <Row
              @item={{item}}
              @onSelect={{this.onSelect}}
              @selected={{this.selected}}
              @onRemove={{this.removeItem}}
            />
          {{/each}}
        </tbody>
      </table>
    </div>
  </template>
}
