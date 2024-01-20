import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalComponent | unless', function () {
  test('renders false branch if arg is false and only false branch exists', async function (assert) {
    const value = false;
    await render(
      <template>
        {{#unless value}}
          <div data-test-false-branch></div>
        {{/unless}}
      </template>,
    );
    assert.dom('[data-test-false-branch]').exists('only false branch exists');
  });
  test('renders false branch if arg is false', async function (assert) {
    const value = false;
    await render(
      <template>
        {{#unless value}}
          <div data-test-false-branch></div>
        {{else}}
          <div data-test-true-branch></div>
        {{/unless}}
      </template>,
    );
    assert
      .dom('[data-test-false-branch]')
      .exists('false branch exists for initial false value');
    assert
      .dom('[data-test-true-branch]')
      .doesNotExist('true branch does not exist for initial true value');
  });
  test('it could be used as helper [false]', async function (assert) {
    const value = false;
    await render(<template>{{unless value '1' '2'}}</template>);
    assert.dom().hasText('1');
  });
  test('it could be used as helper [true]', async function (assert) {
    const value = true;
    await render(<template>{{unless value '1' '2'}}</template>);
    assert.dom().hasText('2');
  });
  test('it could be used as helper with single argument', async function (assert) {
    const value = false;
    await render(<template>{{unless value '1'}}</template>);
    assert.dom().hasText('1');
  });
});
