import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { Component, tracked } from '@lifeart/gxt';

module('Integration | InternalHelper | hash', function () {
  test('properties may be reactive', async function (assert) {
    const NestedComponent = <template>
      <span>f{{@name.name}}</span>
    </template>;
    const SimpleComponent = <template>
      <div data-test={{@hash.name}}>{{@hash.name}}</div><NestedComponent
        @name={{hash name=@hash.name}}
      />
    </template>;
    let klass = null;
    const optional = (arg) => {
      return arg;
    };
    class MyComponent extends Component {
      constructor() {
        super(...arguments);
        klass = this;
      }
      @tracked name = '1';
      get fullName() {
        return this.name;
      }
      <template>
        <SimpleComponent @hash={{optional (hash name=this.fullName)}} />
      </template>
    }
    await render(<template><MyComponent /></template>);
    assert.dom('[data-test="1"]').exists({ count: 1 });
    assert.dom('[data-test="1"]').hasText('1');
    assert.dom('span').hasText('f1');
    klass!.name = 'name2';
    await rerender();
    assert.dom('[data-test="name2"]').exists({ count: 1 });
    assert.dom('[data-test="name2"]').hasText('name2');
    assert.dom('span').hasText('fname2');
  });
  test('nested hashes works just fine', async function (assert) {
    assert.expect(1);
    const name = 'xyz';
    const match = (v: any) => {
      assert.deepEqual(v, {
        a: 1,
        b: 2,
        name,
        m: [1, 2],
        n: {
          a: 1,
          b: 2,
          name,
          m: [1, 2],
        },
      });
    };
    await render(
      <template>
        {{match
          (hash
            n=(hash a=1 b=2 name=name m=(array 1 2))
            a=1
            b=2
            name=name
            m=(array 1 2)
          )
        }}
      </template>,
    );
  });
  test('we could pass user-land function to hash and it will be fine', async function (assert) {
    assert.expect(1);
    const myFn = () => 'xyz';
    const match = (v: any) => {
      assert.equal(v.myFn(), 'xyz');
    };
    await render(<template>{{match (hash myFn=myFn)}}</template>);
  });
  test('end-user shape of hash', async function (assert) {
    assert.expect(1);
    const name = 'xyz';
    const match = (v: any) => {
      assert.deepEqual(v, {
        a: 1,
        b: 2,
        name,
        m: [1, 2],
      });
    };
    await render(
      <template>{{match (hash a=1 b=2 name=name m=(array 1 2))}}</template>,
    );
  });
  test('return obj from args', async function (assert) {
    const toString = (v: any) => JSON.stringify(v);
    await render(<template>{{toString (hash a=1 b=2)}}</template>);

    assert.dom().hasText(JSON.stringify({ a: 1, b: 2 }));
  });
  test('it could be used as source for list', async function (assert) {
    await render(
      <template>
        <ul>
          {{#each (array (hash id=1) (hash id=2) (hash id=3)) as |item|}}
            <li data-id={{item.id}}>{{item.id}}</li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('li[data-id="1"]').exists({ count: 1 });
    assert.dom('li[data-id="2"]').exists({ count: 1 });
    assert.dom('li[data-id="2"]').exists({ count: 1 });
  });
});
