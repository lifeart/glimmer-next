import { module, test } from 'qunit';
import { allSettled, render } from '@lfieart/gxt/test-utils';
import { getDocument } from '@/utils/dom-api';
import { cell } from '@/utils/reactive';

module('Integration | InternalComponent | in-elment', function () {
  test('support strings as args and element as fn', async function (assert) {
    const elementRef = () => {
      return getDocument().getElementById('42');
    };
    await render(
      <template>
        <div id='42'></div>
        {{#in-element elementRef}}
          <div data-test-in-element>t</div>
        {{/in-element}}
      </template>,
    );
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
    const value = cell('t');
    await render(
      <template>
        <div id='42'></div>
        {{#in-element elementRef}}
          <div data-test-in-element>{{value}}</div>
        {{/in-element}}
        <div id='43'>{{value}}</div>
      </template>,
    );
    assert
      .dom(elementRef())
      .hasText(value.value, 'values should be rendered inside in-element');
    assert
      .dom(sideNode())
      .hasText(value.value, 'values should be rendered outside in-element');

    value.value = 'u';

    await allSettled();

    assert
      .dom(sideNode())
      .hasText(value.value, 'values should be reactive outside in-element');
    assert
      .dom(elementRef())
      .hasText(value.value, 'values should be reactive inside in-element');
  });
});
