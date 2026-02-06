import { module, test } from 'qunit';
import { render, click, find } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | Modifier | on', function () {
  test('{{on}} adds event listener that fires on click', async function (assert) {
    let clicked = false;
    const handleClick = () => {
      clicked = true;
    };
    await render(
      <template>
        <button data-test-btn {{on 'click' handleClick}}>Click me</button>
      </template>,
    );
    assert.false(clicked, 'not clicked yet');

    await click('[data-test-btn]');
    assert.true(clicked, 'click handler fired');
  });

  test('{{on}} passes event object to handler', async function (assert) {
    assert.expect(2);
    const handleClick = (event: MouseEvent) => {
      assert.ok(event instanceof MouseEvent, 'received MouseEvent');
      assert.equal(event.type, 'click', 'event type is click');
    };
    await render(
      <template>
        <button data-test-btn {{on 'click' handleClick}}>Click me</button>
      </template>,
    );
    await click('[data-test-btn]');
  });

  test('{{on}} works with different event types', async function (assert) {
    let focused = false;
    const handleFocus = () => {
      focused = true;
    };
    await render(
      <template>
        <button data-test-focus {{on 'focus' handleFocus}}>focusable</button>
      </template>,
    );
    assert.false(focused, 'not focused yet');

    const el = find('[data-test-focus]');
    el.dispatchEvent(new FocusEvent('focus'));
    assert.true(focused, 'focus handler fired');
  });

  test('{{on}} handler can update reactive state', async function (assert) {
    const count = cell(0);
    const increment = () => {
      count.update(count.value + 1);
    };
    await render(
      <template>
        <button data-test-btn {{on 'click' increment}}>+</button>
        <span data-test-count>{{count}}</span>
      </template>,
    );
    assert.dom('[data-test-count]').hasText('0');

    await click('[data-test-btn]');
    assert.dom('[data-test-count]').hasText('1');

    await click('[data-test-btn]');
    assert.dom('[data-test-count]').hasText('2');
  });

  test('{{on}} with multiple handlers for same event on same element', async function (assert) {
    let handlerACount = 0;
    let handlerBCount = 0;
    const handleA = () => { handlerACount++; };
    const handleB = () => { handlerBCount++; };
    await render(
      <template>
        <button
          data-test-btn
          {{on 'click' handleA}}
          {{on 'click' handleB}}
        >Click</button>
      </template>,
    );

    await click('[data-test-btn]');
    assert.equal(handlerACount, 1, 'first click handler fired');
    assert.equal(handlerBCount, 1, 'second click handler also fired');
  });
});
