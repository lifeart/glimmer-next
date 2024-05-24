import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | and', function () {
  test('return proper values for and case', async function (assert) {
    await render(<template>{{if (and 2 1) 1}}</template>);
    assert.dom().hasText('1');
    await render(<template>{{if (and 0 1) 1 0}}</template>);
    assert.dom().hasText('0');
  });
});
