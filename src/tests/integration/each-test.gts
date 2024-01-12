import { module, test } from 'qunit';
import { render, allSettled } from '@/tests/utils';
import { cell } from '@lifeart/gxt';
import { Cell } from '@/utils/reactive';
import { step } from '../utils';

module('Integration | InternalComponent | each', function (hooks) {
  type User = { name: Cell<string> };
  let users: Cell<User[]>;

  hooks.beforeEach(() => {
    users = cell([{ name: cell('Uef') }, { name: cell('Bi') }]);
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
    await allSettled();

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
    await allSettled();

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

    await allSettled();

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
    await allSettled();

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
