import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | has-block-params', function () {
  test('return true if slot invoked with params', async function (assert) {
    const Sample = <template>
      {{#if (has-block-params)}}
        {{yield ''}}
      {{else}}
        no block
      {{/if}}
    </template>;
    await render(
      <template>
        <Sample>block</Sample>
      </template>,
    );

    assert.dom().hasText('no block');

    await render(
      <template>
        <Sample as |i|>block{{i}}</Sample>
      </template>,
    );

    assert.dom().hasText('block');
  });
});
