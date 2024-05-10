import { module, test } from 'qunit';
import { render, rerender, click } from '@lifeart/gxt/test-utils';
import { cell, Component, tracked } from '@lifeart/gxt';

module('Integration | Interal | style', function () {
  test('works with static style binding', async function (assert) {
    await render(
      <template>
        <div style.color={{'green'}}>123</div>
      </template>,
    );
    assert.dom('div').hasStyle({
      color: 'rgb(0, 128, 0)',
    });
  });
  test('works with dynamic binding', async function (assert) {
    const color = cell('red');
    await render(
      <template>
        <div style.color={{color}}>123</div>
      </template>,
    );
    assert.dom('div').hasStyle({
      color: 'rgb(255, 0, 0)',
    });
    color.update('blue');
    await rerender();
    assert.dom('div').hasStyle({
      color: 'rgb(0, 0, 255)',
    });
  });
  test('works with dynamic binding in class', async function (assert) {
    class MyComponent extends Component {
      @tracked color = 'red';
      onClick = () => {
        this.color = 'blue';
      };
      <template>
        <div style.color={{this.color}}>123</div>
        <button type='button' {{on 'click' this.onClick}}>change color</button>
      </template>
    }
    await render(<template><MyComponent /></template>);
    assert.dom('div').hasStyle({
      color: 'rgb(255, 0, 0)',
    });
    await click('button');
    assert.dom('div').hasStyle({
      color: 'rgb(0, 0, 255)',
    });
  });
  test('works with functions', async function (assert) {
    const color = cell('red');
    const getColor = () => color.value;
    await render(
      <template>
        <div style.color={{getColor}}>123</div>
      </template>,
    );
    assert.dom('div').hasStyle({
      color: 'rgb(255, 0, 0)',
    });
    color.update('blue');
    await rerender();
    assert.dom('div').hasStyle({
      color: 'rgb(0, 0, 255)',
    });
  });
});
