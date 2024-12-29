import { module, test } from 'qunit';
import { render, find } from '@lifeart/gxt/test-utils';
import { NS_HTML, NS_SVG } from '@/utils/namespaces';

module('Integration | Interal | svg', function () {
  test('it render svg tag with proper namespace', async function (assert) {
    const color = `rgb(255, 0, 0)`;
    await render(
      <template>
        <svg
          xmlns='http://www.w3.org/2000/svg'
          viewBox='0 0 100 100'
          id='svg-root'
        >
          <path
            d='M30,1h40l29,29v40l-29,29h-40l-29-29v-40z'
            stroke='#000'
            fill='none'
            id='svg-path'
          />
          <path d='M31,3h38l28,28v38l-28,28h-38l-28-28v-38z' fill='#a23' />
          <text
            id='svg-text'
            x='50'
            y='68'
            font-size='48'
            fill='#FFF'
            text-anchor='middle'
          >123</text>
          <style>input { color: {{color}} }</style>
          <foreignObject>
            <input id='html-input' />
          </foreignObject>
        </svg>
      </template>,
    );
    assert.equal(
      find('#svg-root').namespaceURI,
      NS_SVG,
      '<svg> tag has svg namespace',
    );
    assert.equal(
      find('#svg-text').namespaceURI,
      NS_SVG,
      '<text> tag has svg namespace',
    );
    assert.dom('#svg-text').hasText('123');
    assert
      .dom('#html-input')
      .hasStyle({ color: color }, 'style tag is working');

    assert.equal(
      find('#svg-path').namespaceURI,
      NS_SVG,
      '<path> tag has svg namespace',
    );
    assert.equal(
      find('#html-input').namespaceURI,
      NS_HTML,
      '<input> tag has svg namespace',
    );
  });
});
