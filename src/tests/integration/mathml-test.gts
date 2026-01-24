import { module, test } from 'qunit';
import { render, find } from '@lifeart/gxt/test-utils';
import { NS_MATHML } from '@/core/namespaces';

module('Integration | Interal | mathml', function () {
  test('it render math tags with proper namespace', async function (assert) {
    await render(
      <template>
        <p>
          The fraction
          <math>
            <mfrac>
              <mn>1</mn>
              <mn>3</mn>
            </mfrac>
          </math>
          is not a decimal number.
        </p>
      </template>,
    );
    assert.equal(
      find('math').namespaceURI,
      NS_MATHML,
      '<math> tag has mathml namespace',
    );
    assert.equal(
      find('mfrac').namespaceURI,
      NS_MATHML,
      '<mfrac> tag has mathml namespace',
    );
  });
});
