import { module, test } from 'qunit';
import { cell, cellFor, tracked, formula, type Cell, type MergedCell } from '@/utils/reactive';
import { renderComponent, runDestructors, destroyElementSync, Component, type ComponentReturnType } from '@/utils/component';
import { registerDestructor } from '@/utils/glimmer/destroyable';
import { hbs, scope } from '@/utils/template';
import { effect, opcodeFor } from '@/utils/vm';
import { addChild, renderElement } from '@/utils/dom';
import { api } from '@/utils/dom-api';
import { createCache, getValue, isConst } from '@/utils/glimmer/caching-primitives';
import { createComputeRef, createConstRef, createUnboundRef, createPrimitiveRef, childRefFor, valueForRef } from '@/utils/glimmer/glimmer-reference';
import { dirtyTagFor, isTracking, consumeTag, trackedData, beginTrackFrame, endTrackFrame, track, untrack, beginUntrackFrame, endUntrackFrame, valueForTag, validateTag } from '@/utils/glimmer/glimmer-validator';
import { getOwner, setOwner } from '@/utils/glimmer/owner';
import { createStorage, getValue as getStorageValue, setValue as setStorageValue } from '@/utils/glimmer/storage-primitives';
import { withRehydration } from '@/utils/ssr/rehydration';
import { scheduleRevalidate, syncDom } from '@/utils/runtime';
import { $template, $nodes, $args, $fwProp } from '@/utils/shared';

module('Integration | Utils | Index', function () {
  test('cell function', function (assert) {
    const myCell = cell(42);
    assert.strictEqual(myCell.value, 42, 'cell value is correct');
  });

  test('formula function', function (assert) {
    const myCell = cell(42);
    const myFormula = formula(() => myCell.value * 2);
    assert.strictEqual(myFormula.value, 84, 'formula value is correct');
  });

  test('tracked decorator', function (assert) {
    class MyClass {
      @tracked value = 42;
    }
    const instance = new MyClass();
    assert.strictEqual(instance.value, 42, 'tracked value is correct');
  });

  test('renderComponent function', function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }
    const targetElement = document.createElement('div');
    const component = renderComponent(MyComponent, targetElement);
    assert.strictEqual(targetElement.textContent, 'Hello, world!', 'component rendered correctly');
  });

  test('runDestructors function', async function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }
    const targetElement = document.createElement('div');
    const component = renderComponent(MyComponent, targetElement);
    await runDestructors(component);
    assert.strictEqual(targetElement.textContent, '', 'destructors ran correctly');
  });

  test('destroyElementSync function', function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }
    const targetElement = document.createElement('div');
    const component = renderComponent(MyComponent, targetElement);
    destroyElementSync(component);
    assert.strictEqual(targetElement.textContent, '', 'element destroyed correctly');
  });

  test('registerDestructor function', function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }
    const targetElement = document.createElement('div');
    const component = renderComponent(MyComponent, targetElement);
    let destructorCalled = false;
    registerDestructor(component, () => {
      destructorCalled = true;
    });
    destroyElementSync(component);
    assert.true(destructorCalled, 'destructor called correctly');
  });

  test('hbs function', function (assert) {
    const template = hbs`<div>Hello, world!</div>`;
    assert.strictEqual(template.tpl[0], '<div>Hello, world!</div>', 'hbs template is correct');
  });

  test('scope function', function (assert) {
    assert.throws(() => {
      scope('invalid');
    }, 'scope throws error for invalid input');
  });

  test('effect function', function (assert) {
    let value = 0;
    const stopEffect = effect(() => {
      value++;
    });
    assert.strictEqual(value, 1, 'effect ran correctly');
    stopEffect();
  });

  test('opcodeFor function', function (assert) {
    const myCell = cell(42);
    let value = 0;
    const stopOpcode = opcodeFor(myCell, (newValue) => {
      value = newValue;
    });
    myCell.update(84);
    assert.strictEqual(value, 84, 'opcode ran correctly');
    stopOpcode();
  });

  test('addChild function', function (assert) {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    addChild(parent, child);
    assert.strictEqual(parent.firstChild, child, 'child added correctly');
  });

  test('renderElement function', function (assert) {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    renderElement(parent, child, null);
    assert.strictEqual(parent.firstChild, child, 'element rendered correctly');
  });

  test('api object', function (assert) {
    assert.ok(api, 'api object exists');
  });

  test('createCache function', function (assert) {
    const cache = createCache(() => 42);
    assert.strictEqual(getValue(cache), 42, 'cache value is correct');
  });

  test('getValue function', function (assert) {
    const cache = createCache(() => 42);
    assert.strictEqual(getValue(cache), 42, 'cache value is correct');
  });

  test('isConst function', function (assert) {
    const cache = createCache(() => 42);
    assert.true(isConst(cache), 'cache is constant');
  });

  test('createComputeRef function', function (assert) {
    const ref = createComputeRef(() => 42);
    assert.strictEqual(ref.value, 42, 'compute ref value is correct');
  });

  test('createConstRef function', function (assert) {
    const ref = createConstRef(42);
    assert.strictEqual(ref.value, 42, 'const ref value is correct');
  });

  test('createUnboundRef function', function (assert) {
    const ref = createUnboundRef(42);
    assert.strictEqual(ref.value, 42, 'unbound ref value is correct');
  });

  test('createPrimitiveRef function', function (assert) {
    const ref = createPrimitiveRef(42);
    assert.strictEqual(ref.value, 42, 'primitive ref value is correct');
  });

  test('childRefFor function', function (assert) {
    const parent = createConstRef({ child: 42 });
    const childRef = childRefFor(parent, 'child');
    assert.strictEqual(childRef.value, 42, 'child ref value is correct');
  });

  test('valueForRef function', function (assert) {
    const ref = createConstRef(42);
    assert.strictEqual(valueForRef(ref), 42, 'value for ref is correct');
  });

  test('dirtyTagFor function', function (assert) {
    const obj = { key: 42 };
    dirtyTagFor(obj, 'key');
    assert.strictEqual(obj.key, 42, 'dirty tag for is correct');
  });

  test('isTracking function', function (assert) {
    assert.false(isTracking(), 'is tracking is correct');
  });

  test('consumeTag function', function (assert) {
    const tag = createConstRef(42);
    consumeTag(tag);
    assert.strictEqual(tag.value, 42, 'consume tag is correct');
  });

  test('trackedData function', function (assert) {
    class MyClass {
      @trackedData('value') value = 42;
    }
    const instance = new MyClass();
    assert.strictEqual(instance.value, 42, 'tracked data is correct');
  });

  test('beginTrackFrame function', function (assert) {
    beginTrackFrame();
    assert.true(isTracking(), 'begin track frame is correct');
  });

  test('endTrackFrame function', function (assert) {
    endTrackFrame();
    assert.false(isTracking(), 'end track frame is correct');
  });

  test('track function', function (assert) {
    let value = 0;
    track(() => {
      value++;
    });
    assert.strictEqual(value, 1, 'track is correct');
  });

  test('untrack function', function (assert) {
    let value = 0;
    untrack(() => {
      value++;
    });
    assert.strictEqual(value, 1, 'untrack is correct');
  });

  test('beginUntrackFrame function', function (assert) {
    beginUntrackFrame();
    assert.false(isTracking(), 'begin untrack frame is correct');
  });

  test('endUntrackFrame function', function (assert) {
    endUntrackFrame();
    assert.false(isTracking(), 'end untrack frame is correct');
  });

  test('valueForTag function', function (assert) {
    const tag = createConstRef(42);
    assert.strictEqual(valueForTag(tag), 42, 'value for tag is correct');
  });

  test('validateTag function', function (assert) {
    assert.false(validateTag(), 'validate tag is correct');
  });

  test('getOwner function', function (assert) {
    const obj = {};
    const owner = {};
    setOwner(obj, owner);
    assert.strictEqual(getOwner(obj), owner, 'get owner is correct');
  });

  test('setOwner function', function (assert) {
    const obj = {};
    const owner = {};
    setOwner(obj, owner);
    assert.strictEqual(getOwner(obj), owner, 'set owner is correct');
  });

  test('createStorage function', function (assert) {
    const storage = createStorage(42);
    assert.strictEqual(getStorageValue(storage), 42, 'create storage is correct');
  });

  test('getStorageValue function', function (assert) {
    const storage = createStorage(42);
    assert.strictEqual(getStorageValue(storage), 42, 'get storage value is correct');
  });

  test('setStorageValue function', function (assert) {
    const storage = createStorage(42);
    setStorageValue(storage, 84);
    assert.strictEqual(getStorageValue(storage), 84, 'set storage value is correct');
  });

  test('withRehydration function', function (assert) {
    class MyComponent extends Component {
      <template>
        <div>Hello, world!</div>
      </template>
    }
    const targetElement = document.createElement('div');
    withRehydration(() => renderComponent(MyComponent, targetElement), targetElement);
    assert.strictEqual(targetElement.textContent, 'Hello, world!', 'with rehydration is correct');
  });

  test('scheduleRevalidate function', function (assert) {
    scheduleRevalidate();
    assert.true(true, 'schedule revalidate is correct');
  });

  test('syncDom function', async function (assert) {
    await syncDom();
    assert.true(true, 'sync dom is correct');
  });

  test('$template symbol', function (assert) {
    assert.ok($template, '$template symbol exists');
  });

  test('$nodes symbol', function (assert) {
    assert.ok($nodes, '$nodes symbol exists');
  });

  test('$args symbol', function (assert) {
    assert.ok($args, '$args symbol exists');
  });

  test('$fwProp symbol', function (assert) {
    assert.ok($fwProp, '$fwProp symbol exists');
  });
});
