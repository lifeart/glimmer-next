import { module, test, skip } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';
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
  test('value should not be shared between instances', async function (assert) {
    class MyBucket {
      @tracked value = 42;
    }
    const a = new MyBucket();
    const b = new MyBucket();
    assert.equal(a.value, 42);
    assert.equal(b.value, 42);
    a.value = 43;
    assert.equal(a.value, 43);
    assert.equal(b.value, 42);
  });
  skip('value may be set in contructor of superclass', async function (assert) {
    class MyBucket {
      value = 42;
    }
    class MySubBucket extends MyBucket {
      @tracked value!: number;
    }
    const a = new MySubBucket();
    assert.equal(a.value, undefined);
  });
  skip('value may be overriden in contructor of superclass', async function (assert) {
    class MyBucket {
      value = 42;
    }
    class MySubBucket extends MyBucket {
      @tracked value = 45;
    }
    const a = new MySubBucket();
    assert.equal(a.value, 45);
  });
});
