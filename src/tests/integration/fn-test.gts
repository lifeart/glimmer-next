import { module, test } from 'qunit';
import { render, click } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | fn', function () {
  test('bind proper arguments in specified order', async function (assert) {
    const onClick = (value: any, event: Event) => {
      assert.equal(value, 1);
      assert.true(event instanceof Event);
    };
    assert.expect(2);
    await render(
      <template>
        <button
          data-test-button
          type='button'
          {{on 'click' (fn onClick 1)}}
        >ClickMe</button>
      </template>,
    );

    click('[data-test-button]');
  });
});
