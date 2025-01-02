import { module, test } from 'qunit';
import { hbs, scope } from '@/utils/template';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Template', function () {
  test('hbs function', async function (assert) {
    const template = hbs`<div>Hello, world!</div>`;
    await render(template);
    assert.dom('div').hasText('Hello, world!');
  });

  test('scope function', function (assert) {
    const context = { foo: 'bar' };
    scope(context);
    assert.strictEqual(context.foo, 'bar');
  });
});
