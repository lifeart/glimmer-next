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

  test('works with reactive object style attribute', async function (assert) {
    const fontSize = cell(12);
    const color = cell('red');
    const getStyle = () => `font-size: ${fontSize.value}px; color: ${color.value}`;
    await render(
      <template>
        <div style={{getStyle}}>styled text</div>
      </template>,
    );
    assert.dom('div').hasStyle({
      'font-size': '12px',
      color: 'rgb(255, 0, 0)',
    });
    fontSize.update(24);
    color.update('blue');
    await rerender();
    assert.dom('div').hasStyle({
      'font-size': '24px',
      color: 'rgb(0, 0, 255)',
    });
  });

  test('works with reactive data attribute objects', async function (assert) {
    const value = cell('initial');
    const getValue = () => value.value;
    await render(
      <template>
        <div data-test-value={{getValue}}>test</div>
      </template>,
    );
    assert.dom('[data-test-value="initial"]').exists();
    value.update('updated');
    await rerender();
    assert.dom('[data-test-value="updated"]').exists();
    assert.dom('[data-test-value="initial"]').doesNotExist();
  });
});
