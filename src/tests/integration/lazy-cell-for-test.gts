import { module, test } from 'qunit';
import { validator } from '@lifeart/gxt/glimmer-compatibility';
const cellFor = validator.tagFor;

module('Integration | Internal | LazyCellFor', function () {
  test('it works', function (assert) {
    const obj: Record<string, unknown> = {};
    let shouldThrow = true;
    Object.defineProperty(obj, 'key', {
      get() {
        if (!shouldThrow) {
          return 42;
        }
        throw new Error('Do not get me!');
      },
      set() {
        // fine
      },
    });

    assert.throws(() => obj.key, Error, 'Getter is throwing');

    const cell = cellFor(obj, 'key');

    assert.ok(cell, 'Cell is created');

    assert.throws(
      () => cell.value,
      Error,
      'Cell is throwing because of getter',
    );

    shouldThrow = false;
    assert.equal(cell.value, 42, 'Cell is not throwing anymore');
  });
});
