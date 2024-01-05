import type { Item } from '@/utils/data';
import { buildData, swapRows, updateData } from '@/utils/data';
import { cell } from '@/utils/reactive';
import { renderComponent, runDestructors } from '@/utils/component';
import { Header } from './Header.gts';
import { Component } from '@/utils/component';
import { Row } from './Row.gts';
import { Icon } from './Icon.gts';

export class Application extends Component {
  itemsCell = cell<Item[]>([], 'items');
  rootNode!: HTMLElement;
  get items() {
    return this.itemsCell.value;
  }
  set items(value: Item[]) {
    this.itemsCell.value = value;
  }
  selectedCell = cell(0, 'selectedCell');
  async destroy() {
    await Promise.all(runDestructors(this.rootNode));
    this.rootNode.innerHTML = '';
    this.rootNode = null!;
  }
  constructor(rootNode: HTMLElement) {
    super({});
    this.removeItem = this.removeItem.bind(this);
    this.rootNode = rootNode;
    // @ts-expect-error wrong signature for template
    renderComponent(this.template(), this.rootNode);
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
      <Icon />
      <table class='table table-hover table-striped test-data'>
        <tbody id='tbody'>
          {{#each this.itemsCell as |item|}}
            <Row
              @item={{item}}
              @selectedCell={{this.selectedCell}}
              @onRemove={{this.removeItem}}
            />
          {{/each}}
        </tbody>
      </table>
    </div>
  </template>
}
