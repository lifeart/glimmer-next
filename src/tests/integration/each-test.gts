import { module, test } from 'qunit';
import { render, rerender, click } from '@/tests/utils';
import { cell } from '@lifeart/gxt';
import { type Cell } from '@/utils/reactive';
import { step } from '../utils';

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
});
