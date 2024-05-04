import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | InternalComponent | let', function () {
  test('let arguments could be used to control slots', async function (assert) {
    const value = cell(false);
    const and = (...args: any[]) => {
      return args.reduce((a, b) => a && b, true);
    };
    const c = {
      get value() {
        return value.value;
      },
    };
    const Control = <template>
      {{#let (and @value (has-block)) as |show|}}
        {{#if show}}
          {{yield}}
        {{/if}}
      {{/let}}
    </template>;

    await render(
      <template>
        <Control @value={{c.value}}>
          <div data-test='block'>block</div>
        </Control>
      </template>,
    );
    assert.dom('[data-test="block"]').doesNotExist();
    value.update(true);
    await rerender();
    assert.dom('[data-test="block"]').exists();
  });
  test('reactive values works inside let', async function (assert) {
    const ifs = (v) => String(v);
    const Display = <template>
      <span>
        <div data-test-1>hello world!{{ifs @value}}</div>
        {{#let 'div' as |tagName|}}
          {{#let (element tagName @value) as |Tag|}}
            <Tag data-test-2>inside {{ifs @value}}</Tag>
          {{/let}}
        {{/let}}

        {{ifs @value}}
        <br />
        {{#let (hash value=@value name='static') as |v|}}
          <div data-test-3>v{{v.value}}</div>
        {{/let}}
        <div data-test-4>
          {{#let @value 'dddd' as |name1 dd|}}
            This is:
            {{name1}}
            /
            {{dd}}
            <br />
            {{#let (hash parent=name1 palue=123) as |name2|}}
              This is:
              {{name2.palue}}
              and parent
              {{name2.parent}}
              <br />
              {{#let '321' as |name3|}}
                This is:
                {{name3}}
              {{/let}}
            {{/let}}
          {{/let}}
        </div>
      </span>
    </template>;
    const time = cell(Date.now(), 'time');
    function updateTime() {
      time.update(Date.now() + 124);
    }
    await render(<template><Display @value={{time}} /></template>);
    assert.dom('[data-test-1]').hasText(`hello world!${time.value}`);
    assert.dom('[data-test-2]').hasText(`inside ${time.value}`);
    assert.dom('[data-test-3]').hasText(`v${time.value}`);
    assert
      .dom('[data-test-4]')
      .hasText(
        `This is: ${time.value} / dddd This is: 123 and parent ${time.value} This is: 321`,
      );

    updateTime();
    await rerender();

    assert.dom('[data-test-1]').hasText(`hello world!${time.value}`);
    assert.dom('[data-test-2]').hasText(`inside ${time.value}`);
    assert.dom('[data-test-3]').hasText(`v${time.value}`);
    assert
      .dom('[data-test-4]')
      .hasText(
        `This is: ${time.value} / dddd This is: 123 and parent ${time.value} This is: 321`,
      );
  });
  test('it properly handle same let name case for hash', async function (assert) {
    const MyComponent = <template>{{@args.name}}</template>;
    await render(
      <template>
        {{#let 'name' as |name|}}
          <MyComponent @args={{hash name=name}} />
        {{/let}}
      </template>,
    );
    assert.dom().hasText('name');
  });
  test('it properly handle same let name case for args', async function (assert) {
    const MyComponent = <template>{{@name}}</template>;
    await render(
      <template>
        {{#let 'name' as |name|}}
          <MyComponent @name={{name}} />
        {{/let}}
      </template>,
    );
    assert.dom().hasText('name');
  });
  test('it properly handle same let name case for attributes', async function (assert) {
    await render(
      <template>
        {{#let 'id' as |id|}}
          <div id={{id}}>{{id}}</div>
        {{/let}}
      </template>,
    );
    assert.dom('#id').hasText('id');
  });
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
