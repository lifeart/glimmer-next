import { module, test } from 'qunit';
import { click, render } from '@lifeart/gxt/test-utils';
import { Component, tracked } from '@lifeart/gxt';

module('Integration | Element attributes | Readonly', function () {
  test('it updates readonly attribute', async function (assert) {
    class MyComponent extends Component<{
      Args: {
        readonly: boolean;
      };
      Element: HTMLInputElement;
    }> {
      <template><input type='text' ...attributes /></template>
    }

    await render(<template><MyComponent readonly={{true}} /></template>);

    assert.dom('input').hasAttribute('readonly');

    await render(<template><MyComponent readonly={{false}} /></template>);

    assert.dom('input').doesNotHaveAttribute('readonly');
  });

  test('it works with reactive properties', async function (assert) {
    class MyComponent extends Component<{
      Args: {
        isReadonly: boolean;
      };
      Element: HTMLInputElement;
    }> {
      <template><input type='text' ...attributes /></template>
    }

    class Wrapper extends Component {
      @tracked isReadonly = false;

      <template>
        <MyComponent readonly={{this.isReadonly}} />
        <button type='button' {{on 'click' this.toggleReadonly}}>Toggle</button>
      </template>

      toggleReadonly() {
        this.isReadonly = !this.isReadonly;
      }
    }

    await render(<template><Wrapper /></template>);

    assert.dom('input').doesNotHaveAttribute('readonly');

    await click('button');

    assert.dom('input').hasAttribute('readonly');
  });
});
