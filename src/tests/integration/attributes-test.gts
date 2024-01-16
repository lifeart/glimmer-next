import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Interal | ...attributes', function () {
  test('forwards attrs to target node', async function (assert) {
    const Button = <template>
      <button ...attributes>button</button>
    </template>;
    await render(<template><Button data-test-button /></template>);
    assert.dom('[data-test-button]').hasText('button');
  });
  test('it replaces attrs', async function (assert) {
    const Button = <template>
      <button ...attributes data-test-button='test'>button</button>
    </template>;
    await render(<template><Button data-test-button='test2' /></template>);
    assert.dom('[data-test-button="test"]').doesNotExist();
    assert.dom('[data-test-button="test2"]').hasText('button');
  });
  test('it merges class', async function (assert) {
    const Button = <template>
      <button ...attributes class='bar'>button</button>
    </template>;
    await render(<template><Button class='baz' /></template>);
    assert.dom('button').hasClass('bar');
    assert.dom('button').hasClass('baz');
  });
  test('it applying modifiers', async function (assert) {
    assert.expect(1);
    const Button = <template>
      <button ...attributes>button</button>
    </template>;
    const modifier = (button: HTMLEButtonElement) => {
      assert.equal(button.tagName, 'BUTTON');
    };
    await render(<template><Button {{modifier}} /></template>);
  });
});
