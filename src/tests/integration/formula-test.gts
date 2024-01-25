import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell, formula } from '@lifeart/gxt';

module('Integration | Internal | MergedCell & formula ', function () {
  test('could render MergedCell as text primitive [explicit formula]', async function (assert) {
    const _value = cell('foo');
    const value = formula(() => _value.value);
    await render(<template>{{value}}</template>);

    assert.dom().hasText('foo', 'cell value is rendered');
    _value.update('bar');
    await rerender();
    assert.dom().hasText('bar', 'cell value is updated');
  });
  test('could render MergedCell as attr primitive [explicit formula]', async function (assert) {
    const _value = cell('foo');
    const value = formula(() => _value.value);

    await render(
      <template>
        <div id={{value}}>123</div>
      </template>,
    );

    assert.dom('#foo').hasText('123', 'cell value is rendered');
    _value.update('bar');
    await rerender();
    assert.dom('#bar').hasText('123', 'cell value is updated');
    assert.dom('#foo').doesNotExist('old cell value is removed');
  });
  test('could render MergedCell as prop primitive [explicit formula]', async function (assert) {
    const _value = cell(true);
    const value = formula(() => _value.value);

    await render(<template><input checked={{value}} /></template>);

    assert.dom('input').isChecked('cell value is rendered');
    _value.update(false);
    await rerender();
    assert.dom('input').isNotChecked('cell value is updated');
  });
  test('it works for reactive className property [explicit formula]', async function (assert) {
    const _value = cell('foo');
    const value = formula(() => _value.value);

    await render(
      <template>
        <div class={{value}}>123</div>
      </template>,
    );

    assert.dom('div').hasClass('foo', 'cell value is rendered');
    _value.update('bar');
    await rerender();
    assert.dom('div').hasClass('bar', 'cell value is updated');
    assert.dom('div').doesNotHaveClass('foo', 'old cell value is removed');
  });

  test('could render MergedCell as text primitive [auto formula]', async function (assert) {
    const _value = cell('foo');
    const value = () => _value.value;
    await render(<template>{{value}}</template>);

    assert.dom().hasText('foo', 'cell value is rendered');
    _value.update('bar');
    await rerender();
    assert.dom().hasText('bar', 'cell value is updated');
  });
  test('could render MergedCell as attr primitive [auto formula]', async function (assert) {
    const _value = cell('foo');
    const value = () => _value.value;

    await render(
      <template>
        <div id={{value}}>123</div>
      </template>,
    );

    assert.dom('#foo').hasText('123', 'cell value is rendered');
    _value.update('bar');
    await rerender();
    assert.dom('#bar').hasText('123', 'cell value is updated');
    assert.dom('#foo').doesNotExist('old cell value is removed');
  });
  test('could render MergedCell as prop primitive [auto formula]', async function (assert) {
    const _value = cell(true);
    const value = () => _value.value;

    await render(<template><input checked={{value}} /></template>);

    assert.dom('input').isChecked('cell value is rendered');
    _value.update(false);
    await rerender();
    assert.dom('input').isNotChecked('cell value is updated');
  });
  test('it works for reactive className property [auto formula]', async function (assert) {
    const _value = cell('foo');
    const value = () => _value.value;

    await render(
      <template>
        <div class={{value}}>123</div>
      </template>,
    );

    assert.dom('div').hasClass('foo', 'cell value is rendered');
    _value.update('bar');
    await rerender();
    assert.dom('div').hasClass('bar', 'cell value is updated');
    assert.dom('div').doesNotHaveClass('foo', 'old cell value is removed');
  });
});
