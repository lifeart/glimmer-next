import { module, test } from 'qunit';
import { render, find } from '@lifeart/gxt/test-utils';
import { SvgProvider, HtmlProvider } from '@/utils/provider';

module('Integration | Interal | svg', function () {
  test('it render svg tag with proper namespace', async function (assert) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    await render(
      <template>
        <SvgProvider>
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
            <foreignObject>
              <HtmlProvider><input /></HtmlProvider>
            </foreignObject>
          </svg>
        </SvgProvider>
      </template>,
    );
    assert.equal(find('#svg-root').namespaceURI, SVG_NS);
    assert.equal(find('#svg-text').namespaceURI, SVG_NS);
    assert.equal(find('#svg-path').namespaceURI, SVG_NS);
  });
});
