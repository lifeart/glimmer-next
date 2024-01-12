import { Button } from '@/components/Button.gts';
import { module, test } from 'qunit';
import { render, click } from '@lfieart/gxt/test-utils';

module('Integration | Component | Button', function () {
  // setupRenderingTest(hooks);

  test('renders default slot', async function (assert) {
    const name = 'world';
    await render(
      <template>
        <Button data-test-button>{{name}}</Button>
      </template>,
    );
    assert.dom('[data-test-button]').hasText(name);
  });

  test('assept onClick function', async function (assert) {
    const onClick = () => {
      assert.ok(true);
    };
    await render(
      <template>
        <Button @onClick={{onClick}} data-test-button>DEMO</Button>
      </template>,
    );
    click('[data-test-button]');
  });

  test('has default type', async function (assert) {
    await render(<template><Button data-test-button /></template>);
    assert.dom('[data-test-button]').hasAttribute('type', 'button');
  });

  test('allow type overriding', async function (assert) {
    await render(
      <template><Button type='submit' data-test-button /></template>,
    );
    assert.dom('[data-test-button]').hasAttribute('type', 'submit');
  });
});
