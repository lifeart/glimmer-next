import { module, test } from 'qunit';
import { render } from '@/tests/utils';

module('Integration | InternalComponent | element', function () {
  test('it works', async function (assert) {
    await render(
      <template>
        {{#let (element 'span') as |Span|}}
          <Span data-test>foo</Span>
        {{/let}}
      </template>,
    );
    assert.dom('span[data-test]').hasText('foo');
  });
});
