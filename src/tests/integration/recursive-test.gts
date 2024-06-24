import { module, test } from 'qunit';
import { Component } from '@lifeart/gxt';
import { render } from '@lifeart/gxt/test-utils';

class Demo extends Component {
  get tree() {
    return [
      { name: 'one' },
      {
        name: 'two',
        children: [{ name: 'three' }, { name: 'four' }],
      },
    ];
  }

  <template><Tree @tree={{this.tree}} /></template>
}

class Tree extends Component {
  <template>
    <ul>
      {{#each @tree as |node|}}
        <li>
          {{node.name}}<br />

          {{#if node.children}}
            <Tree @tree={{node.children}} />
          {{/if}}
        </li>
      {{/each}}
    </ul>
  </template>
}

module('Integration | recursive rendering', function () {
  test('it works', async function (assert) {
    await render(<template><Demo /></template>);
    assert.dom('ul').exists({ count: 2 });
    assert.dom('li').exists({ count: 4 });
    assert.dom('ul > li > ul').exists({ count: 1 });
    assert.dom('ul > li > ul > li').exists({ count: 2 });
  });
});
