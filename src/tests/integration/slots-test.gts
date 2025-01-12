import { module, test } from 'qunit';
import { render, rerender, find } from '@lifeart/gxt/test-utils';
import { cell, Component } from '@lifeart/gxt';

module('Integration | InternalComponent | slots', function () {
  test('slot params may be reactive with getter', async function (assert) {
    const state = cell('foo');
    class Slot extends Component {
      get name() {
        return state.value;
      }
      <template>{{yield this.name}}</template>
    }
    class Main extends Component {
      <template>
        <Slot as |name|>
          <div data-test-name>{{name}}</div>
        </Slot>
      </template>
    }
    await render(<template><Main /></template>);
    assert.dom('[data-test-name]').hasText('foo');
    state.update('bar');
    await rerender();
    assert.dom('[data-test-name]').hasText('bar');
  });
  test('slot params may be reactive', async function (assert) {
    const state = cell('foo');
    class Slot extends Component {
      get name() {
        return state;
      }
      <template>{{yield this.name}}</template>
    }
    class Main extends Component {
      <template>
        <Slot as |name|>
          <div data-test-name>{{name}}</div>
        </Slot>
      </template>
    }
    await render(<template><Main /></template>);
    assert.dom('[data-test-name]').hasText('foo');
    state.update('bar');
    await rerender();
    assert.dom('[data-test-name]').hasText('bar');
  });
  test('slot may provide positional params', async function (assert) {
    assert.expect(6);
    class Slot extends Component {
      name = 'foo';
      <template>{{yield 1 2 3 4 this.name}}</template>
    }
    class Main extends Component {
      assert = (value: unknown, source: unknown) => {
        assert.equal(value, source);
        return '';
      };
      <template>
        <Slot as |p1 p2 p3 p4 p5 p6|>
          {{this.assert p1 1}}
          {{this.assert p2 2}}
          {{this.assert p3 3}}
          {{this.assert p4 4}}
          {{this.assert p5 'foo'}}
          {{this.assert p6 undefined}}
        </Slot>
      </template>
    }
    await render(<template><Main /></template>);
  });
  test('should have access to consumer context', async function (assert) {
    assert.expect(3);
    class Slot extends Component {
      <template>{{yield this}}</template>
    }
    class Main extends Component {
      name = 'foo';
      assertContext = (ctx: Component) => {
        assert.ok(ctx instanceof Main);
      };
      assertSlotContext = (ctx: Component) => {
        assert.ok(ctx instanceof Slot);
      };
      <template>
        <Slot as |s|>
          <div data-test-name>{{this.name}}</div>
          {{this.assertSlotContext s}}
          {{this.assertContext this}}
        </Slot>
      </template>
    }
    await render(<template><Main /></template>);
    assert.dom('[data-test-name]').hasText('foo');
  });
  test('is support inversion of block control (from inside)', async function (assert) {
    // @todo - seems we need to change owner of slot to support it..
    const showBlock = cell(false);
    const Sample = <template>
      {{#if showBlock}}
        {{#if (has-block)}}
          {{yield}}
        {{else}}
          no block
        {{/if}}
      {{else}}
        closed
      {{/if}}
    </template>;
    await render(
      <template>
        <Sample>content</Sample>
      </template>,
    );

    assert.dom().hasText('closed', 'initially closed');
    showBlock.value = true;
    await rerender();
    assert.dom().doesNotHaveTextContaining('closed');
    assert.dom().hasText('content', 'rendered content');
    showBlock.value = false;
    await rerender();
    assert.dom().doesNotHaveTextContaining('content');
    assert.dom().hasText('closed', 'initially closed');
  });
  test('default yield is supported for tagless components', async function (assert) {
    const Sloted = <template>{{yield}}</template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test]').exists();
  });
  test('default yield is supported for tagged components', async function (assert) {
    const Sloted = <template>
      <h1>{{yield}}</h1>
    </template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('h1 > [data-test]').exists();
  });
  test('yield to="default" is supported for tagless components', async function (assert) {
    const Sloted = <template>{{yield to='default'}}</template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test]').exists();
  });
  test('yield to="default" is supported for tagged components', async function (assert) {
    const Sloted = <template>
      <h1>{{yield to='default'}}</h1>
    </template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('h1 > [data-test]').exists();
  });
  test('custom slot names is supported', async function (assert) {
    const Sloted = <template>
      <h1>{{yield to='header'}}</h1>
      <div>{{yield to='body'}}</div>
    </template>;
    await render(
      <template>
        <Sloted>
          <:header>
            <span data-test-slot='header'></span>
          </:header>
          <:body>
            <span data-test-slot='body'></span>
          </:body>
        </Sloted>
      </template>,
    );
    assert.dom('h1 > [data-test-slot="header"]').exists();
    assert.dom('div > [data-test-slot="body"]').exists();
  });
  test('if slot does not exists its not rendered', async function (assert) {
    const Sloted = <template>
      <div>{{yield to='body'}}</div>
    </template>;
    await render(
      <template>
        <Sloted>
          <:header>
            <span data-test-slot='header'></span>
          </:header>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test-slot="header"]').doesNotExist();
  });
  test('arguments from slots works', async function (assert) {
    const Sloted = <template>
      <div>{{yield 1 '2' to='body'}}</div>
    </template>;
    await render(
      <template>
        <Sloted>
          <:body as |t1 t2|>
            <span data-test-slot='body'>{{t1}}{{t2}}</span>
          </:body>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test-slot="body"]').hasText('12');
  });
  test('content inside slot remains reactive', async function (assert) {
    const Sloted = <template>
      <div>{{yield to='body'}}</div>
    </template>;
    const value = cell(1);
    await render(
      <template>
        <Sloted>
          <:body>
            <span data-test-slot='body'>{{value}}</span>
          </:body>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test-slot="body"]').hasText('1');
    value.update(2);
    await rerender();
    assert.dom('[data-test-slot="body"]').hasText('2');
  });
  test('conditional slots', async function (assert) {
    const isEnabled = cell(true);
    const Slotted = <template>
      {{#if isEnabled}}
        <div data-test-enabled>{{yield to='body'}}</div>
      {{else}}
        <div data-test-disabled>{{yield to='body'}}</div>
      {{/if}}
    </template>;
    await render(
      <template>
        <Slotted>
          <:body>
            <span data-test-slot='body'>{{isEnabled}}</span>
          </:body>
        </Slotted>
      </template>,
    );
    assert.dom('[data-test-enabled] > [data-test-slot="body"]').hasText('true');
    assert.dom('[data-test-disabled]').doesNotExist();
    isEnabled.update(false);
    await rerender();
    assert
      .dom('[data-test-disabled] > [data-test-slot="body"]')
      .hasText('false');
    assert.dom('[data-test-enabled]').doesNotExist();
  });
  test('different slots may appear on different conditions', async function (assert) {
    const isEnabled = cell(true);
    const Slotted = <template>
      {{#if isEnabled}}
        <div data-test-head>{{yield to='head'}}</div>
      {{else}}
        <div data-test-body>{{yield to='body'}}</div>
      {{/if}}
    </template>;
    await render(
      <template>
        <Slotted>
          <:head>
            <span data-test-slot='head'>{{isEnabled}}</span>
          </:head>
          <:body>
            <span data-test-slot='body'>{{isEnabled}}</span>
          </:body>
        </Slotted>
      </template>,
    );
    assert.dom('[data-test-head] > [data-test-slot="head"]').hasText('true');
    assert.dom('[data-test-body]').doesNotExist();
    isEnabled.update(false);
    await rerender();
    assert.dom('[data-test-body] > [data-test-slot="body"]').hasText('false');
    assert.dom('[data-test-head]').doesNotExist();
  });
  test(':default slot works as well', async function (assert) {
    const Slotted = <template>
      <div>{{yield}}</div>
    </template>;
    await render(
      <template>
        <Slotted>
          <:default>
            <span data-test-slot='body'></span>
          </:default>
        </Slotted>
      </template>,
    );
    assert.dom('[data-test-slot="body"]').exists();
  });
  test('we can not render into one slot multiple times', async function (assert) {
    const Slotted = <template>
      <div>{{yield to='body'}}</div>
    </template>;
    await render(
      <template>
        <Slotted>
          <:body>
            <span data-test-slot='body'>1</span>
          </:body>
          <:body>
            <span data-test-slot='body'>2</span>
          </:body>
        </Slotted>
      </template>,
    );
    assert.dom('[data-test-slot="body"]').exists({ count: 1 });
  });
  test('component with default slot, hidden by default does not show error if toggled slot is not used', async function (assert) {
    const showBlock = cell(false);
    const Sample = <template>
      {{#if showBlock}}
        <div data-test-visible data-test-has-block={{has-block}}>{{yield}}</div>
      {{else}}
        <div data-test-hidden>Hidden by default</div>
      {{/if}}
    </template>;
    await render(<template><Sample /></template>);

    assert.dom('[data-test-hidden]').exists('Component is hidden by default');
    assert.dom('[data-test-visible]').doesNotExist('No error shown by default');

    showBlock.value = true;
    await rerender();

    assert.dom('[data-test-hidden]').doesNotExist('Component is not hidden');
    assert
      .dom('[data-test-visible]')
      .exists('Slot branch is rendered without error');
    assert.true(
      find('[data-test-visible]').innerHTML.includes(
        '<!--slot-{{default}}-placeholder',
      ),
      `default slot placeholder exists as ${
        find('[data-test-visible]').innerHTML
      }`,
    );
    assert.dom('[data-test-has-block="false"]').exists();
  });
  test('has-block helper', async function (assert) {
    const showBlock = cell(false);
    const Sample = <template>
      <div data-test-has-block={{has-block}}>{{yield}}</div>
    </template>;
    await render(
      <template>
        {{#if showBlock}}
          <Sample>block</Sample>
        {{else}}
          <Sample />
        {{/if}}
      </template>,
    );
    assert.dom('[data-test-has-block="false"]').exists();
    showBlock.update(true);
    await rerender();
    assert.dom('[data-test-has-block="true"]').exists();
  });
  test('has-block helper with custom block name', async function (assert) {
    const showBlock = cell(false);
    const Sample = <template>
      <div data-test-has-block={{has-block 'main'}}>{{yield to='main'}}</div>
    </template>;
    await render(
      <template>
        {{#if showBlock}}
          <Sample><:main>block</:main></Sample>
        {{else}}
          <Sample />
        {{/if}}
      </template>,
    );
    assert.dom('[data-test-has-block="false"]').exists();
    showBlock.update(true);
    await rerender();
    assert.dom('[data-test-has-block="true"]').exists();
  });
  test('has-block helper with unknown block name', async function (assert) {
    const showBlock = cell(false);
    const Sample = <template>
      <div data-test-has-block={{has-block 'boo'}}>{{yield to='main'}}</div>
    </template>;
    await render(
      <template>
        {{#if showBlock}}
          <Sample><:main>block</:main></Sample>
        {{else}}
          <Sample />
        {{/if}}
      </template>,
    );
    assert.dom('[data-test-has-block="false"]').exists();
    showBlock.update(true);
    await rerender();
    assert.dom('[data-test-has-block="false"]').exists();
  });
  test('it not failing if we trying to render block-less component as block', async function (assert) {
    const Sample = <template>
      <div data-test-component ...attributes>my component</div>
    </template>;
    const showBlock = cell(false);
    await render(
      <template>
        {{#if showBlock}}
          <Sample data-test-item>block</Sample>
        {{else}}
          <Sample />
        {{/if}}
      </template>,
    );
    assert.dom('[data-test-component]').exists();
    showBlock.update(true);
    await rerender();
    assert.dom('[data-test-item]').exists();
  });
});
