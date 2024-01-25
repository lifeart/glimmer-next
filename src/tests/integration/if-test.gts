import { module, test } from 'qunit';
import { render, allSettled } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | InternalComponent | if', function () {
  test('it not re-render items if updated value not flipping it', async function (assert) {
    let value = cell(true);
    let renderCount = 0;
    function text(txt: string) {
      renderCount++;
      return txt;
    }
    const H4 = <template>
      <h4>{{text @txt}}</h4>
    </template>;
    await render(
      <template>
        {{#if value}}
          <H4 @txt='hello' />
        {{else}}
          <H4 @txt='world' />
        {{/if}}
      </template>,
    );
    assert.dom('h4').hasText('hello');
    assert.equal(renderCount, 1, 'true block rendered once');
    value.update(1);
    await allSettled();
    assert.equal(renderCount, 1, 'true block not re-rendered');
    value.update('non-empty-string');
    await allSettled();
    assert.equal(renderCount, 1, 'true block not re-rendered');

    value.update(0);
    await allSettled();
    assert.dom('h4').hasText('world');
    assert.equal(renderCount, 2, 'false block rendered');

    value.update(null);
    await allSettled();
    assert.equal(renderCount, 2, 'false block not re-rendered');

    value.update(true);
    await allSettled();
    assert.dom('h4').hasText('hello');
    assert.equal(renderCount, 3, 'true block rendered');
  });
  test('it works with args [forward]', async function (assert) {
    const H4 = <template>
      <h4>
        <span style='margin: 0px 10px 0px 10px'>{{if
            @text
            @text
            'To do'
          }}</span>
      </h4>
    </template>;
    await render(<template><H4 @text='world' /></template>);
    assert.dom().hasText('world');
  });
  test('it works with args [fallback]', async function (assert) {
    const H4 = <template>
      <h4>
        <span style='margin: 0px 10px 0px 10px'>{{if
            @text
            @text
            'To do'
          }}</span>
      </h4>
    </template>;
    await render(<template><H4 /></template>);
    assert.dom().hasText('To do');
  });
  test('it supports nested ifs', async function (assert) {
    const value1 = cell(false);
    const value2 = cell(false);
    const value3 = cell(true);
    await render(
      <template>
        {{#if value1}}
          <div data-test-if='1'></div>
        {{else if value2}}
          <div data-test-if='2'></div>
        {{else if value3}}
          <div data-test-if='3'></div>
        {{/if}}
      </template>,
    );
    assert.dom('[data-test-if="1"]').doesNotExist();
    assert.dom('[data-test-if="2"]').doesNotExist();
    assert.dom('[data-test-if="3"]').exists('only true branch exists');
    value1.update(true);
    await allSettled();
    assert.dom('[data-test-if="1"]').exists('only true branch exists');
    assert.dom('[data-test-if="2"]').doesNotExist();
    assert.dom('[data-test-if="3"]').doesNotExist();
    value1.update(false);
    value2.update(true);
    await allSettled();
    assert.dom('[data-test-if="1"]').doesNotExist();
    assert.dom('[data-test-if="2"]').exists('only true branch exists');
    assert.dom('[data-test-if="3"]').doesNotExist();
  });
  test('renders true branch if arg is true and only true branch exists', async function (assert) {
    const value = true;
    await render(
      <template>
        {{#if value}}
          <div data-test-true-branch></div>
        {{/if}}
      </template>,
    );
    assert.dom('[data-test-true-branch]').exists('only true branch exists');
  });
  test('renders true branch if arg is true', async function (assert) {
    const value = true;
    await render(
      <template>
        {{#if value}}
          <div data-test-true-branch></div>
        {{else}}
          <div data-test-false-branch></div>
        {{/if}}
      </template>,
    );
    assert
      .dom('[data-test-true-branch]')
      .exists('true branch exists for initial true value');
    assert
      .dom('[data-test-false-branch]')
      .doesNotExist('false branch does not exist for initial true value');
  });
  test('it reactive', async function (assert) {
    const value = cell(true);
    await render(
      <template>
        {{#if value}}
          <div data-test-true-branch></div>
        {{else}}
          <div data-test-false-branch></div>
        {{/if}}
      </template>,
    );
    assert
      .dom('[data-test-true-branch]')
      .exists('true branch exists for initial true value');
    assert
      .dom('[data-test-false-branch]')
      .doesNotExist('false branch does not exist for initial true value');
    value.update(false);
    await allSettled();
    assert
      .dom('[data-test-true-branch]')
      .doesNotExist('true branch does not exist for updated to false value');
    assert
      .dom('[data-test-false-branch]')
      .exists('false branch exists for updated to false value');
    value.update(true);
    await allSettled();
    assert
      .dom('[data-test-true-branch]')
      .exists('true branch exists for updated to true value');
    assert
      .dom('[data-test-false-branch]')
      .doesNotExist('false branch does not exist for updated to true value');
  });
  if (IS_GLIMMER_COMPAT_MODE) {
    test('it has derived reactivity', async function (assert) {
      const value = cell(true);
      const derived = {
        get value() {
          return value.value;
        },
      };
      await render(
        <template>
          {{#if derived.value}}
            <div data-test-true-branch></div>
          {{else}}
            <div data-test-false-branch></div>
          {{/if}}
        </template>,
      );
      assert
        .dom('[data-test-true-branch]')
        .exists('true branch exists for initial true value');
      assert
        .dom('[data-test-false-branch]')
        .doesNotExist('false branch does not exist for initial true value');
      value.update(false);
      await allSettled();
      assert
        .dom('[data-test-true-branch]')
        .doesNotExist('true branch does not exist for updated to false value');
      assert
        .dom('[data-test-false-branch]')
        .exists('false branch exists for updated to false value');
      value.update(true);
      await allSettled();
      assert
        .dom('[data-test-true-branch]')
        .exists('true branch exists for updated to true value');
      assert
        .dom('[data-test-false-branch]')
        .doesNotExist('false branch does not exist for updated to true value');
    });
  } else {
    test('no derived reactivity in templates', async function (assert) {
      const value = cell(true);
      const derived = { value: value };
      await render(
        <template>
          {{#if derived.value}}
            <div data-test-true-branch></div>
          {{else}}
            <div data-test-false-branch></div>
          {{/if}}
        </template>,
      );
      assert
        .dom('[data-test-true-branch]')
        .exists('true branch exists for initial true value');
      assert
        .dom('[data-test-false-branch]')
        .doesNotExist('false branch does not exist for initial true value');
      value.update(false);
      await allSettled();
      assert
        .dom('[data-test-true-branch]')
        .doesNotExist('true branch does not exist for updated to false value');
      assert
        .dom('[data-test-false-branch]')
        .exists('false branch exists for updated to false value');
      value.update(true);
      await allSettled();
      assert
        .dom('[data-test-true-branch]')
        .exists('true branch exists for updated to true value');
      assert
        .dom('[data-test-false-branch]')
        .doesNotExist('false branch does not exist for updated to true value');
    });
  }
  test('it could be used as helper [false]', async function (assert) {
    const value = false;
    await render(<template>{{if value '1' '2'}}</template>);
    assert.dom().hasText('2');
  });
  test('it could be used as helper [true]', async function (assert) {
    const value = true;
    await render(<template>{{if value '1' '2'}}</template>);
    assert.dom().hasText('1');
  });
});
