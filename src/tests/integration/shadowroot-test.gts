import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalComponent | shadowroot', function () {
  test('it works for element helper [closed]', async function (assert) {
    await render(
      <template>
        {{#let (element 'secret-content') as |MySecret|}}
          <MySecret shadowrootmode='closed'>
            <span data-test>foo</span>
          </MySecret>
        {{/let}}
      </template>,
    );
    assert.dom('span[data-test]').doesNotExist();
    const root = document.querySelector('secret-content')!;
    assert.dom('span[data-test]', root.shadowRoot).doesNotExist();
  });
  test('it works for element helper [open]', async function (assert) {
    await render(
      <template>
        {{#let (element 'secret-content') as |MySecret|}}
          <MySecret shadowrootmode='open'>
            <span data-test>foo</span>
          </MySecret>
        {{/let}}
      </template>,
    );
    assert.dom('span[data-test]').doesNotExist();
    const root = document.querySelector('secret-content')!;
    assert.dom('span[data-test]', root.shadowRoot).exists();
  });
  test('it works for [div] html element [closed]', async function (assert) {
    await render(
      <template>
        <div data-test-root-div shadowrootmode='closed'>
          <span data-test>foo</span>
        </div>
      </template>,
    );
    assert.dom('span[data-test]').doesNotExist();
    const root = document.querySelector('[data-test-root-div]')!;
    assert.dom('span[data-test]', root.shadowRoot).doesNotExist();
  });
  test('it works for [div] html element [open]', async function (assert) {
    await render(
      <template>
        <div data-test-root-div shadowrootmode='open'>
          <span data-test>foo</span>
        </div>
      </template>,
    );
    assert.dom('span[data-test]').doesNotExist();
    const root = document.querySelector('[data-test-root-div]')!;
    assert.dom('span[data-test]', root.shadowRoot).exists();
  });
});
