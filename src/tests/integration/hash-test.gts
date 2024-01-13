import { module, test } from 'qunit';
import { render } from '@lfieart/gxt/test-utils';

module('Integration | InternalHelper | hash', function () {
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
