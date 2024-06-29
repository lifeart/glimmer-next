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

    assert.throws(() => obj.key);

    const cell = cellFor(obj, 'key');

    assert.ok(cell);

    assert.throws(() => cell.value);

    shouldThrow = false;
    assert.equal(cell.value, 42);
  });
});
