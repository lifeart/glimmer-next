import { module, test } from 'qunit';
import { find, render, rerender } from '@lifeart/gxt/test-utils';
import { Component, renderComponent, cell } from '@lifeart/gxt';
import { ROOT_CONTEXT, getContext } from '@/utils/context';

module('Integration | multiroot', function () {
  test('could render one component to different places', async function (assert) {
    const name = cell('Hello');
    class AppOne extends Component {
      <template>
        <button type='button' data-test-button>{{name}}</button>
      </template>
    }
    await render(
      <template>
        <div id='app-1'></div>
        <div id='app-2'></div>
        <iframe id='iframe-1'></iframe>
      </template>,
    );

    const r1 = find('#app-1');
    const r2 = find('#app-2');
    // @ts-expect-error possible null
    const r3 = (find('#iframe-1') as HTMLIFrameElement).contentWindow.document
      .body;

    assert.dom(r1).exists('app one node exists');
    assert.dom(r2).exists('app two node exists');
    assert.ok(r3, 'app three node exists');

    const appOneInstance = renderComponent(AppOne, {}, r1);
    const appTwoInstance = renderComponent(AppOne, {}, r2);

    const appThreeInstance = renderComponent(AppOne, {}, r3);

    function qButton(r: Element) {
      return r.querySelector('[data-test-button]') as HTMLButtonElement;
    }

    assert.dom(qButton(r1)).exists('button in app one exists');
    assert.dom(qButton(r1)).hasText(name.value, 'button in app one has text');

    assert.dom(qButton(r2)).exists('button in app two exists');
    assert.dom(qButton(r2)).hasText(name.value, 'button in app two has text');

    assert.dom(qButton(r3)).exists('button in app three exists');
    assert.dom(qButton(r3)).hasText(name.value, 'button in app three has text');

    assert.ok(appOneInstance, 'app one instance exists');
    assert.ok(appTwoInstance, 'app two instance exists');
    assert.ok(appThreeInstance, 'app three instance exists');

    name.update('Foo');

    await rerender();

    assert
      .dom(qButton(r1))
      .hasText(name.value, 'button in app one has updated text');
    assert
      .dom(qButton(r2))
      .hasText(name.value, 'button in app two has updated text');
    assert
      .dom(qButton(r3))
      .hasText(name.value, 'button in app three has updated text');

    const appOneRoot = getContext(appOneInstance.ctx!, ROOT_CONTEXT);
    const appTwoRoot = getContext(appTwoInstance.ctx!, ROOT_CONTEXT);
    const appThreeRoot = getContext(appThreeInstance.ctx!, ROOT_CONTEXT);

    assert.notEqual(appOneRoot, appTwoRoot, `a1 & a2 roots differ`);
    assert.notEqual(appTwoRoot, appThreeRoot, `a2 & a3 roots differ`);
    assert.notEqual(appThreeRoot, appOneRoot, `a3 & a1 roots differ`);
  });
});
