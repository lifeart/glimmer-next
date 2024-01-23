import { module, test } from 'qunit';
import { render, allSettled } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | Internal | yield iterable', function () {
  test('renders false branch if arg is false and only false branch exists', async function (assert) {
    const items = cell([{ id: 1 }, { id: 2 }, { id: 3 }]);
    const CustomEach = <template>
      <ul>
        {{#each items as |item|}}
          <li>{{yield item}}</li>
        {{/each}}
      </ul>
    </template>;
    await render(
      <template>
        <CustomEach as |item|>
          <div>Name: {{item.id}}</div>
        </CustomEach>
      </template>,
    );
    assert.dom('li').exists({ count: 3 });
    assert.dom().hasText('Name: 1 Name: 2 Name: 3');
    items.update([]);
    await allSettled();
    assert.dom('li').doesNotExist();
  });
});
