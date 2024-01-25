import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | Internal | Cell', function () {
  test('could render cell as text primitive', async function (assert) {
    const value = cell('foo');
    await render(<template>{{value}}</template>);

    assert.dom().hasText('foo', 'cell value is rendered');
    value.update('bar');
    await rerender();
    assert.dom().hasText('bar', 'cell value is updated');
  });
  test('could render cell as attr primitive', async function (assert) {
    const value = cell('foo');
    await render(
      <template>
        <div id={{value}}>123</div>
      </template>,
    );

    assert.dom('#foo').hasText('123', 'cell value is rendered');
    value.update('bar');
    await rerender();
    assert.dom('#bar').hasText('123', 'cell value is updated');
    assert.dom('#foo').doesNotExist('old cell value is removed');
  });
  test('could render cell as prop primitive', async function (assert) {
    const value = cell(true);
    await render(<template><input checked={{value}} /></template>);

    assert.dom('input').isChecked('cell value is rendered');
    value.update(false);
    await rerender();
    assert.dom('input').isNotChecked('cell value is updated');
  });
  test('it works for reactive className property', async function (assert) {
    const value = cell('foo');
    await render(
      <template>
        <div class={{value}}>123</div>
      </template>,
    );

    assert.dom('div').hasClass('foo', 'cell value is rendered');
    value.update('bar');
    await rerender();
    assert.dom('div').hasClass('bar', 'cell value is updated');
    assert.dom('div').doesNotHaveClass('foo', 'old cell value is removed');
  });
});
