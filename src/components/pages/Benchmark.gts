import {
  buildData,
  swapRows,
  updateData,
  type Item,
} from '@/core/benchmark/data';
import { Component } from '@lifeart/gxt';
import { tracked, cellFor, type Cell } from '@lifeart/gxt';
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
    <div class='text-white p-6 max-w-6xl mx-auto'>
      <Header
        @run={{this.actions.run}}
        @add={{this.actions.add}}
        @update={{this.actions.update}}
        @clear={{this.actions.clear}}
        @swaprows={{this.actions.swaprows}}
        @runlots={{this.actions.runlots}}
      />

      <div class='bg-slate-800/40 backdrop-blur rounded-xl border border-slate-700/50 overflow-hidden'>
        <table class='w-full text-sm'>
          <thead>
            <tr class='border-b border-slate-600 bg-slate-800/50'>
              <th class='px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-20'>
                #
              </th>
              <th class='px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider'>
                Label
              </th>
              <th class='px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider w-20'>
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {{#each this.items key='id' as |item|}}
              <Row
                @item={{item}}
                @onSelect={{this.onSelect}}
                @selected={{this.selected}}
                @onRemove={{this.removeItem}}
              />
            {{/each}}
          </tbody>
        </table>

        {{#unless this._items.length}}
          <div class='px-6 py-12 text-center'>
            <div class='w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-700/50 flex items-center justify-center'>
              <span class='text-3xl'>📋</span>
            </div>
            <p class='text-slate-400 mb-2'>No rows yet</p>
            <p class='text-slate-500 text-sm'>Click "Create 1,000 rows" to start the benchmark</p>
          </div>
        {{/unless}}
      </div>

      <p class='text-xs text-slate-500 mt-4 text-center'>
        Click on a row label to select it. Selected rows are highlighted in blue.
      </p>
    </div>
  </template>
}
