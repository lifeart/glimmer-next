import { Component, cell, tracked } from '@lifeart/gxt';
import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';

module('Integration | Component | Component', function () {
  test('resolve forward attributes for class-less component', async function (assert) {
    const RemoveIcon = <template>
      <span
        ...attributes
        class='glyphicon glyphicon-remove'
        aria-hidden='true'
      ></span>
    </template>;

    await render(<template><RemoveIcon class='foo-bar' /></template>);
    assert.dom('span').hasClass('foo-bar');
  });
  test('not fail if forward attributes for class-less component is not provided', async function (assert) {
    const RemoveIcon = <template>
      <span
        ...attributes
        class='glyphicon glyphicon-remove'
        aria-hidden='true'
      ></span>
    </template>;

    await render(<template><RemoveIcon /></template>);
    assert.dom('span').hasClass('glyphicon-remove');
  });
  test('support @args', async function (assert) {
    assert.expect(4);
    class MyComponent extends Component {
      constructor() {
        // @ts-ignore
        super(...arguments);
        this.args.onCreated(this);
      }
      <template>{{@name}}{{@age}}</template>
    }
    const onCreated = (instance: MyComponent) => {
      assert.equal(instance.args.age, 42);
      assert.equal(instance.args.name, 'foo');
      assert.equal(instance.args.enabled, true);
    };
    await render(
      <template>
        <MyComponent
          @name='foo'
          @age={{42}}
          @enabled={{true}}
          @onCreated={{onCreated}}
        />
      </template>,
    );
    assert.dom().hasText('foo42');
  });
  test('...attributes merges classes from caller and component', async function (assert) {
    class Badge extends Component {
      <template>
        <span ...attributes class='badge'>content</span>
      </template>
    }
    await render(<template><Badge class='highlight' /></template>);
    assert.dom('span').hasClass('badge', 'component static class exists');
    assert.dom('span').hasClass('highlight', 'caller class merged');
  });

  test('nested component rendering with args passing through', async function (assert) {
    class Inner extends Component<{ Args: { label: string } }> {
      <template>
        <span data-test-inner>{{@label}}</span>
      </template>
    }
    class Outer extends Component<{ Args: { text: string } }> {
      <template>
        <div data-test-outer>
          <Inner @label={{@text}} />
        </div>
      </template>
    }
    await render(<template><Outer @text='passed-through' /></template>);
    assert.dom('[data-test-outer]').exists();
    assert.dom('[data-test-inner]').hasText('passed-through');
  });

  test('component re-renders when @arg changes', async function (assert) {
    class Display extends Component<{ Args: { value: string } }> {
      <template>
        <div data-test-display>{{@value}}</div>
      </template>
    }
    const value = cell('initial');
    await render(<template><Display @value={{value}} /></template>);
    assert.dom('[data-test-display]').hasText('initial');

    value.update('updated');
    await rerender();
    assert.dom('[data-test-display]').hasText('updated');
  });

  test('component with tracked property updates DOM on mutation', async function (assert) {
    let instance: Counter | null = null;
    class Counter extends Component {
      @tracked count = 0;
      constructor() {
        // @ts-ignore
        super(...arguments);
        instance = this;
      }
      <template>
        <div data-test-count>{{this.count}}</div>
      </template>
    }
    await render(<template><Counter /></template>);
    assert.dom('[data-test-count]').hasText('0');

    instance!.count = 5;
    await rerender();
    assert.dom('[data-test-count]').hasText('5');
  });

  test('template-only support args', async function (assert) {
    assert.expect(4);
    const MyComponent = <template>{{@onCreated @age @name @enabled}}</template>;
    const onCreated = (age: number, name: string, enabled: boolean) => {
      assert.equal(age, 42);
      assert.equal(name, 'foo');
      assert.equal(enabled, true);
      return `${name}${age}`;
    };
    await render(
      <template>
        <MyComponent
          @name='foo'
          @age={{42}}
          @enabled={{true}}
          @onCreated={{onCreated}}
        />
      </template>,
    );
    assert.dom().hasText('foo42');
  });
});
