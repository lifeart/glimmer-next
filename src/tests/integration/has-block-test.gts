import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | has-block', function () {
  test('has block without arguments return false for selfClosed component', async function (assert) {
    const Sample = <template>
      {{#if (has-block)}}
        {{yield}}
      {{else}}
        no block
      {{/if}}
    </template>;
    await render(<template><Sample /></template>);

    assert.dom().hasText('no block');
  });
  test('has block without arguments return true for block component', async function (assert) {
    const Sample = <template>
      {{#if (has-block)}}
        {{yield}}
      {{else}}
        no block
      {{/if}}
    </template>;
    await render(
      <template>
        <Sample>world</Sample>
      </template>,
    );

    assert.dom().hasText('world');
  });
});
