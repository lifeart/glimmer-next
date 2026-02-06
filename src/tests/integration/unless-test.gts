import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

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
  test('does not render when condition is true', async function (assert) {
    const value = true;
    await render(
      <template>
        {{#unless value}}
          <div data-test-content>should not appear</div>
        {{/unless}}
      </template>,
    );
    assert.dom('[data-test-content]').doesNotExist('block not rendered when condition is true');
  });

  test('renders else block when condition is true', async function (assert) {
    const value = true;
    await render(
      <template>
        {{#unless value}}
          <div data-test-unless>unless content</div>
        {{else}}
          <div data-test-else>else content</div>
        {{/unless}}
      </template>,
    );
    assert.dom('[data-test-unless]').doesNotExist();
    assert.dom('[data-test-else]').exists('else block rendered when condition is true');
  });

  test('reactive toggle with cell', async function (assert) {
    const condition = cell(false);
    await render(
      <template>
        {{#unless condition}}
          <div data-test-unless>shown</div>
        {{else}}
          <div data-test-else>hidden</div>
        {{/unless}}
      </template>,
    );
    assert.dom('[data-test-unless]').exists('unless block rendered when false');
    assert.dom('[data-test-else]').doesNotExist();

    condition.update(true);
    await rerender();
    assert.dom('[data-test-unless]').doesNotExist('unless block hidden when true');
    assert.dom('[data-test-else]').exists('else block rendered when true');

    condition.update(false);
    await rerender();
    assert.dom('[data-test-unless]').exists('unless block re-rendered when false again');
    assert.dom('[data-test-else]').doesNotExist();
  });

  test('empty array is truthy in {{#unless}}', async function (assert) {
    const value: never[] = [];
    await render(
      <template>
        {{#unless value}}
          <div data-test-unless>unless content</div>
        {{else}}
          <div data-test-else>else content</div>
        {{/unless}}
      </template>,
    );
    assert.dom('[data-test-unless]').doesNotExist('empty array is truthy, unless block not shown');
    assert.dom('[data-test-else]').exists('else block shown because array is truthy');
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
