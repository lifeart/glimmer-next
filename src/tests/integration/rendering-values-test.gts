import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Rendering | Value edge cases', function () {
  test('null renders as empty text', async function (assert) {
    const value = null;
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('', 'null renders as empty');
  });

  test('undefined renders as empty text', async function (assert) {
    const value = undefined;
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('', 'undefined renders as empty');
  });

  test('0 renders as "0"', async function (assert) {
    const value = 0;
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('0', '0 renders as string "0"');
  });

  test('false renders as "false"', async function (assert) {
    const value = false;
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('false', 'false renders as "false"');
  });

  test('true renders as "true"', async function (assert) {
    const value = true;
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('true', 'true renders as "true"');
  });

  test('empty string renders as empty text', async function (assert) {
    const value = '';
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('', 'empty string renders empty');
  });

  test('number values render correctly', async function (assert) {
    const integer = 42;
    const float = 3.14;
    const negative = -7;
    await render(
      <template>
        <span data-test-int>{{integer}}</span>
        <span data-test-float>{{float}}</span>
        <span data-test-neg>{{negative}}</span>
      </template>,
    );
    assert.dom('[data-test-int]').hasText('42');
    assert.dom('[data-test-float]').hasText('3.14');
    assert.dom('[data-test-neg]').hasText('-7');
  });
});
