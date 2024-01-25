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
});
