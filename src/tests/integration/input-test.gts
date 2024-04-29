import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | DOM | input', function () {
  test('could handle props as string', async function (assert) {
    await render(<template><input value='12' /></template>);
    assert.dom('input').hasProperty('value', '12');
  });
  test('could handle props as numbers', async function (assert) {
    await render(<template><input value={{12}} /></template>);
    assert.dom('input').hasProperty('value', '12');
  });
  test('could handle props from variables', async function (assert) {
    const value = 12;
    await render(<template><input value={{value}} /></template>);
    assert.dom('input').hasProperty('value', '12');
  });
  test('could handle props from cells', async function (assert) {
    const value = cell(12);
    await render(<template><input value={{value}} /></template>);
    assert.dom('input').hasProperty('value', '12');
    value.update(13);
    await rerender();
    assert.dom('input').hasProperty('value', '13');
  });
  test('could handle props as part of reactive chain', async function (assert) {
    const value = cell(12);
    await render(<template><input value={{value.value}} /></template>);
    assert.dom('input').hasProperty('value', '12');
    value.update(13);
    await rerender();
    assert.dom('input').hasProperty('value', '13');
  });
  test('it could set boolean attributes', async function (assert) {
    const value = cell(true);
    await render(
      <template><input type='checkbox' checked={{value}} /></template>,
    );
    assert.dom('input').hasProperty('checked', true);
    value.update(false);
    await rerender();
    assert.dom('input').hasProperty('checked', false);
  });
});
