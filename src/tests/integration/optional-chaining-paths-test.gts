import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Internal | property chaining', function () {
  test('all template properties are optional chaining', async function (assert) {
    const myObject = {
      foo: {
        _bar: {
          baz: 'hello',
        },
      },
    };
    await render(
      <template>
        <div>1{{myObject.foo.bar.baz}}2</div>
      </template>,
    );
    assert.dom().containsText('12');
  });
  test('all template properties are optional chaining without textContent patch', async function (assert) {
    const myObject = {
      foo: {
        _bar: {
          baz: 'hello',
        },
      },
    };
    await render(
      <template>
        <div>1{{myObject.foo.bar.baz}}2{{myObject.foo.bar.baz}}3</div>
      </template>,
    );
    assert.dom().containsText('123');
  });
  test('all template properties are optional chaining in helper args', async function (assert) {
    assert.expect(2);
    const myObject = {
      foo: {
        _bar: {
          baz: 'hello',
        },
      },
    };
    function check(value: any) {
      assert.equal(value, void 0);
      return 2;
    }
    await render(
      <template>
        <div>1{{check myObject.foo.bar.baz}}</div>
      </template>,
    );
    assert.dom().containsText('12');
  });
  test('all template properties are optional chaining in helper args concat statement', async function (assert) {
    assert.expect(2);
    const myObject = {
      foo: {
        _bar: {
          baz: 'hello',
        },
      },
    };
    function check(value: any) {
      assert.equal(value, void 0);
      return 2;
    }
    function print(value: any) {
      return value;
    }
    await render(
      <template>
        <div>1{{print (check myObject.foo.bar.baz)}}</div>
      </template>,
    );
    assert.dom().containsText('12');
  });
  test('all template properties are optionl chaining in hash helper args', async function (assert) {
    assert.expect(2);
    const myObject = {
      foo: {
        _bar: {
          baz: 'hello',
        },
      },
    };
    function check(value: any) {
      assert.equal(value.v, void 0);
      return 2;
    }
    await render(
      <template>
        <div>1{{check (hash v=myObject.foo.bar.baz)}}</div>
      </template>,
    );
    assert.dom().containsText('12');
  });
});
