import { module, test } from 'qunit';
import { cell, formula, tracked } from '@lifeart/gxt';

module('Integration | Utils | Reactive', function () {
  test('cell function', function (assert) {
    const value = cell('foo');
    assert.equal(value.value, 'foo', 'cell value is correct');
    value.update('bar');
    assert.equal(value.value, 'bar', 'cell value is updated');
  });

  test('formula function', function (assert) {
    const value = cell('foo');
    const computed = formula(() => value.value.toUpperCase());
    assert.equal(computed.value, 'FOO', 'formula value is correct');
    value.update('bar');
    assert.equal(computed.value, 'BAR', 'formula value is updated');
  });

  test('tracked decorator', function (assert) {
    class MyClass {
      @tracked value = 'foo';
    }
    const instance = new MyClass();
    assert.equal(instance.value, 'foo', 'tracked value is correct');
    instance.value = 'bar';
    assert.equal(instance.value, 'bar', 'tracked value is updated');
  });
});
