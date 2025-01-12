import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Component | text-test', function () {
  test('it renders special HTML symbols correctly', async function (assert) {
    await render(
      <template>
        <div data-test-gt>&gt;</div>
        <div data-test-lt>&lt;</div>
        <div data-test-nbsp>&nbsp;</div>
      </template>,
    );

    assert.dom('[data-test-gt]').hasText('>');
    assert.dom('[data-test-lt]').hasText('<');
    assert.dom('[data-test-nbsp]').hasText('\u00A0');
  });
});
