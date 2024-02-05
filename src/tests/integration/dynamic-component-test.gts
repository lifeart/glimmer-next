import { cell } from '@lifeart/gxt';
import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';

module('Integration | Component | DynamicComponent', function () {
  test('support dynamic component rerendering', async function (assert) {
    const A = <template>a</template>;
    const B = <template>b</template>;
    const state = cell(A);
    const context = {
      get V() {
        return state.value;
      },
    };
    await render(<template><context.V /></template>);
    assert.dom().hasText('a');

    state.update(B);
    await rerender();
    assert.dom().hasText('b');

    state.update(A);
    await rerender();
    assert.dom().hasText('a');

    state.update(A);
    assert.dom().hasText('a');

    state.update(B);
    await rerender();
    assert.dom().hasText('b');
  });
});
