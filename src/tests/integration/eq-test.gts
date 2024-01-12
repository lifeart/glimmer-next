import { module, test } from 'qunit';
import { render } from '@lfieart/gxt/test-utils';

module('Integration | InternalHelper | eq', function () {
  test('return proper values for not-eq case', async function (assert) {
    await render(<template>{{if (eq 1 2) 'eq' 'not-eq'}}</template>);

    assert.dom().hasText('not-eq');
  });
  test('return proper values for eq case', async function (assert) {
    await render(<template>{{if (eq 1 1) 'eq' 'not-eq'}}</template>);

    assert.dom().hasText('eq');
  });
});
