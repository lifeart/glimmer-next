import { module, test } from 'qunit';
import { rerender, render } from '@lifeart/gxt/test-utils';
import { cell, effect, formula } from '@lifeart/gxt';

module('Integration | Internal | effect', function () {
  test('effects executed in render time', async function (assert) {
    const value = cell(0);
    let derivedState = -1;
    let executionsCount = 0;
    const destructor = effect(() => {
      executionsCount++;
      derivedState = value.value;
    });
    assert.equal(derivedState, 0, `effect executed in initialization`);
    await rerender();
    assert.equal(executionsCount, 1, `if no mutations effects not re-executed`);
    destructor();
  });
  test('effect updated once any of roots updated', async function (assert) {
    const value = cell(0);
    let derivedState = -1;
    let executionsCount = 0;
    const destructor = effect(() => {
      derivedState = value.value;
      executionsCount++;
    });
    assert.equal(derivedState, 0, `effect executed in initialization`);
    assert.equal(executionsCount, 1, `effect executed once`);
    value.update(1);
    await rerender();
    assert.equal(derivedState, 1, `after render effect executed`);
    assert.equal(executionsCount, 2, `effect executed twice`);
    destructor();
  });
  test('it support multuple roots', async function (assert) {
    const value1 = cell(0);
    const value2 = cell(0);
    let derivedState = -1;
    let executionsCount = 0;
    const destructor = effect(() => {
      derivedState = value1.value + value2.value;
      executionsCount++;
    });
    assert.equal(derivedState, 0, `effect executed in initialization`);
    assert.equal(executionsCount, 1, `effect executed once`);
    value1.update(1);
    await rerender();
    assert.equal(derivedState, 1, `after render effect executed`);
    assert.equal(executionsCount, 2, `effect executed twice`);
    value2.update(1);
    await rerender();
    assert.equal(derivedState, 2, `after render effect executed`);
    assert.equal(executionsCount, 3, `effect executed twice`);
    // if we update 2 values, effect executed only once
    value1.update(2);
    value2.update(2);
    await rerender();
    assert.equal(derivedState, 4, `after render effect executed`);
    assert.equal(executionsCount, 4, `effect executed twice`);
    destructor();
  });
  test('if effect depends from formula depending on root, it still works', async function (assert) {
    const value = cell(0);
    const formulaValue = formula(() => value.value);
    let derivedState = -1;
    let executionsCount = 0;
    const destructor = effect(() => {
      derivedState = formulaValue.value;
      executionsCount++;
    });
    assert.equal(derivedState, 0, `effect executed in initialization`);
    assert.equal(executionsCount, 1, `effect executed once`);
    value.update(1);
    await rerender();
    assert.equal(derivedState, 1, `after render effect executed`);
    assert.equal(executionsCount, 2, `effect executed twice`);
    destructor();
  });
  test('effect should be able to set reactive value without loop', async function (assert) {
    const value = cell(0);
    const derivedValue = cell(0);
    let executionsCount = 0;
    const destructor = effect(() => {
      derivedValue.update(value.value);
      executionsCount++;
    });
    assert.equal(derivedValue.value, 0, `effect executed in initialization`);
    assert.equal(executionsCount, 1, `effect executed once`);
    value.update(1);
    await rerender();
    assert.equal(derivedValue.value, 1, `after render effect executed`);
    assert.equal(executionsCount, 2, `effect executed twice`);
    destructor();
  });
  test('effect could be used as modifier', async function (assert) {
    const value = cell(0);
    const derivedValue = cell(0);
    let executionsCount = 0;
    const autoBindedEffect = (_: HTMLDivElement) => {
      return effect(() => {
        derivedValue.update(value.value);
        executionsCount++;
      });
    };
    await render(
      <template>
        <div {{autoBindedEffect}}></div>
      </template>,
    );
    assert.equal(derivedValue.value, 0, `effect executed in initialization`);
    assert.equal(executionsCount, 1, `effect executed once`);
    value.update(1);
    await rerender();
    assert.equal(
      derivedValue.value,
      1,
      `after source value mutation effect executed`,
    );
    assert.equal(executionsCount, 2, `effect executed second time`);
    value.update(2);
    await rerender();
    assert.equal(
      derivedValue.value,
      2,
      `after another source value mutation effect executed`,
    );
    assert.equal(executionsCount, 3, `effect executed third time`);
    derivedValue.update(3);
    await rerender();
    assert.equal(
      derivedValue.value,
      3,
      `if derived value mutated explicitly, effect not executed`,
    );
    assert.equal(executionsCount, 3, `executions count not changed`);
  });
  test('check loop guard', async function (assert) {
    const source = cell(1);
    const derived = cell(1);
    let executionsCount = 0;
    const destructor = effect(() => {
      derived.update(source.value);
      source.value = Math.random();
      executionsCount++;
      console.log('effect executed');
    });
    assert.notEqual(derived.value, source.value);
    assert.equal(executionsCount, 1, `effect executed once`);
    source.update(2);
    await rerender();
    assert.notEqual(derived.value, source.value);
    assert.equal(executionsCount, 2, `effect executed second time`);
    await rerender();
    assert.equal(executionsCount, 2, `effect executed second time`);

    destructor();
  });
});
