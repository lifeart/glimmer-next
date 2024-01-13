import { buildData, swapRows, updateData, type Item } from '@/utils/data';
import { Component, tracked, cellFor, type Cell } from '@lifeart/gxt';
import { Header } from './benchmark/Header.gts';
import { Row } from './benchmark/Row.gts';

export class Benchmark extends Component {
  @tracked
  _items: Item[] = [];
  @tracked
  _selected = 0;
  get items(): Item[] | Cell<Item[]> {
    if (IS_GLIMMER_COMPAT_MODE) {
      return this._items;
    } else {
      return cellFor(this, '_items') as Cell<Item[]>;
    }
  }
  set items(value: Item[]) {
    this._items = value;
    this.selected = 0;
  }
  get selected(): number | Cell<number> {
    if (IS_GLIMMER_COMPAT_MODE) {
      return this._selected;
    } else {
      return cellFor(this, '_selected') as Cell<number>;
    }
  }
  set selected(value: number) {
    this._selected = value;
  }
  rootNode!: HTMLElement;
  removeItem = (item: Item) => {
    this._items = this._items.filter((i) => i.id !== item.id);
  };
  onSelect = (item: Item) => {
    if (this._selected === item.id) {
      this._selected = 0;
      return;
    }
    this._selected = item.id;
  };
  create_1_000itemsCell() {
    this._items = buildData(1000);
  }
  append_1_000itemsCell() {
    this._items = [...this._items, ...buildData(1000)];
  }
  create_5_000itemsCell() {
    this._items = buildData(5000);
  }
  swapRows() {
    this._items = swapRows(this._items);
  }
  clear() {
    this._items = [];
  }
  updateEvery_10th_row() {
    updateData(this._items, 10);
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
    <div class='bg-black p-2'>
      <Header
        @run={{this.actions.run}}
        @add={{this.actions.add}}
        @update={{this.actions.update}}
        @clear={{this.actions.clear}}
        @swaprows={{this.actions.swaprows}}
        @runlots={{this.actions.runlots}}
      />
      <table
        class='w-full text-sm text-left rtl:text-right text-gray-500 dark:text-gray-400'
      >
        <thead
          class='text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400'
        >
          <tr>
            <th scope='col' class='px-6 py-3'>
              #
            </th>
            <th scope='col' class='px-6 py-3'>
              Label
            </th>
            <th scope='col' class='px-6 py-3'>
              Edit
            </th>
          </tr>
        </thead>
        <tbody>
          {{#each this.items as |item|}}
            <Row
              @item={{item}}
              @onSelect={{this.onSelect}}
              @selected={{this.selected}}
              @onRemove={{this.removeItem}}
              class='bg-white border-b dark:bg-gray-800 dark:border-gray-700'
            />
          {{/each}}
        </tbody>
      </table>
    </div>
  </template>
}
