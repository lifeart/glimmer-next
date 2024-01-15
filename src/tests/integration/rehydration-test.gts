import { module, test } from 'qunit';
import { rehydrate, renderTarget, ssr } from '@lfieart/gxt/test-utils';
import { cell } from '@/utils/reactive';

function qs(str: string) {
  return renderTarget().querySelector(str);
}
module('Integration | Rehydration', function () {
  test('it support slot rehydration', async function (assert) {
    const SlotComponent = <template>
      <button>{{yield}}</button>
    </template>;
    const RootComponent = <template>
      <span><SlotComponent><h1>ama</h1></SlotComponent></span>
    </template>;
    await ssr(RootComponent);
    const ref1 = qs('span');
    const ref2 = qs('button');
    const ref3 = qs('h1');
    // stack: [span, button h1, "ama"]
    await rehydrate(RootComponent);
    assert.dom('span').exists();
    assert.dom('button').exists();
    assert.dom('h1').exists();
    assert.equal(qs('span'), ref1);
    assert.equal(qs('button'), ref2);
    assert.equal(qs('h1'), ref3);
    assert.dom('span').hasText('ama');
  });
  test('support text node with element', async function (assert) {
    await ssr(
      <template>
        <div id='42'>1<span>2</span></div>
      </template>,
    );
    const val = (v: string) => v;
    await rehydrate(
      <template>
        <div>{{val '1'}}<span>{{val '2'}}</span></div>
      </template>,
    );
    // has id
    assert.dom('div').hasAttribute('id', '42');
    assert.dom('div').hasText('12');
  });

  test('supports nested components rehydration', async function (assert) {
    const NestedComponent = <template>
      <a href='#'>linky</a>
    </template>;
    const RootComponent = <template>
      <div data-test-name='root'><NestedComponent /></div>
    </template>;

    await ssr(
      <template>
        <div data-test-name='root'><a href='#'>linky</a></div>
      </template>,
    );
    const ref1 = qs('div');
    const ref2 = qs('a');
    await rehydrate(RootComponent);
    assert.dom('[data-test-name="root"]').exists();
    assert.dom('a').exists();
    assert.dom('a').hasText('linky');
    assert.equal(qs('div'), ref1);
    assert.equal(qs('a'), ref2);
  });

  test('single div', async function (assert) {
    await ssr(
      <template>
        <div data-test='foo'>bar</div>
      </template>,
    );
    await rehydrate(
      <template>
        <div data-tests='foo'>foo</div>
      </template>,
    );
    assert.dom('[data-tests="foo"]').hasText('foo');
    assert.dom('[data-test="foo"]').hasText('foo');
  });
  test('multiple div', async function (assert) {
    await ssr(
      <template>
        <div data-test='foo1'>bar1</div><div data-test='foo2'>bar2</div><div
          data-test='foo3'
        >bar3</div>
      </template>,
    );
    await rehydrate(
      <template>
        <div data-tests='foo1'>foo1</div>
        <div data-tests='foo2'>foo2</div>
        <div data-tests='foo3'>foo3</div>
      </template>,
    );
    assert.dom('[data-tests="foo1"]').hasText('foo1');
    assert.dom('[data-test="foo1"]').hasText('foo1');

    assert.dom('[data-tests="foo2"]').hasText('foo2');
    assert.dom('[data-test="foo2"]').hasText('foo2');

    assert.dom('[data-tests="foo3"]').hasText('foo3');
    assert.dom('[data-test="foo3"]').hasText('foo3');
  });

  test('nested elements', async function (assert) {
    await ssr(
      <template>
        <div id='42'><span>1</span><p>2</p></div>
      </template>,
    );
    await rehydrate(
      <template>
        <div>
          <span>1</span>
          <p>2</p>
        </div>
      </template>,
    );
    assert.dom('div').exists();
    // has id
    assert.dom('div').hasAttribute('id', '42');
    assert.dom('span').exists();
    // has text
    assert.dom('span').hasText('1');
    assert.dom('p').exists();
    // has text
    assert.dom('p').hasText('2');
  });

  test('nested elements #2', async function (assert) {
    await ssr(
      <template>
        <div class='text-white p-3'>
          <h1>
            <q>Compilers are the New Frameworks</q>
            - Tom Dale ©
          </h1>
          <br />
          <h2>Imagine a world </h2>
        </div>
      </template>,
    );
    const h1 = qs('h1');
    const q = qs('q');
    await rehydrate(
      <template>
        <div class='text-white p-3'>
          <h1>
            <q>Compilers are the New Frameworks</q>
            - Tom Dale ©
          </h1>
          <br />
          <h2>Imagine a world </h2>
        </div>
      </template>,
    );
    assert.dom('br').exists();
    assert.dom('h2').exists();
    assert.equal(qs('h1'), h1);
    assert.equal(qs('q'), q);
  });
  test('multiple text nodes inside element', async function (assert) {
    const blank = ' ';
    const Sample1 = <template>
      <div>{{3}}{{blank}}{{2}}{{blank}}{{1}}</div>
    </template>;
    await ssr(Sample1);
    await rehydrate(Sample1);
    assert.dom('div').hasText('3 2 1');
  });
  test('it support if element with root tag', async function (assert) {
    const value = true;
    const Sample2 = <template>
      <div>{{#if value}}<span>23</span>{{/if}}</div>
    </template>;
    await ssr(Sample2);
    const ref1 = qs('div');
    const ref2 = qs('span');
    await rehydrate(Sample2);
    assert.dom('div').exists();
    assert.dom('span').hasText('23');
    assert.equal(qs('div'), ref1);
    assert.equal(qs('span'), ref2);
  });
  test('it able to rehydrate static lists', async function (assert) {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const Sample3 = <template>
      <ul>
        {{#each items as |item|}}
          <li>{{item.id}}</li>
        {{/each}}
      </ul>
    </template>;
    await ssr(Sample3);
    const ref1 = qs('ul');
    const ref2 = qs('li');
    await rehydrate(Sample3);
    assert.dom('ul').exists();
    assert.dom('li').exists({ count: 3 });
    assert.dom(ref2).hasText('1');
    assert.equal(qs('ul'), ref1);
    assert.equal(qs('li'), ref2);
  });
  test('it able to rehydrate dynamic lists', async function (assert) {
    const i1 = { id: 1 };
    const i2 = { id: 2 };
    const i3 = { id: 3 };
    const items = cell([i1, i2, i3]);
    const Sample4 = <template>
      <ul>
        {{#each items as |item|}}
          <li>{{item.id}}</li>
        {{/each}}
      </ul>
    </template>;
    await ssr(Sample4);
    const ref1 = qs('ul');
    const ref2 = qs('li');
    await rehydrate(Sample4);
    assert.dom('ul').exists();
    assert.dom('li').exists({ count: 3 });
    assert.dom(ref2).hasText('1');
    assert.equal(qs('ul'), ref1);
    assert.equal(qs('li'), ref2);
    items.update([i3, i2]);
    assert.dom('ul').exists();
    assert.dom('li').exists({ count: 3 });
    assert.dom(ref2).hasText('1');
    assert.equal(qs('ul'), ref1);
    assert.equal(qs('li'), ref2);
  });
});
