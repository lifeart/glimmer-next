import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalComponent | let', function () {
  test('support strings as args', async function (assert) {
    await render(
      <template>
        {{#let 'foo' as |foo|}}
          <div data-test={{foo}}>{{foo}}</div>
        {{/let}}
      </template>,
    );
    assert.dom('[data-test="foo"]').hasText('foo');
  });
  test('support numbers as args', async function (assert) {
    await render(
      <template>
        {{#let 123 as |foo|}}
          <div data-test={{foo}}>{{foo}}</div>
        {{/let}}
      </template>,
    );
    assert.dom('[data-test="123"]').hasText('123');
  });
});
