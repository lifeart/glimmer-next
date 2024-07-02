import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | or', function () {
  test('return proper values for or case', async function (assert) {
    await render(<template>{{if (or 0 1) 1}}</template>);
    assert.dom().hasText('1');
    await render(<template>{{if (or 0 false 2) 1}}</template>);
    assert.dom().hasText('1');
  });
  test('custom or helper could be used if located in scope', async function (assert) {
    const or = () => 42;
    await render(<template>{{or 0 1}}</template>);
    assert.dom().hasText('42');
    await render(<template>{{or 0 false 2}}</template>);
    assert.dom().hasText('42');
  });
});
