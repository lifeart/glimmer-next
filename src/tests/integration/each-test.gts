import { module, test } from 'qunit';
import {
  render,
  rerender,
  click,
  findAll,
  step,
} from '@lifeart/gxt/test-utils';
import { cell, Component, formula, type Cell } from '@lifeart/gxt';

module('Integration | InternalComponent | each', function (hooks) {
  type User = { name: Cell<string> };
  let users: Cell<User[]>;

  hooks.beforeEach(() => {
    users = cell([{ name: cell('Uef') }, { name: cell('Bi') }]);
  });

  function shuffleArray(array: unknown[]) {
    for (let i = array.length - 1; i >= 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      let temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
  }

  test('contained child without node with nested child inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class ChildItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    class SubItem extends Component {
      <template><ChildItem @item={{@item}} /></template>
    }

    class ListItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i><SubItem @item={{@item}} /></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ListItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });
  test('contained child without node inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class SubItem extends Component {
      <template></template>
    }

    class ListItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i><SubItem @item={{@item}} /></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ListItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });
  test('contained child node inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class SubItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    class ListItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i><SubItem @item={{@item}} /></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ListItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });

  test('nested roots (middle) inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class SubItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    class ListItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i></div>
        <SubItem @item={{@item}} />
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ListItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });

  test('nested roots (bottom) inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class SubItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    class ListItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
        <SubItem @item={{@item}} />
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ListItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });

  test('nested roots (top) inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class SubItem extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    class ListItem extends Component {
      <template>
        <SubItem @item={{@item}} />
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ListItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });

  test('multiple roots inside list item (list relocation tests)', async function (assert) {
    const list = cell([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const [i1, i2, i3, i4] = list.value.slice(0);

    class ItemOne extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-one><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    class ItemTwo extends Component {
      <template>
        <div data-test-node-id={{@item.id}} data-test-item-two-1><i
          >Item{{@item.id}}</i></div>
        <div data-test-node-id={{@item.id}} data-test-item-two-2><i
          >Item{{@item.id}}</i></div>
      </template>
    }

    await render(
      <template>
        <div data-test-list>
          {{#each list key='id' as |item|}}
            <ItemOne @item={{item}} />
            <ItemTwo @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );
    assert.dom('[data-test-item-one]').exists({ count: 4 });
    assert.dom('[data-test-item-two-1]').exists({ count: 4 });
    assert.dom('[data-test-item-two-2]').exists({ count: 4 });
    let nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));
    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['1', '1', '1', '2', '2', '2', '3', '3', '3', '4', '4', '4'],
      'Items initially properly rendered',
    );

    list.update([i4, i2, i3, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '2', '2', '2', '3', '3', '3', '1', '1', '1'],
      'Items properly relocated (sides shift)',
    );

    list.update([i4, i3, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['4', '4', '4', '3', '3', '3', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center shift)',
    );

    list.update([i3, i4, i2, i1]);
    await rerender();
    nodes = Array.from(findAll<HTMLDivElement>('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '4', '4', '4', '2', '2', '2', '1', '1', '1'],
      'Items properly relocated (center-top shift)',
    );

    list.update([i3, i2, i1, i4]);
    await rerender();
    nodes = Array.from(findAll('[data-test-node-id]'));

    assert.deepEqual(
      nodes.map((el) => el.dataset.testNodeId),
      ['3', '3', '3', '2', '2', '2', '1', '1', '1', '4', '4', '4'],
      'Items properly relocated (center-bottom shift)',
    );
  });

  test('it properly remove all list items if its rendered with update', async function (assert) {
    function toNamedObject(arr: number[]) {
      return arr.map((el) => {
        return { name: el };
      });
    }
    const items = cell(toNamedObject([1]));
    const isFirstRender = cell(true);

    function PageOne() {
      const isExpanded = formula(() => {
        return items.value.length === 3 || isFirstRender.value === true;
      });
      const toggle = () => {
        if (items.value.length === 3) {
          items.update(toNamedObject([2]));
        } else {
          items.update(toNamedObject([1, 2, 3]));
        }
      };
      return <template>
        <div class='text-white p-3'>
          <button type='button' {{on 'click' toggle}}>toggle</button>
          <ul>
            {{#if (not isExpanded)}}
              <div data-test-not-expanded>NOT EXPANDED</div>
            {{else if isExpanded}}
              {{#each items as |item|}}
                <li data-test-item>{{item.name}}</li>
              {{/each}}
            {{/if}}
          </ul>
        </div>
      </template>;
    }
    await render(<template><PageOne /></template>);
    assert.dom('[data-test-item]').exists({ count: 1 }, 'Render first item');
    items.update(toNamedObject([1, 2, 3]));
    isFirstRender.update(false);
    await rerender();
    assert.dom('[data-test-item]').exists({ count: 3 }, 'Render all items');
    await click('button');
    assert.dom('[data-test-item]').doesNotExist('No list tails left');
    assert.dom('[data-test-not-expanded]').exists({ count: 1 }, 'if toggled');
  });

  test('remove first element', async function (assert) {
    const amountOfItemsToTest = 10;
    const items = cell(
      Array.from({ length: amountOfItemsToTest }, (_, i) => ({ id: cell(i) })),
    );
    await render(
      <template>
        <ul>
          {{#each items sync=true as |user|}}
            <li data-test-user>
              {{user.id}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );
    assert
      .dom('[data-test-user]')
      .exists({ count: amountOfItemsToTest }, 'Number of elements');
    const values = [...items.value.slice(-9)];
    items.update(values);
    await rerender();
    const elements = Array.from(document.querySelectorAll('[data-test-user]'));
    assert.equal(elements.length, 9);
    elements.forEach((node, index) => {
      assert.equal(node.textContent, String(items.value[index].id.value));
    });
  });

  test('random array sort is properly working', async function (assert) {
    const amountOfItemsToTest = 30;
    const items = cell(
      Array.from({ length: amountOfItemsToTest }, (_, i) => ({ id: cell(i) })),
    );
    await render(
      <template>
        <ul>
          {{#each items sync=true as |user|}}
            <li data-test-user>
              {{user.id}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );
    assert
      .dom('[data-test-user]')
      .exists({ count: amountOfItemsToTest }, 'Number of elements');
    const values = [...items.value];
    shuffleArray(values);
    items.update(values);
    await rerender();
    const elements = Array.from(document.querySelectorAll('[data-test-user]'));
    elements.forEach((node, index) => {
      assert.equal(node.textContent, String(items.value[index].id.value));
    });
  });

  test('random array sort with append is properly working', async function (assert) {
    const amountOfItemsToTest = 30;
    const items = cell(
      Array.from({ length: amountOfItemsToTest }, (_, i) => ({ id: cell(i) })),
    );
    const items2 = Array.from({ length: amountOfItemsToTest * 2 }, (_, i) => ({
      id: cell(i),
    })).slice(-29);

    await render(
      <template>
        <ul>
          {{#each items sync=true as |user|}}
            <li data-test-user>
              {{user.id}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );
    assert
      .dom('[data-test-user]')
      .exists({ count: amountOfItemsToTest }, 'Number of elements');
    const values = [...items.value, ...items2];
    shuffleArray(values);
    items.update(values);
    await rerender();
    const elements = Array.from(document.querySelectorAll('[data-test-user]'));
    elements.forEach((node, index) => {
      assert.equal(node.textContent, String(items.value[index].id.value));
    });
  });

  test('random array sort with append and removal is properly working', async function (assert) {
    const amountOfItemsToTest = 30;
    const items = cell(
      Array.from({ length: amountOfItemsToTest }, (_, i) => ({ id: cell(i) })),
    );
    const items2 = Array.from({ length: amountOfItemsToTest * 2 }, (_, i) => ({
      id: cell(i),
    })).slice(-29);

    await render(
      <template>
        <ul>
          {{#each items sync=true as |user|}}
            <li data-test-user>
              {{user.id}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );
    assert
      .dom('[data-test-user]')
      .exists({ count: amountOfItemsToTest }, 'Number of elements');
    const values = [...items.value.slice(0, 15), ...items2];
    shuffleArray(values);
    items.update(values);
    await rerender();
    const elements1 = Array.from(document.querySelectorAll('[data-test-user]'));
    elements1.forEach((node, index) => {
      assert.equal(node.textContent, String(items.value[index].id.value));
    });
    shuffleArray(values);
    items.update(values);
    await rerender();
    const elements2 = Array.from(document.querySelectorAll('[data-test-user]'));
    elements2.forEach((node, index) => {
      assert.equal(node.textContent, String(items.value[index].id.value));
    });
  });

  test('new item could be added in the middle', async function (assert) {
    const items = cell(Array.from({ length: 30 }, (_, i) => ({ id: cell(i) })));
    await render(
      <template>
        <ul>
          {{#each items as |user i|}}
            <li data-test-user={{i}}>
              {{user.id}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('[data-test-user]').exists({ count: 30 }, 'Number of elements');
    assert.dom('[data-test-user="0"]').hasText('0', '0th element text');
    assert.dom('[data-test-user="1"]').hasText('1', '1st element text');
    const newUser = { id: cell(999) };
    const leftPartOfItems = items.value.slice(0, 15);
    const rightPartOfItems = items.value.slice(15);
    items.update([...leftPartOfItems, newUser, ...rightPartOfItems]);
    await rerender();
    assert.dom('[data-test-user]').exists({ count: 31 }, 'Number of elements');
    assert.dom('[data-test-user="15"]').hasText('999', '0th element text');
    // assert dom order
    const elements = document.querySelectorAll('[data-test-user]');
    assert.equal(elements[15].textContent, '999');
  });

  test('it not reactive if non-reactive getter used as source', async function (assert) {
    let iteration = 1;
    const ctx = {
      get values() {
        return new Array(iteration).fill(null).map((_, id) => {
          id;
        });
      },
    };
    await render(
      <template>
        <ul>
          {{#each ctx.values as |value|}}
            <li>{{value}}</li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('li').exists({ count: 1 });
    iteration = 2;
    await rerender();
    assert.dom('li').exists({ count: 1 });
  });

  test('it remains reactive if reactive getter used as source', async function (assert) {
    const iteration = cell(1);
    const ctx = {
      get values() {
        return new Array(iteration.value).fill(null).map((_, id) => {
          id;
        });
      },
    };
    await render(
      <template>
        <ul>
          {{#each ctx.values as |value|}}
            <li>{{value}}</li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('li').exists({ count: 1 });
    iteration.update(2);
    await rerender();
    assert.dom('li').exists({ count: 2 });
    iteration.update(3);
    await rerender();
    assert.dom('li').exists({ count: 3 });

    iteration.update(1);
    await rerender();
    assert.dom('li').exists({ count: 1 });
  });

  test('it support iteration without block params', async function (assert) {
    const list = new Array(10).fill(undefined);
    await render(
      <template>
        <ul>
          {{#each list}}
            <li></li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('li').exists({ count: 10 });
  });

  test('it runs async element destructors for Components with context', async function (assert) {
    const animationDelay = 100;
    const items = cell([{ id: '1' }, { id: '2' }]);
    const removeItem = (item: { id: string }) => {
      items.update(items.value.filter((i) => i.id !== item.id));
    };
    const fadeOut = (node: HTMLLIElement) => {
      node.style.opacity = '1';
      return async () => {
        node.style.opacity = '0.1';
        await new Promise((resolve) => setTimeout(resolve, animationDelay));
      };
    };
    const Li = <template>
      <li
        data-test-user={{@item.id}}
        data-this-hack-is-needed-to-create-child-with-context
        {{fadeOut}}
        {{on 'click' (fn removeItem @item)}}
      >
        {{@item.id}}
      </li>
    </template>;
    await render(
      <template>
        <ul data-test-users>
          {{#each items as |item|}}
            <Li @item={{item}} />
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('[data-test-user]').exists({ count: 2 }, 'Initially 2 elements');
    await click('[data-test-user="1"]');
    await rerender();
    assert
      .dom('[data-test-user]')
      .exists({ count: 2 }, 'After click we should be able to see 2 elements');
    await new Promise((resolve) => setTimeout(resolve, animationDelay));
    assert
      .dom('[data-test-user]')
      .exists(
        { count: 1 },
        'After async destructors, list items are removed from the DOM',
      );
  });
  test('it runs async element destructors for unstable nodes', async function (assert) {
    const animationDelay = 100;
    const items = cell([{ id: '1' }, { id: '2' }]);
    const removeItem = (item: { id: string }) => {
      items.update(items.value.filter((i) => i.id !== item.id));
    };
    const fadeOut = (node: HTMLLIElement) => {
      node.style.opacity = '1';
      return async () => {
        node.style.opacity = '0.1';
        await new Promise((resolve) => setTimeout(resolve, animationDelay));
      };
    };
    await render(
      <template>
        <ul data-test-users>
          {{#each items as |item|}}
            123 321 123 321
            {{! need this ^ to create unstable child wrapper to be able to run async destructors }}
            <li
              data-test-user={{item.id}}
              {{fadeOut}}
              {{on 'click' (fn removeItem item)}}
            >
              {{item.id}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('[data-test-user]').exists({ count: 2 }, 'Number of elements');
    await click('[data-test-user="1"]');
    await rerender();
    assert.dom('[data-test-user]').exists({ count: 2 }, 'Number of elements');
    await new Promise((resolve) => setTimeout(resolve, animationDelay));
    assert.dom('[data-test-user]').exists({ count: 1 }, 'Number of elements');
  });
  test('it wait for async element destructors before destroying', async function (assert) {
    const animationDelay = 100;
    const items = cell([{ id: '1' }, { id: '2' }]);
    const isExpended = cell(true);
    const fadeOut = (node: HTMLLIElement) => {
      node.style.opacity = '1';
      return async () => {
        node.style.opacity = '0.1';
        await new Promise((resolve) => setTimeout(resolve, animationDelay));
      };
    };
    await render(
      <template>
        {{#if isExpended}}
          <ul data-test-users>
            {{#each items as |item|}}
              <li {{fadeOut}}>{{item.id}}</li>
            {{/each}}
          </ul>
        {{/if}}
      </template>,
    );
    assert.dom('li').exists({ count: 2 }, '2 list items visible on the screen');
    isExpended.update(false);
    await rerender();
    assert
      .dom('li')
      .exists(
        { count: 2 },
        'After toggling isExpended, 2 list items still visible on the screen',
      );
    await new Promise((resolve) => setTimeout(resolve, animationDelay));
    assert
      .dom('li')
      .doesNotExist(
        'After async destructors, list items are removed from the DOM',
      );
    assert
      .dom('ul')
      .doesNotExist('After async destructors, list is removed from the DOM');
  });

  test('it renders the list', async function (assert) {
    await render(
      <template>
        <ul data-test-users>
          {{#each users as |user i|}}
            <li data-test-user={{i}}>
              {{user.name}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );

    assert.dom('[data-test-user]').exists({ count: 2 }, 'Number of elements');
    assert.dom('[data-test-user="0"]').hasText('Uef', '0th element text');
    assert.dom('[data-test-user="1"]').hasText('Bi', '1st element text');
  });

  test('it updates the list and retains untouched items', async function (assert) {
    await render(
      <template>
        <ul data-test-users>
          {{#each users as |user i|}}
            <li data-test-user={{i}}>
              {{user.name}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );

    const Uef = document.querySelector('[data-test-user="0"]');

    if (!Uef)
      throw new Error(
        `[data-test-user="0"] is expected to exist at this point`,
      );

    step('Marking a list element in DOM');
    Uef.setAttribute('data-nose-accessory', 'tsak');

    step('Mutating the array, adding a new element');
    users.update([...users.value, { name: cell('Kyrr') }]);
    await rerender();

    assert.dom('[data-test-user]').exists({ count: 3 }, 'Number of elements');
    assert.dom('[data-test-user="0"]').hasText('Uef', '0th element text');
    assert.dom('[data-test-user="1"]').hasText('Bi', '1st element text');
    assert.dom('[data-test-user="2"]').hasText('Kyrr', '2nd element text');

    assert
      .dom('[data-test-user="0"]')
      .hasAttribute(
        'data-nose-accessory',
        'tsak',
        '0th element retains attribute',
      );
  });

  test('it updates an element of the list and retains items by identity', async function (assert) {
    await render(
      <template>
        <ul data-test-users>
          {{#each users as |user i|}}
            <li data-test-user={{i}}>
              {{user.name}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );

    const Uef = document.querySelector('[data-test-user="0"]');

    if (!Uef)
      throw new Error(
        `[data-test-user="0"] is expected to exist at this point`,
      );

    step('Marking a list element in DOM');
    Uef.setAttribute('data-nose-accessory', 'tsak');

    step('Mutating an array item');
    users.value[0].name.update('Mr. P-Zh');
    await rerender();

    assert.dom('[data-test-user]').exists({ count: 2 }, 'Number of elements');
    assert.dom('[data-test-user="0"]').hasText('Mr. P-Zh', '0th element text');
    assert.dom('[data-test-user="1"]').hasText('Bi', '1st element text');

    assert
      .dom('[data-test-user="0"]')
      .hasAttribute(
        'data-nose-accessory',
        'tsak',
        '0th element retains attribute',
      );
  });

  test('it retains items by @identity', async function (assert) {
    await render(
      <template>
        <ul data-test-users>
          {{#each users key='@identity' as |user i|}}
            <li data-test-user={{i}}>
              {{user.name}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );

    const Uef = document.querySelector('[data-test-user="0"]');

    if (!Uef)
      throw new Error(
        `[data-test-user="0"] is expected to exist at this point`,
      );

    step('Marking a list element in DOM');
    Uef.setAttribute('data-nose-accessory', 'tsak');

    step('Mutating the array: same elements, new order');
    users.update([users.value[1], users.value[0]]);

    await rerender();

    assert.dom('[data-test-user]').exists({ count: 2 }, 'Number of elements');
    assert.dom('[data-test-user="0"]').hasText('Bi', '0th element text');
    assert.dom('[data-test-user="1"]').hasText('Uef', '1st element text');

    assert
      .dom('[data-test-user="1"]')
      .hasAttribute(
        'data-nose-accessory',
        'tsak',
        '1th element retains attribute',
      );
  });

  test('it retains items by key', async function (assert) {
    await render(
      <template>
        <ul data-test-users>
          {{#each users key='name.value' as |user i|}}
            <li data-test-user={{i}}>
              {{user.name}}
            </li>
          {{/each}}
        </ul>
      </template>,
    );

    const Uef = document.querySelector('[data-test-user="0"]');

    if (!Uef)
      throw new Error(
        `[data-test-user="0"] is expected to exist at this point`,
      );

    step('Marking a list element in DOM');
    Uef.setAttribute('data-nose-accessory', 'tsak');

    step('Mutating the array: new elements with same names, new order');
    users.update([{ name: cell('Bi') }, { name: cell('Uef') }]);
    await rerender();

    assert.dom('[data-test-user]').exists({ count: 2 }, 'Number of elements');
    assert.dom('[data-test-user="0"]').hasText('Bi', '0th element text');
    assert.dom('[data-test-user="1"]').hasText('Uef', '1st element text');

    assert
      .dom('[data-test-user="1"]')
      .hasAttribute(
        'data-nose-accessory',
        'tsak',
        '1th element retains attribute',
      );
  });

  test('it able to render nested each', async function (assert) {
    const matrix = cell([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    await render(
      <template>
        {{#each matrix as |row|}}
          {{#each row as |cell|}}
            <span data-test-cell>{{cell}}</span>
          {{/each}}
        {{/each}}
      </template>,
    );
    assert.dom('[data-test-cell]').exists({ count: 9 }, 'Number of elements');

    // assert dom order
    const elements = document.querySelectorAll('[data-test-cell]');
    assert.equal(elements[0].textContent, '1');
    assert.equal(elements[1].textContent, '2');
    assert.equal(elements[2].textContent, '3');
    assert.equal(elements[3].textContent, '4');
    assert.equal(elements[4].textContent, '5');
    assert.equal(elements[5].textContent, '6');
    assert.equal(elements[6].textContent, '7');
    assert.equal(elements[7].textContent, '8');
    assert.equal(elements[8].textContent, '9');
    // assert rerender
    matrix.update([
      [9, 8, 7],
      [6, 5, 4],
      [3, 2, 1],
    ]);
    await rerender();
    assert.dom('[data-test-cell]').exists({ count: 9 }, 'Number of elements');
    // assert dom order
    const elements2 = document.querySelectorAll('[data-test-cell]');
    assert.equal(elements2[0].textContent, '9');
    assert.equal(elements2[1].textContent, '8');
    assert.equal(elements2[2].textContent, '7');
    assert.equal(elements2[3].textContent, '6');
    assert.equal(elements2[4].textContent, '5');
    assert.equal(elements2[5].textContent, '4');
    assert.equal(elements2[6].textContent, '3');
    assert.equal(elements2[7].textContent, '2');
    assert.equal(elements2[8].textContent, '1');
  });
  test('each indexes for primitives always updating', async function (assert) {
    const items = cell([1, 1, 1]);
    await render(
      <template>
        <ul>
          {{#each items as |item i|}}
            <li data-test-item={{i}}>{{item}}</li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('[data-test-item]').exists({ count: 3 }, 'Number of elements');
    assert.dom('[data-test-item="0"]').hasText('1', '0th element text');
    assert.dom('[data-test-item="1"]').hasText('1', '1st element text');
    assert.dom('[data-test-item="2"]').hasText('1', '2nd element text');
  });

  // Multiple root nodes (fragment-like) tests
  test('each item with two root elements renders correctly', async function (assert) {
    const items = cell([
      { id: 1, name: 'a', value: '1' },
      { id: 2, name: 'b', value: '2' },
      { id: 3, name: 'c', value: '3' },
    ]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-name data-id={{item.id}}>{{item.name}}</div>
            <span data-test-value data-id={{item.id}}>{{item.value}}</span>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-name]').exists({ count: 3 }, '3 name divs');
    assert.dom('[data-test-value]').exists({ count: 3 }, '3 value spans');

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 6, '6 total child nodes (3 items * 2 roots)');

    // Verify order: div, span, div, span, div, span
    assert.equal(allNodes[0].tagName, 'DIV');
    assert.equal(allNodes[0].textContent, 'a');
    assert.equal(allNodes[1].tagName, 'SPAN');
    assert.equal(allNodes[1].textContent, '1');
    assert.equal(allNodes[2].tagName, 'DIV');
    assert.equal(allNodes[2].textContent, 'b');
    assert.equal(allNodes[3].tagName, 'SPAN');
    assert.equal(allNodes[3].textContent, '2');
    assert.equal(allNodes[4].tagName, 'DIV');
    assert.equal(allNodes[4].textContent, 'c');
    assert.equal(allNodes[5].tagName, 'SPAN');
    assert.equal(allNodes[5].textContent, '3');
  });

  test('each item with two root elements - item removal', async function (assert) {
    const i1 = { id: 1, name: 'a', value: '1' };
    const i2 = { id: 2, name: 'b', value: '2' };
    const i3 = { id: 3, name: 'c', value: '3' };
    const items = cell([i1, i2, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-name data-id={{item.id}}>{{item.name}}</div>
            <span data-test-value data-id={{item.id}}>{{item.value}}</span>
          {{/each}}
        </div>
      </template>,
    );

    assert
      .dom('[data-test-name]')
      .exists({ count: 3 }, 'Initially 3 name divs');

    // Remove middle item
    items.update([i1, i3]);
    await rerender();

    assert
      .dom('[data-test-name]')
      .exists({ count: 2 }, 'After removal: 2 name divs');
    assert
      .dom('[data-test-value]')
      .exists({ count: 2 }, 'After removal: 2 value spans');

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 4, '4 total child nodes after removal');

    assert.equal(allNodes[0].textContent, 'a');
    assert.equal(allNodes[1].textContent, '1');
    assert.equal(allNodes[2].textContent, 'c');
    assert.equal(allNodes[3].textContent, '3');
  });

  test('each item with two root elements - item addition', async function (assert) {
    const i1 = { id: 1, name: 'a', value: '1' };
    const i2 = { id: 2, name: 'b', value: '2' };
    const i3 = { id: 3, name: 'c', value: '3' };
    const items = cell([i1, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-name data-id={{item.id}}>{{item.name}}</div>
            <span data-test-value data-id={{item.id}}>{{item.value}}</span>
          {{/each}}
        </div>
      </template>,
    );

    assert
      .dom('[data-test-name]')
      .exists({ count: 2 }, 'Initially 2 name divs');

    // Add item in the middle
    items.update([i1, i2, i3]);
    await rerender();

    assert
      .dom('[data-test-name]')
      .exists({ count: 3 }, 'After addition: 3 name divs');

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 6, '6 total child nodes after addition');

    assert.equal(allNodes[0].textContent, 'a');
    assert.equal(allNodes[1].textContent, '1');
    assert.equal(allNodes[2].textContent, 'b');
    assert.equal(allNodes[3].textContent, '2');
    assert.equal(allNodes[4].textContent, 'c');
    assert.equal(allNodes[5].textContent, '3');
  });

  test('each item with two root elements - reorder items', async function (assert) {
    const i1 = { id: 1, name: 'a', value: '1' };
    const i2 = { id: 2, name: 'b', value: '2' };
    const i3 = { id: 3, name: 'c', value: '3' };
    const items = cell([i1, i2, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-name data-id={{item.id}}>{{item.name}}</div>
            <span data-test-value data-id={{item.id}}>{{item.value}}</span>
          {{/each}}
        </div>
      </template>,
    );

    // Reverse order
    items.update([i3, i2, i1]);
    await rerender();

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 6, '6 total child nodes');

    assert.equal(allNodes[0].textContent, 'c');
    assert.equal(allNodes[1].textContent, '3');
    assert.equal(allNodes[2].textContent, 'b');
    assert.equal(allNodes[3].textContent, '2');
    assert.equal(allNodes[4].textContent, 'a');
    assert.equal(allNodes[5].textContent, '1');
  });

  test('each item with three root elements of different types', async function (assert) {
    const items = cell([
      { id: 1, title: 'Title 1', subtitle: 'Sub 1' },
      { id: 2, title: 'Title 2', subtitle: 'Sub 2' },
    ]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <span data-test-icon data-id={{item.id}}>*</span>
            <strong data-test-title data-id={{item.id}}>{{item.title}}</strong>
            <em data-test-subtitle data-id={{item.id}}>{{item.subtitle}}</em>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-icon]').exists({ count: 2 });
    assert.dom('[data-test-title]').exists({ count: 2 });
    assert.dom('[data-test-subtitle]').exists({ count: 2 });

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 6, '6 total child nodes (2 items * 3 roots)');

    assert.equal(allNodes[0].tagName, 'SPAN');
    assert.equal(allNodes[1].tagName, 'STRONG');
    assert.equal(allNodes[1].textContent, 'Title 1');
    assert.equal(allNodes[2].tagName, 'EM');
    assert.equal(allNodes[2].textContent, 'Sub 1');
  });

  test('each item with text node and element as roots', async function (assert) {
    const items = cell([
      { id: 1, prefix: 'var: ', code: 'x = 1' },
      { id: 2, prefix: 'const: ', code: 'y = 2' },
    ]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            {{item.prefix}}<code
              data-test-code
              data-id={{item.id}}
            >{{item.code}}</code>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-code]').exists({ count: 2 });
    assert.dom('[data-test-container]').hasText('var: x = 1const: y = 2');
  });

  test('each item with mixed single and multiple roots', async function (assert) {
    const singleRootItem = { id: 1, type: 'single' as const, text: 'Single' };
    const multiRootItem = {
      id: 2,
      type: 'multi' as const,
      text1: 'Multi1',
      text2: 'Multi2',
    };
    const items = cell([singleRootItem, multiRootItem]);

    const eq = (a: string, b: string) => a === b;

    class ItemComponent extends Component<{
      Args: { item: typeof singleRootItem | typeof multiRootItem };
    }> {
      <template>
        {{#if (eq @item.type 'single')}}
          <div data-test-single>{{@item.text}}</div>
        {{else}}
          <div data-test-multi-1>{{@item.text1}}</div>
          <div data-test-multi-2>{{@item.text2}}</div>
        {{/if}}
      </template>
    }

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <ItemComponent @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-single]').exists({ count: 1 });
    assert.dom('[data-test-multi-1]').exists({ count: 1 });
    assert.dom('[data-test-multi-2]').exists({ count: 1 });
  });

  test('nested each - outer items have multiple roots', async function (assert) {
    const categories = cell([
      { id: 1, name: 'Category 1', items: ['a', 'b'] },
      { id: 2, name: 'Category 2', items: ['c'] },
    ]);

    await render(
      <template>
        <div data-test-container>
          {{#each categories key='id' as |cat|}}
            <h2 data-test-category-name data-id={{cat.id}}>{{cat.name}}</h2>
            <ul data-test-category-list data-id={{cat.id}}>
              {{#each cat.items as |item|}}
                <li data-test-item>{{item}}</li>
              {{/each}}
            </ul>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-category-name]').exists({ count: 2 });
    assert.dom('[data-test-category-list]').exists({ count: 2 });
    assert.dom('[data-test-item]').exists({ count: 3 });

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(
      allNodes.length,
      4,
      '4 top-level nodes (2 categories * 2 roots)',
    );
    assert.equal(allNodes[0].tagName, 'H2');
    assert.equal(allNodes[1].tagName, 'UL');
    assert.equal(allNodes[2].tagName, 'H2');
    assert.equal(allNodes[3].tagName, 'UL');
  });

  test('nested each - inner items have multiple roots', async function (assert) {
    const rows = cell([
      {
        id: 1,
        cols: [
          { label: 'A', value: '1' },
          { label: 'B', value: '2' },
        ],
      },
    ]);

    await render(
      <template>
        <div data-test-container>
          {{#each rows key='id' as |row|}}
            <div data-test-row data-id={{row.id}}>
              {{#each row.cols as |col|}}
                <span data-test-label>{{col.label}}</span>
                <input data-test-input value={{col.value}} />
              {{/each}}
            </div>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-row]').exists({ count: 1 });
    assert.dom('[data-test-label]').exists({ count: 2 });
    assert.dom('[data-test-input]').exists({ count: 2 });

    const rowNodes = findAll('[data-test-row] > *');
    assert.equal(rowNodes.length, 4, '4 nodes inside row (2 cols * 2 roots)');
  });

  test('each with comment-like markers as part of multiple roots', async function (assert) {
    const items = cell([
      { id: 1, content: 'Content 1' },
      { id: 2, content: 'Content 2' },
    ]);

    class MarkedItem extends Component<{
      Args: { item: { id: number; content: string } };
    }> {
      <template>
        <div data-test-start data-id={{@item.id}}>[start]</div>
        <div data-test-content data-id={{@item.id}}>{{@item.content}}</div>
        <div data-test-end data-id={{@item.id}}>[end]</div>
      </template>
    }

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <MarkedItem @item={{item}} />
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-start]').exists({ count: 2 });
    assert.dom('[data-test-content]').exists({ count: 2 });
    assert.dom('[data-test-end]').exists({ count: 2 });

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 6, '6 nodes (2 items * 3 roots)');
  });

  test('each with many root nodes per item', async function (assert) {
    const items = cell([{ id: 1 }]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |_item|}}
            <span data-test-node>1</span>
            <span data-test-node>2</span>
            <span data-test-node>3</span>
            <span data-test-node>4</span>
            <span data-test-node>5</span>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-node]').exists({ count: 5 });

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 5, '5 nodes for single item');
    assert.equal(allNodes[0].textContent, '1');
    assert.equal(allNodes[4].textContent, '5');
  });

  test('each - empty list then populate with multi-root items', async function (assert) {
    const i1 = { id: 1, a: 'A1', b: 'B1' };
    const i2 = { id: 2, a: 'A2', b: 'B2' };
    const items = cell<(typeof i1)[]>([]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-a data-id={{item.id}}>{{item.a}}</div>
            <div data-test-b data-id={{item.id}}>{{item.b}}</div>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-a]').doesNotExist('Initially empty');

    items.update([i1, i2]);
    await rerender();

    assert.dom('[data-test-a]').exists({ count: 2 });
    assert.dom('[data-test-b]').exists({ count: 2 });

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 4, '4 nodes after populating');
  });

  test('each - clear all multi-root items', async function (assert) {
    const i1 = { id: 1, a: 'A1', b: 'B1' };
    const i2 = { id: 2, a: 'A2', b: 'B2' };
    const items = cell([i1, i2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-a data-id={{item.id}}>{{item.a}}</div>
            <div data-test-b data-id={{item.id}}>{{item.b}}</div>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-a]').exists({ count: 2 });

    items.update([]);
    await rerender();

    assert.dom('[data-test-a]').doesNotExist('All items cleared');
    assert.dom('[data-test-b]').doesNotExist('All items cleared');

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 0, '0 nodes after clearing');
  });

  // Corner case tests for multiple root nodes
  test('each - swap two adjacent items with multiple roots', async function (assert) {
    const i1 = { id: 1, a: 'A1', b: 'B1' };
    const i2 = { id: 2, a: 'A2', b: 'B2' };
    const items = cell([i1, i2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-a data-id={{item.id}}>{{item.a}}</div>
            <span data-test-b data-id={{item.id}}>{{item.b}}</span>
          {{/each}}
        </div>
      </template>,
    );

    let nodes = findAll('[data-test-container] > *');
    assert.equal(nodes[0].textContent, 'A1');
    assert.equal(nodes[1].textContent, 'B1');
    assert.equal(nodes[2].textContent, 'A2');
    assert.equal(nodes[3].textContent, 'B2');

    // Swap items
    items.update([i2, i1]);
    await rerender();

    nodes = findAll('[data-test-container] > *');
    assert.equal(nodes[0].textContent, 'A2', 'After swap: first is A2');
    assert.equal(nodes[1].textContent, 'B2', 'After swap: second is B2');
    assert.equal(nodes[2].textContent, 'A1', 'After swap: third is A1');
    assert.equal(nodes[3].textContent, 'B1', 'After swap: fourth is B1');
  });

  test('each - swap first and last items with multiple roots', async function (assert) {
    const i1 = { id: 1, a: 'A1', b: 'B1' };
    const i2 = { id: 2, a: 'A2', b: 'B2' };
    const i3 = { id: 3, a: 'A3', b: 'B3' };
    const items = cell([i1, i2, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-a data-id={{item.id}}>{{item.a}}</div>
            <span data-test-b data-id={{item.id}}>{{item.b}}</span>
          {{/each}}
        </div>
      </template>,
    );

    // Swap first and last
    items.update([i3, i2, i1]);
    await rerender();

    const nodes = findAll('[data-test-container] > *');
    assert.equal(nodes[0].textContent, 'A3');
    assert.equal(nodes[1].textContent, 'B3');
    assert.equal(nodes[2].textContent, 'A2');
    assert.equal(nodes[3].textContent, 'B2');
    assert.equal(nodes[4].textContent, 'A1');
    assert.equal(nodes[5].textContent, 'B1');
  });

  test('each - complete reverse with multiple roots', async function (assert) {
    const i1 = { id: 1, x: '1' };
    const i2 = { id: 2, x: '2' };
    const i3 = { id: 3, x: '3' };
    const i4 = { id: 4, x: '4' };
    const items = cell([i1, i2, i3, i4]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <span data-test-first>{{item.x}}</span>
            <span data-test-second>-{{item.x}}</span>
          {{/each}}
        </div>
      </template>,
    );

    // Reverse
    items.update([i4, i3, i2, i1]);
    await rerender();

    const nodes = findAll('[data-test-container] > *');
    assert.equal(nodes.length, 8);
    assert.equal(nodes[0].textContent, '4');
    assert.equal(nodes[1].textContent, '-4');
    assert.equal(nodes[6].textContent, '1');
    assert.equal(nodes[7].textContent, '-1');
  });

  test('each - shuffle items with multiple roots', async function (assert) {
    const i1 = { id: 1, v: '1' };
    const i2 = { id: 2, v: '2' };
    const i3 = { id: 3, v: '3' };
    const i4 = { id: 4, v: '4' };
    const i5 = { id: 5, v: '5' };
    const items = cell([i1, i2, i3, i4, i5]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <em data-test-item>{{item.v}}</em>
            <strong data-test-item>!</strong>
          {{/each}}
        </div>
      </template>,
    );

    // Shuffle: 3, 1, 5, 2, 4
    items.update([i3, i1, i5, i2, i4]);
    await rerender();

    const nodes = findAll('[data-test-container] > em');
    assert.equal(nodes[0].textContent, '3');
    assert.equal(nodes[1].textContent, '1');
    assert.equal(nodes[2].textContent, '5');
    assert.equal(nodes[3].textContent, '2');
    assert.equal(nodes[4].textContent, '4');
  });

  test('each - remove and re-add same item with multiple roots', async function (assert) {
    const i1 = { id: 1, v: 'A' };
    const i2 = { id: 2, v: 'B' };
    const items = cell([i1, i2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-v>{{item.v}}</div>
            <div data-test-v>{{item.v}}2</div>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-v]').exists({ count: 4 });

    // Remove i1
    items.update([i2]);
    await rerender();

    assert.dom('[data-test-v]').exists({ count: 2 });

    // Re-add i1 at the end
    items.update([i2, i1]);
    await rerender();

    assert.dom('[data-test-v]').exists({ count: 4 });
    const nodes = findAll('[data-test-v]');
    assert.equal(nodes[0].textContent, 'B');
    assert.equal(nodes[1].textContent, 'B2');
    assert.equal(nodes[2].textContent, 'A');
    assert.equal(nodes[3].textContent, 'A2');
  });

  test('each - replace all items at once with multiple roots', async function (assert) {
    const i1 = { id: 1, v: 'old1' };
    const i2 = { id: 2, v: 'old2' };
    const i3 = { id: 3, v: 'new1' };
    const i4 = { id: 4, v: 'new2' };
    const items = cell([i1, i2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <p data-test-p>{{item.v}}</p>
            <hr data-test-hr />
          {{/each}}
        </div>
      </template>,
    );

    let nodes = findAll('[data-test-p]');
    assert.equal(nodes[0].textContent, 'old1');
    assert.equal(nodes[1].textContent, 'old2');

    // Replace all
    items.update([i3, i4]);
    await rerender();

    nodes = findAll('[data-test-p]');
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].textContent, 'new1');
    assert.equal(nodes[1].textContent, 'new2');
  });

  test('each - rapid sequential updates with multiple roots', async function (assert) {
    const i1 = { id: 1, v: '1' };
    const i2 = { id: 2, v: '2' };
    const i3 = { id: 3, v: '3' };
    const items = cell([i1]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <span data-test-n>{{item.v}}</span>
            <span data-test-n>+</span>
          {{/each}}
        </div>
      </template>,
    );

    // Rapid updates
    items.update([i1, i2]);
    items.update([i1, i2, i3]);
    items.update([i3, i2, i1]);
    await rerender();

    const nodes = findAll(
      '[data-test-container] > span[data-test-n]:not([data-test-n="+"])',
    );
    // Filter to get only value spans
    const valueNodes = Array.from(findAll('[data-test-n]')).filter(
      (n) => n.textContent !== '+',
    );
    assert.equal(valueNodes.length, 3);
    assert.equal(valueNodes[0].textContent, '3');
    assert.equal(valueNodes[1].textContent, '2');
    assert.equal(valueNodes[2].textContent, '1');
  });

  test('each - item with component that has multiple roots inside', async function (assert) {
    class MultiRootChild extends Component {
      <template>
        <span data-test-child-a>A</span>
        <span data-test-child-b>B</span>
      </template>
    }

    const items = cell([{ id: 1 }, { id: 2 }]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-wrapper data-id={{item.id}}>
              <MultiRootChild />
            </div>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-wrapper]').exists({ count: 2 });
    assert.dom('[data-test-child-a]').exists({ count: 2 });
    assert.dom('[data-test-child-b]').exists({ count: 2 });
  });

  test('each - item component yields multiple roots via block', async function (assert) {
    class Wrapper extends Component<{ Blocks: { default: [] } }> {
      <template>
        <div data-test-before>before</div>
        {{yield}}
        <div data-test-after>after</div>
      </template>
    }

    const items = cell([{ id: 1, text: 'Item 1' }]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <Wrapper>
              <span data-test-content>{{item.text}}</span>
            </Wrapper>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-before]').exists({ count: 1 });
    assert.dom('[data-test-content]').hasText('Item 1');
    assert.dom('[data-test-after]').exists({ count: 1 });
  });

  test('each - conditional rendering changes root count', async function (assert) {
    const showExtra = cell(false);
    const items = cell([{ id: 1, v: 'X' }]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-main>{{item.v}}</div>
            {{#if showExtra}}
              <div data-test-extra>extra</div>
            {{/if}}
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-main]').exists({ count: 1 });
    assert.dom('[data-test-extra]').doesNotExist();

    showExtra.update(true);
    await rerender();

    assert.dom('[data-test-main]').exists({ count: 1 });
    assert.dom('[data-test-extra]').exists({ count: 1 });

    showExtra.update(false);
    await rerender();

    assert.dom('[data-test-extra]').doesNotExist();
  });

  test('each - multiple roots with DOM element retention', async function (assert) {
    const i1 = { id: 1, v: 'A' };
    const i2 = { id: 2, v: 'B' };
    const items = cell([i1, i2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-div data-id={{item.id}}>{{item.v}}</div>
            <span data-test-span data-id={{item.id}}>{{item.v}}</span>
          {{/each}}
        </div>
      </template>,
    );

    // Mark elements to verify DOM retention
    const div1 = document.querySelector('[data-test-div][data-id="1"]');
    const span1 = document.querySelector('[data-test-span][data-id="1"]');
    div1?.setAttribute('data-marked', 'yes');
    span1?.setAttribute('data-marked', 'yes');

    // Reorder
    items.update([i2, i1]);
    await rerender();

    // Verify same DOM elements were moved (not recreated)
    const movedDiv = document.querySelector('[data-test-div][data-id="1"]');
    const movedSpan = document.querySelector('[data-test-span][data-id="1"]');
    assert.equal(
      movedDiv?.getAttribute('data-marked'),
      'yes',
      'div was moved, not recreated',
    );
    assert.equal(
      movedSpan?.getAttribute('data-marked'),
      'yes',
      'span was moved, not recreated',
    );
  });

  test('each - insert at beginning with multiple roots', async function (assert) {
    const i1 = { id: 1, v: '1' };
    const i2 = { id: 2, v: '2' };
    const i3 = { id: 3, v: '3' };
    const items = cell([i2, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <b data-test-b>{{item.v}}</b>
            <i data-test-i>{{item.v}}</i>
          {{/each}}
        </div>
      </template>,
    );

    // Insert at beginning
    items.update([i1, i2, i3]);
    await rerender();

    const bNodes = findAll('[data-test-b]');
    assert.equal(bNodes.length, 3);
    assert.equal(bNodes[0].textContent, '1');
    assert.equal(bNodes[1].textContent, '2');
    assert.equal(bNodes[2].textContent, '3');
  });

  test('each - insert at end with multiple roots', async function (assert) {
    const i1 = { id: 1, v: '1' };
    const i2 = { id: 2, v: '2' };
    const i3 = { id: 3, v: '3' };
    const items = cell([i1, i2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <b data-test-b>{{item.v}}</b>
            <i data-test-i>{{item.v}}</i>
          {{/each}}
        </div>
      </template>,
    );

    // Insert at end
    items.update([i1, i2, i3]);
    await rerender();

    const bNodes = findAll('[data-test-b]');
    assert.equal(bNodes.length, 3);
    assert.equal(bNodes[2].textContent, '3');
  });

  test('each - remove from beginning with multiple roots', async function (assert) {
    const i1 = { id: 1, v: '1' };
    const i2 = { id: 2, v: '2' };
    const i3 = { id: 3, v: '3' };
    const items = cell([i1, i2, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <u data-test-u>{{item.v}}</u>
            <s data-test-s>{{item.v}}</s>
          {{/each}}
        </div>
      </template>,
    );

    // Remove from beginning
    items.update([i2, i3]);
    await rerender();

    const uNodes = findAll('[data-test-u]');
    assert.equal(uNodes.length, 2);
    assert.equal(uNodes[0].textContent, '2');
    assert.equal(uNodes[1].textContent, '3');
  });

  test('each - remove from end with multiple roots', async function (assert) {
    const i1 = { id: 1, v: '1' };
    const i2 = { id: 2, v: '2' };
    const i3 = { id: 3, v: '3' };
    const items = cell([i1, i2, i3]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <u data-test-u>{{item.v}}</u>
            <s data-test-s>{{item.v}}</s>
          {{/each}}
        </div>
      </template>,
    );

    // Remove from end
    items.update([i1, i2]);
    await rerender();

    const uNodes = findAll('[data-test-u]');
    assert.equal(uNodes.length, 2);
    assert.equal(uNodes[0].textContent, '1');
    assert.equal(uNodes[1].textContent, '2');
  });

  test('each - multiple updates: add then remove with multiple roots', async function (assert) {
    const i1 = { id: 1, v: 'A' };
    const i2 = { id: 2, v: 'B' };
    const i3 = { id: 3, v: 'C' };
    const items = cell([i1]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <div data-test-d>{{item.v}}</div>
            <div data-test-d>{{item.v}}!</div>
          {{/each}}
        </div>
      </template>,
    );

    // Add items
    items.update([i1, i2, i3]);
    await rerender();
    assert.dom('[data-test-d]').exists({ count: 6 });

    // Remove middle
    items.update([i1, i3]);
    await rerender();
    assert.dom('[data-test-d]').exists({ count: 4 });

    // Add back in different position
    items.update([i2, i1, i3]);
    await rerender();

    const nodes = findAll('[data-test-d]');
    assert.equal(nodes.length, 6);
    assert.equal(nodes[0].textContent, 'B');
    assert.equal(nodes[2].textContent, 'A');
    assert.equal(nodes[4].textContent, 'C');
  });

  test('each - single item list with multiple roots', async function (assert) {
    const i1 = { id: 1, v: 'only' };
    const items = cell([i1]);

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <header data-test-header>{{item.v}}</header>
            <main data-test-main>content</main>
            <footer data-test-footer>end</footer>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-header]').hasText('only');
    assert.dom('[data-test-main]').hasText('content');
    assert.dom('[data-test-footer]').hasText('end');

    const allNodes = findAll('[data-test-container] > *');
    assert.equal(allNodes.length, 3);
  });

  test('each - large list with multiple roots performance', async function (assert) {
    const createItems = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: i, v: String(i) }));

    const items = cell(createItems(50));

    await render(
      <template>
        <div data-test-container>
          {{#each items key='id' as |item|}}
            <span data-test-a>{{item.v}}</span>
            <span data-test-b>.</span>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-a]').exists({ count: 50 });
    assert.dom('[data-test-b]').exists({ count: 50 });

    // Reverse large list
    items.update(createItems(50).reverse());
    await rerender();

    const aNodes = findAll('[data-test-a]');
    assert.equal(aNodes[0].textContent, '49');
    assert.equal(aNodes[49].textContent, '0');
  });

  test('each - identity key with multiple roots', async function (assert) {
    const obj1 = { name: 'first' };
    const obj2 = { name: 'second' };
    const items = cell([obj1, obj2]);

    await render(
      <template>
        <div data-test-container>
          {{#each items as |item|}}
            <div data-test-name>{{item.name}}</div>
            <div data-test-sep>---</div>
          {{/each}}
        </div>
      </template>,
    );

    assert.dom('[data-test-name]').exists({ count: 2 });

    // Reorder using identity
    items.update([obj2, obj1]);
    await rerender();

    const nameNodes = findAll('[data-test-name]');
    assert.equal(nameNodes[0].textContent, 'second');
    assert.equal(nameNodes[1].textContent, 'first');
  });
});
