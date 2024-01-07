import { buildData, swapRows, updateData, type Item } from '@/utils/data';
import { renderComponent, runDestructors, Component, cell } from '@lifeart/gxt';
import { Header } from './Header.gts';
import { Row } from './Row.gts';
import { PageOne } from './pages/PageOne.gts';
import { PageTwo } from './pages/PageTwo.gts';
import { NestedRouter } from './pages/NestedRouter.gts';
import { router } from './../services/router';
export class Application extends Component {
  router = router;
  itemsCell = cell<Item[]>([], 'items');
  selectedCell = cell(0, 'selectedCell');
  rootNode!: HTMLElement;
  components = {
    pageOne: PageOne,
    pageTwo: PageTwo,
  };
  get items() {
    return this.itemsCell.value;
  }
  set items(value: Item[]) {
    this.itemsCell.value = value;
  }
  get selected() {
    return this.selectedCell.value;
  }
  async destroy() {
    await Promise.all(runDestructors(this.rootNode));
    this.rootNode.innerHTML = '';
    this.rootNode = null!;
  }
  constructor(rootNode: HTMLElement) {
    super({});
    this.rootNode = rootNode;
    // @ts-expect-error wrong signature for template
    renderComponent(this.template(), this.rootNode);
    // router init
    router.mount('/pageOne');
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
      <NestedRouter
        @components={{this.components}}
        @stack={{this.router.stack}}
      />
      <Header
        @run={{this.actions.run}}
        @add={{this.actions.add}}
        @update={{this.actions.update}}
        @clear={{this.actions.clear}}
        @swaprows={{this.actions.swaprows}}
        @runlots={{this.actions.runlots}}
      />
      <table class='table table-hover table-striped test-data'>
        <tbody id='tbody'>
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
