import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | property binding | value', function () {
  test('value should be reactive', async function (assert) {
    const value = cell('foo');
    await render(<template><input value={{value.value}} /></template>);
    assert.dom('input').hasValue('foo');
    value.update('bar');
    await rerender();
    assert.dom('input').hasValue('bar');
  });
  test('if value differs, we should sync it', async function (assert) {
    const value = cell('foo');
    await render(
      <template><input data-test-input value={{value.value}} /></template>,
    );
    assert.dom('input').hasValue('foo');
    document.querySelector('[data-test-input]').value = 'barz';
    assert.dom('input').hasValue('barz');
    value.update('bar');
    await rerender();
    assert.dom('input').hasValue('bar');
  });
});
