import { module, test } from 'qunit';
import { rehydrate, renderTarget, ssr, find, rerender } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';
import { NS_SVG, NS_MATHML, NS_HTML } from '@/core/namespaces';

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
    const h1Node = qs('h1');
    const qNode = qs('q');
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
    assert.equal(qs('h1'), h1Node);
    assert.equal(qs('q'), qNode);
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
  test('internal content is escaped', async function (assert) {
    const samples = [
      {
        id: 1,
        href: 'https://github.com/ember-template-imports/ember-template-imports/issues/33',
        text: '[ember-template-imports]: `<template>` Layering Proposal',
      },
      {
        id: 2,
        href: 'https://github.com/ember-template-imports/ember-template-imports/issues/35',
        text: '[ember-template-imports]: The Road to Stable',
      },
      {
        id: 3,
        href: 'https://github.com/ember-template-imports/ember-template-imports/issues/31',
        text: "[ember-template-imports]: < is not a valid character within attribute names: (error occurred in 'an unknown module' @ line 14 : column 8)",
      },
    ];
    const Sample = <template>
      {{#each samples as |sample|}}
        <a
          href={{sample.href}}
          data-test-id={{sample.id}}
          title={{sample.text}}
        >{{sample.text}}</a>
      {{/each}}
    </template>;
    await ssr(Sample);
    await rehydrate(Sample);
    assert.dom('a[data-test-id="1"]').hasTextContaining(samples[0].text);
    assert.dom('a[data-test-id="2"]').hasTextContaining(samples[1].text);
    assert.dom('a[data-test-id="3"]').hasTextContaining(samples[2].text);
  });

  // SVG Rehydration Tests
  test('it rehydrates simple SVG elements', async function (assert) {
    const Sample = <template>
      <svg id='svg-root' viewBox='0 0 24 24' class='icon'>
        <path id='svg-path' d='M12 2L2 7' stroke='currentColor' />
      </svg>
    </template>;
    await ssr(Sample);
    const svgRef = qs('svg');
    const pathRef = qs('path');
    await rehydrate(Sample);
    assert.dom('svg').exists();
    assert.dom('path').exists();
    assert.equal(qs('svg'), svgRef, 'SVG element is reused');
    assert.equal(qs('path'), pathRef, 'path element is reused');
    assert.equal(
      find('#svg-root').namespaceURI,
      NS_SVG,
      'SVG has correct namespace',
    );
    assert.equal(
      find('#svg-path').namespaceURI,
      NS_SVG,
      'path has correct namespace',
    );
    assert.dom('svg').hasAttribute('viewBox', '0 0 24 24');
    assert.dom('svg').hasClass('icon');
  });
  test('it rehydrates SVG with multiple nested elements', async function (assert) {
    const Sample = <template>
      <svg class='h-6 w-6' fill='none' viewBox='0 0 24 24'>
        <path id='p1' stroke-linecap='round' d='M3.75 6.75h16.5' />
        <circle id='c1' cx='12' cy='12' r='10' />
        <rect id='r1' x='0' y='0' width='10' height='10' />
      </svg>
    </template>;
    await ssr(Sample);
    const svgRef = qs('svg');
    const pathRef = qs('path');
    const circleRef = qs('circle');
    const rectRef = qs('rect');
    await rehydrate(Sample);
    assert.equal(qs('svg'), svgRef, 'SVG element is reused');
    assert.equal(qs('path'), pathRef, 'path element is reused');
    assert.equal(qs('circle'), circleRef, 'circle element is reused');
    assert.equal(qs('rect'), rectRef, 'rect element is reused');
    assert.equal(find('#p1').namespaceURI, NS_SVG);
    assert.equal(find('#c1').namespaceURI, NS_SVG);
    assert.equal(find('#r1').namespaceURI, NS_SVG);
  });
  test('it rehydrates SVG with dynamic attributes', async function (assert) {
    const strokeColor = cell('red');
    const Sample = <template>
      <svg viewBox='0 0 24 24'>
        <path id='dynamic-path' d='M0 0' stroke={{strokeColor}} />
      </svg>
    </template>;
    await ssr(Sample);
    const pathRef = qs('path');
    await rehydrate(Sample);
    assert.equal(qs('path'), pathRef, 'path element is reused');
    strokeColor.update('blue');   
    await rerender();                                                                      
    assert.dom('path').hasAttribute('stroke', 'blue');  
  });
  test('it rehydrates SVG with foreignObject containing HTML', async function (assert) {
    const Sample = <template>
      <svg id='svg-foreign' viewBox='0 0 200 200'>
        <rect width='200' height='200' fill='#eee' />
        <foreignObject x='20' y='20' width='160' height='160'>
          <div id='foreign-div' class='inner-html'>
            <input id='foreign-input' type='text' />
          </div>
        </foreignObject>
      </svg>
    </template>;
    await ssr(Sample);
    const svgRef = qs('svg');
    const divRef = qs('#foreign-div');
    const inputRef = qs('#foreign-input');
    await rehydrate(Sample);
    assert.equal(qs('svg'), svgRef, 'SVG element is reused');
    assert.equal(
      qs('#foreign-div'),
      divRef,
      'div inside foreignObject is reused',
    );
    assert.equal(
      qs('#foreign-input'),
      inputRef,
      'input inside foreignObject is reused',
    );
    assert.equal(
      find('#svg-foreign').namespaceURI,
      NS_SVG,
      'SVG has SVG namespace',
    );
    assert.equal(
      find('#foreign-div').namespaceURI,
      NS_HTML,
      'div has HTML namespace',
    );
    assert.equal(
      find('#foreign-input').namespaceURI,
      NS_HTML,
      'input has HTML namespace',
    );
  });

  // MathML Rehydration Tests
  test('it rehydrates simple MathML elements', async function (assert) {
    const Sample = <template>
      <p>The fraction
        <math id='math-root'>
          <mfrac id='math-frac'>
            <mn>1</mn>
            <mn>3</mn>
          </mfrac>
        </math>
        is not a decimal.
      </p>
    </template>;
    await ssr(Sample);
    const mathRef = qs('math');
    const mfracRef = qs('mfrac');
    await rehydrate(Sample);
    assert.dom('math').exists();
    assert.dom('mfrac').exists();
    assert.equal(qs('math'), mathRef, 'math element is reused');
    assert.equal(qs('mfrac'), mfracRef, 'mfrac element is reused');
    assert.equal(
      find('#math-root').namespaceURI,
      NS_MATHML,
      'math has MathML namespace',
    );
    assert.equal(
      find('#math-frac').namespaceURI,
      NS_MATHML,
      'mfrac has MathML namespace',
    );
  });
  test('it rehydrates MathML with complex expressions', async function (assert) {
    const Sample = <template>
      <math id='complex-math'>
        <mrow>
          <mi id='mi-x'>x</mi>
          <mo>=</mo>
          <mfrac>
            <mrow>
              <mo>-</mo>
              <mi>b</mi>
              <mo>+</mo>
              <msqrt>
                <msup>
                  <mi>b</mi>
                  <mn>2</mn>
                </msup>
              </msqrt>
            </mrow>
            <mrow>
              <mn>2</mn>
              <mi>a</mi>
            </mrow>
          </mfrac>
        </mrow>
      </math>
    </template>;
    await ssr(Sample);
    const mathRef = qs('math');
    const miRef = qs('mi');
    await rehydrate(Sample);
    assert.equal(qs('math'), mathRef, 'math element is reused');
    assert.equal(qs('mi'), miRef, 'mi element is reused');
    assert.equal(find('#complex-math').namespaceURI, NS_MATHML);
    assert.equal(find('#mi-x').namespaceURI, NS_MATHML);
  });

  // Nested HTML/SVG/MathML Rehydration Tests
  test('it rehydrates HTML with nested SVG components', async function (assert) {
    const IconComponent = <template>
      <svg class='icon' viewBox='0 0 24 24'>
        <path d='M12 2L2 7' />
      </svg>
    </template>;
    const Sample = <template>
      <div id='wrapper' class='flex'>
        <IconComponent />
        <span>Label</span>
      </div>
    </template>;
    // For SSR we need to inline the SVG
    const SsrSample = <template>
      <div id='wrapper' class='flex'>
        <svg class='icon' viewBox='0 0 24 24'>
          <path d='M12 2L2 7' />
        </svg>
        <span>Label</span>
      </div>
    </template>;
    await ssr(SsrSample);
    const divRef = qs('#wrapper');
    const svgRef = qs('svg');
    const pathRef = qs('path');
    const spanRef = qs('span');
    await rehydrate(Sample);
    assert.equal(qs('#wrapper'), divRef, 'wrapper div is reused');
    assert.equal(qs('svg'), svgRef, 'SVG is reused');
    assert.equal(qs('path'), pathRef, 'path is reused');
    assert.equal(qs('span'), spanRef, 'span is reused');
    assert.equal(find('#wrapper').namespaceURI, NS_HTML);
    assert.equal(find('svg').namespaceURI, NS_SVG);
  });
  test('it rehydrates multiple SVG icons in a row', async function (assert) {
    const Sample = <template>
      <div class='icons'>
        <svg id='icon1' class='h-6 w-6'><path d='M1 0' /></svg>
        <svg id='icon2' class='h-6 w-6'><path d='M2 0' /></svg>
        <svg id='icon3' class='h-6 w-6'><path d='M3 0' /></svg>
      </div>
    </template>;
    await ssr(Sample);
    const icon1Ref = qs('#icon1');
    const icon2Ref = qs('#icon2');
    const icon3Ref = qs('#icon3');
    await rehydrate(Sample);
    assert.equal(qs('#icon1'), icon1Ref, 'icon1 is reused');
    assert.equal(qs('#icon2'), icon2Ref, 'icon2 is reused');
    assert.equal(qs('#icon3'), icon3Ref, 'icon3 is reused');
    assert.equal(find('#icon1').namespaceURI, NS_SVG);
    assert.equal(find('#icon2').namespaceURI, NS_SVG);
    assert.equal(find('#icon3').namespaceURI, NS_SVG);
  });
  test('it rehydrates SVG inside conditional', async function (assert) {
    const showIcon = true;
    const Sample = <template>
      <div>
        {{#if showIcon}}
          <svg id='conditional-svg' viewBox='0 0 24 24'>
            <path d='M0 0' />
          </svg>
        {{/if}}
      </div>
    </template>;
    await ssr(Sample);
    const svgRef = qs('svg');
    await rehydrate(Sample);
    assert.dom('svg').exists();
    assert.equal(qs('svg'), svgRef, 'SVG inside conditional is reused');
    assert.equal(find('#conditional-svg').namespaceURI, NS_SVG);
  });
  test('it rehydrates SVG inside each loop', async function (assert) {
    const icons = [
      { id: 'loop-icon-1', path: 'M1 0' },
      { id: 'loop-icon-2', path: 'M2 0' },
      { id: 'loop-icon-3', path: 'M3 0' },
    ];
    const Sample = <template>
      <div class='icon-list'>
        {{#each icons as |icon|}}
          <svg id={{icon.id}} viewBox='0 0 24 24'>
            <path d={{icon.path}} />
          </svg>
        {{/each}}
      </div>
    </template>;
    await ssr(Sample);
    const icon1Ref = qs('#loop-icon-1');
    const icon2Ref = qs('#loop-icon-2');
    const icon3Ref = qs('#loop-icon-3');
    await rehydrate(Sample);
    assert.dom('svg').exists({ count: 3 });
    assert.equal(qs('#loop-icon-1'), icon1Ref, 'first loop SVG is reused');
    assert.equal(qs('#loop-icon-2'), icon2Ref, 'second loop SVG is reused');
    assert.equal(qs('#loop-icon-3'), icon3Ref, 'third loop SVG is reused');
    assert.equal(find('#loop-icon-1').namespaceURI, NS_SVG);
    assert.equal(find('#loop-icon-2').namespaceURI, NS_SVG);
    assert.equal(find('#loop-icon-3').namespaceURI, NS_SVG);
  });
  test('it rehydrates HTML with both SVG and MathML', async function (assert) {
    const Sample = <template>
      <article>
        <h1>Mixed Content</h1>
        <svg id='mixed-svg' viewBox='0 0 100 100'>
          <circle cx='50' cy='50' r='40' />
        </svg>
        <p>The formula is:
          <math id='mixed-math'>
            <mrow>
              <mi>E</mi>
              <mo>=</mo>
              <mi>m</mi>
              <msup>
                <mi>c</mi>
                <mn>2</mn>
              </msup>
            </mrow>
          </math>
        </p>
      </article>
    </template>;
    await ssr(Sample);
    const svgRef = qs('svg');
    const mathRef = qs('math');
    const articleRef = qs('article');
    await rehydrate(Sample);
    assert.equal(qs('article'), articleRef, 'article is reused');
    assert.equal(qs('svg'), svgRef, 'SVG is reused');
    assert.equal(qs('math'), mathRef, 'math is reused');
    assert.equal(find('article').namespaceURI, NS_HTML);
    assert.equal(find('#mixed-svg').namespaceURI, NS_SVG);
    assert.equal(find('#mixed-math').namespaceURI, NS_MATHML);
  });
});
