import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';
import { rerender } from '@lifeart/gxt/test-utils';

module('Integration | Internal | modifier', function () {
  if (REACTIVE_MODIFIERS) {
    test('modifiers may be reactive', async function (assert) {
      assert.expect(5);
      const value = cell(3);
      let removeCount = 0;
      const modifier = (element: HTMLDivElement, v: number) => {
        assert.equal(v, value.value, 'modifier rendered with correct value');
        return () => {
          removeCount++;
          assert.ok(removeCount, 'modifier destructor is running');
        };
      };
      await render(
        <template>
          <div {{modifier value.value}}></div>
        </template>,
      );
      value.update(value.value - 1);
      await rerender();
      value.update(value.value - 1);
      await rerender();
    });
  }

  test('modifiers executed during component creation, before it appears in DOM', async function (assert) {
    assert.expect(1);
    const modifier = (element: HTMLDivElement) => {
      assert.equal(
        false,
        element.isConnected,
        'element is not connected to DOM',
      );
    };
    await render(
      <template>
        <div {{modifier}}></div>
      </template>,
    );
  });
  test('modifier destructors executed before element is destroyed', async function (assert) {
    assert.expect(2);
    const conditionalCell = cell(true);
    const modifier = (element: HTMLDivElement) => {
      assert.equal(
        false,
        element.isConnected,
        'element is not connected once initialized',
      );
      return () => {
        assert.equal(
          true,
          element.isConnected,
          'element is connected to DOM once desctructor is called',
        );
      };
    };
    await render(
      <template>
        {{#if conditionalCell}}
          <div {{modifier}}></div>
        {{/if}}
      </template>,
    );
    conditionalCell.update(false);
    await rerender();
  });
  test('first argument of modifier is element', async function (assert) {
    assert.expect(1);
    const modifier = (element: HTMLSpanElement) => {
      assert.equal(
        'SPAN',
        element.tagName,
        'element is passed as first argument',
      );
    };
    await render(
      <template>
        <span {{modifier}}></span>
      </template>,
    );
  });
  test('second and other arguments are params', async function (assert) {
    assert.expect(1);
    const modifier = (_element: HTMLSpanElement, ...param: string[]) => {
      assert.equal(
        'param0 param1',
        param.join(' '),
        'param is passed as second argument',
      );
    };
    await render(
      <template>
        <span {{modifier 'param0' 'param1'}}></span>
      </template>,
    );
  });
});
