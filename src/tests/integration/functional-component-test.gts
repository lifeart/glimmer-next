import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | component | functional', function () {
  test('should render text', async function (assert) {
    function HelloWolrd() {
      return <template>123</template>;
    }
    await render(<template><HelloWolrd /></template>);
    assert.dom().hasText('123');
  });
  test('should render node', async function (assert) {
    function HelloWolrd() {
      return <template>
        <div>123</div>
      </template>;
    }
    await render(<template><HelloWolrd /></template>);
    assert.dom('div').hasText('123');
  });
  test('support static args', async function (assert) {
    function HelloWolrd() {
      return <template>
        <div>{{@name}}</div>
      </template>;
    }
    await render(<template><HelloWolrd @name={{'123'}} /></template>);
    assert.dom('div').hasText('123');
  });
  test('support static args from functional params', async function (assert) {
    const HelloWolrd = ({ name }) => {
      return <template>
        <div>{{name}}</div>
      </template>;
    };
    await render(<template><HelloWolrd @name={{'123'}} /></template>);
    assert.dom('div').hasText('123');
  });
  test('support dynamic args from functional params', async function (assert) {
    const value = cell('123');
    const HelloWolrd = ({ name }) => {
      return <template>
        <div>{{name}}</div>
      </template>;
    };
    await render(<template><HelloWolrd @name={{value}} /></template>);
    assert.dom('div').hasText('123');
    value.update('321');
    await rerender();
    assert.dom('div').hasText('321');
  });
  test('support dynamic args from functional params reference', async function (assert) {
    const value = cell('123');
    const HelloWolrd = (args) => {
      return <template>
        <div>{{args.name}}</div>
      </template>;
    };
    await render(<template><HelloWolrd @name={{value.value}} /></template>);
    assert.dom('div').hasText('123');
    value.update('321');
    await rerender();
    assert.dom('div').hasText('321');
  });
});
