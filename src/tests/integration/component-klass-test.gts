import { Component } from '@lifeart/gxt';
import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

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
