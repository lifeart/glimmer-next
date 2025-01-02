import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';
import { $__eq, $__if, $__log, $__debugger, $__array, $__hash, $__fn, $__or, $__not, $__and } from '@/utils/helpers/index';

module('Integration | Helpers', function () {
  test('eq helper', async function (assert) {
    await render(<template>{{if ($__eq 1 1) 'equal' 'not equal'}}</template>);
    assert.dom().hasText('equal');
    await render(<template>{{if ($__eq 1 2) 'equal' 'not equal'}}</template>);
    assert.dom().hasText('not equal');
  });

  test('if helper', async function (assert) {
    await render(<template>{{if ($__if true 'true' 'false')}}</template>);
    assert.dom().hasText('true');
    await render(<template>{{if ($__if false 'true' 'false')}}</template>);
    assert.dom().hasText('false');
  });

  test('log helper', async function (assert) {
    let loggedValue;
    console.log = (value) => loggedValue = value;
    await render(<template>{{__log 'test log'}}</template>);
    assert.equal(loggedValue, 'test log');
  });

  test('debugger helper', async function (assert) {
    let hitDebugger = false;
    debugger = () => hitDebugger = true;
    await render(<template>{{__debugger}}</template>);
    assert.true(hitDebugger);
  });

  test('array helper', async function (assert) {
    await render(<template>{{#each ($__array 1 2 3) as |item|}}<span>{{item}}</span>{{/each}}</template>);
    assert.dom('span:nth-child(1)').hasText('1');
    assert.dom('span:nth-child(2)').hasText('2');
    assert.dom('span:nth-child(3)').hasText('3');
  });

  test('hash helper', async function (assert) {
    await render(<template>{{#let ($__hash a=1 b=2) as |hash|}}<span>{{hash.a}}</span><span>{{hash.b}}</span>{{/let}}</template>);
    assert.dom('span:nth-child(1)').hasText('1');
    assert.dom('span:nth-child(2)').hasText('2');
  });

  test('fn helper', async function (assert) {
    const onClick = (value) => assert.equal(value, 1);
    await render(<template><button {{on 'click' ($__fn onClick 1)}}>ClickMe</button></template>);
    await click('button');
  });

  test('or helper', async function (assert) {
    await render(<template>{{if ($__or false true) 'true' 'false'}}</template>);
    assert.dom().hasText('true');
    await render(<template>{{if ($__or false false) 'true' 'false')}}</template>);
    assert.dom().hasText('false');
  });

  test('not helper', async function (assert) {
    await render(<template>{{if ($__not false) 'true' 'false'}}</template>);
    assert.dom().hasText('true');
    await render(<template>{{if ($__not true) 'true' 'false')}}</template>);
    assert.dom().hasText('false');
  });

  test('and helper', async function (assert) {
    await render(<template>{{if ($__and true true) 'true' 'false'}}</template>);
    assert.dom().hasText('true');
    await render(<template>{{if ($__and true false) 'true' 'false')}}</template>);
    assert.dom().hasText('false');
  });
});
