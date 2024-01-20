import { module, test, skip } from 'qunit';
import { render, allSettled } from '@lifeart/gxt/test-utils';
import { tracked, Component } from '@lifeart/gxt';

module('Integration | Internal | @tracked', function () {
  test('keep context for initializer', async function (assert) {
    class MyComponent extends Component {
      @tracked value = this.args.value;
      <template>{{this.value}}</template>
    }
    await render(<template><MyComponent @value={{42}} /></template>);

    assert.dom().hasText('42');
  });
});
