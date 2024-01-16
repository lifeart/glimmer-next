import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | InternalHelper | array', function () {
  test('return array from args', async function (assert) {
    const toString = (v: number[]) => v.toString();
    await render(<template>{{toString (array 1 2 3)}}</template>);

    assert.dom().hasText('1,2,3');
  });
  test('it could be used as source for list', async function (assert) {
    await render(
      <template>
        <ul>
          {{#each (array 1 2 3) as |item|}}
            <li>{{item}}</li>
          {{/each}}
        </ul>
      </template>,
    );
    assert.dom('li').exists({ count: 3 });
  });
});
