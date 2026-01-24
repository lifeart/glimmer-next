import { module, test } from 'qunit';
import { rerender, render, getDocument } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | InternalComponent | in-elment', function () {
  // Test for the double-wrapped function fix:
  // When template has {{#in-element node}} where node is a function,
  // the compiler wraps it reactively as () => node, so $_inElement
  // receives a function that returns another function. The fix ensures
  // we call the inner function to get the actual element.
  test('supports function element reference without if wrapper', async function (assert) {
    let _targetElement: HTMLDivElement | null = null;
    function setTarget(el: HTMLDivElement) {
      _targetElement = el;
    }
    function getTarget() {
      return _targetElement;
    }
    await render(
      <template>
        <div id='target-element' {{setTarget}}></div>
        {{#in-element getTarget}}
          <span data-test-content>rendered via function ref</span>
        {{/in-element}}
      </template>,
    );
    assert.dom('#target-element [data-test-content]').exists('content should be rendered into target element');
    assert.dom('#target-element').hasText('rendered via function ref', 'target should contain the in-element content');
  });

  test('supports function returning cell as element reference', async function (assert) {
    const targetCell = cell<HTMLDivElement | null>(null);
    function setTarget(el: HTMLDivElement) {
      targetCell.value = el;
    }
    function getTargetCell() {
      return targetCell;
    }
    await render(
      <template>
        <div id='cell-target' {{setTarget}}></div>
        {{#in-element getTargetCell}}
          <span data-test-cell-content>rendered via cell function</span>
        {{/in-element}}
      </template>,
    );
    assert.dom('#cell-target [data-test-cell-content]').exists('content should be rendered into cell target');
    assert.dom('#cell-target').hasText('rendered via cell function', 'cell target should contain the in-element content');
  });

  test('support strings as args and element as fn', async function (assert) {
    const elementRef = () => {
      return getDocument().getElementById('42');
    };
    const isMainRootRendered = cell(false);
    await render(
      <template>
        <div id='42'></div>
        {{#if isMainRootRendered}}
          {{#in-element elementRef}}
            <div data-test-in-element>t</div>
          {{/in-element}}
        {{/if}}
      </template>,
    );
    isMainRootRendered.value = true;
    await rerender();
    assert.dom('[id="42"]').hasText('t');
  });
  test('support strings as args and element as ref', async function (assert) {
    const elementRef = getDocument().createElement('div');
    await render(
      <template>
        <div id='42'></div>
        {{#in-element elementRef}}
          <div data-test-in-element>t</div>
        {{/in-element}}
      </template>,
    );
    assert.dom(elementRef).hasText('t');
  });
  test('support cells as element ref', async function (assert) {
    const elementRef = cell(getDocument().createElement('div'));
    await render(
      <template>
        <div id='42'></div>
        {{#in-element elementRef}}
          <div data-test-in-element>t</div>
        {{/in-element}}
      </template>,
    );
    assert.dom(elementRef.value).hasText('t');
  });
  test('cell values remain reactive in in-element', async function (assert) {
    const elementRef = () => {
      return getDocument().getElementById('42');
    };
    const sideNode = () => {
      return getDocument().getElementById('43');
    };
    const isMainRootRendered = cell(false);
    const value = cell('t');
    await render(
      <template>
        <div id='42'></div>
        {{#if isMainRootRendered}}
          {{#in-element elementRef}}
            <div data-test-in-element>{{value}}</div>
          {{/in-element}}
        {{/if}}
        <div id='43'>{{value}}</div>
      </template>,
    );

    isMainRootRendered.value = true;
    await rerender();
    assert
      .dom(elementRef())
      .hasText(value.value, 'values should be rendered inside in-element');
    assert
      .dom(sideNode())
      .hasText(value.value, 'values should be rendered outside in-element');

    value.value = 'u';

    await rerender();

    assert
      .dom(sideNode())
      .hasText(value.value, 'values should be reactive outside in-element');
    assert
      .dom(elementRef())
      .hasText(value.value, 'values should be reactive inside in-element');
  });
  test('it works inside conditions', async function (assert) {
    const elementRef = () => {
      return getDocument().getElementById('42')!;
    };
    const isExpended = cell(false);
    const value = cell('t');
    await render(
      <template>
        <div id='42'></div>
        {{#if isExpended}}
          {{#in-element elementRef}}
            <div data-test-in-element>{{value}}</div>
          {{/in-element}}
        {{/if}}
      </template>,
    );
    assert
      .dom('[data-test-in-element]')
      .doesNotExist('should not render, because if is hidden');
    assert.dom(elementRef()).exists();
    isExpended.value = true;
    await rerender();
    assert
      .dom('[data-test-in-element]')
      .exists('should render, because if is visible');
    isExpended.value = false;

    await rerender();
    await rerender();
    assert
      .dom('[data-test-in-element]')
      .doesNotExist('should not render, because if is hidden');
  });
});
