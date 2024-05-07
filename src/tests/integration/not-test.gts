import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | not', function () {
  test('return proper values for not case', async function (assert) {
    await render(<template>{{if (not false) 'true' 'false'}}</template>);

    assert.dom().hasText('true');
  });
});
