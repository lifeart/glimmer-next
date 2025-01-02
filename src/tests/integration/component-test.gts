import { module, test } from 'qunit';
import { renderComponent, destroyElementSync, runDestructors } from '@/utils/component';
import { createRoot, setRoot, resetRoot } from '@/utils/dom';
import { getDocument } from '@/utils/dom-api';
import { Component } from '@lifeart/gxt';

module('Integration | Component | renderComponent', function () {
  test('it renders a component', async function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }

    const root = createRoot();
    setRoot(root);

    const targetElement = getDocument().getElementById('ember-testing')!;
    const component = renderComponent(MyComponent, targetElement);

    assert.dom('div').hasText('Hello, world!');

    destroyElementSync(component);
    resetRoot();
  });
});

module('Integration | Component | destroyElementSync', function () {
  test('it destroys a component', async function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }

    const root = createRoot();
    setRoot(root);

    const targetElement = getDocument().getElementById('ember-testing')!;
    const component = renderComponent(MyComponent, targetElement);

    assert.dom('div').hasText('Hello, world!');

    destroyElementSync(component);

    assert.dom('div').doesNotExist();

    resetRoot();
  });
});

module('Integration | Component | runDestructors', function () {
  test('it runs destructors for a component', async function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }

    const root = createRoot();
    setRoot(root);

    const targetElement = getDocument().getElementById('ember-testing')!;
    const component = renderComponent(MyComponent, targetElement);

    assert.dom('div').hasText('Hello, world!');

    await runDestructors(root);

    assert.dom('div').doesNotExist();

    resetRoot();
  });
});
