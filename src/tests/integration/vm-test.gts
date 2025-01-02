import { module, test } from 'qunit';
import { effect, opcodeFor } from '@/utils/vm';
import { cell } from '@/utils/reactive';

module('Integration | VM', function () {
  test('effect', function (assert) {
    let done = assert.async();
    let value = cell(0);
    let effectRan = false;

    const cleanup = effect(() => {
      effectRan = true;
      value.value;
    });

    value.update(1);

    setTimeout(() => {
      assert.ok(effectRan, 'Effect was run');
      cleanup();
      done();
    }, 50);
  });

  test('opcodeFor', function (assert) {
    let done = assert.async();
    let value = cell(0);
    let updatedValue = 0;

    const cleanup = opcodeFor(value, (val) => {
      updatedValue = val as number;
    });

    value.update(1);

    setTimeout(() => {
      assert.equal(updatedValue, 1, 'Opcode was executed');
      cleanup();
      done();
    }, 50);
  });
});
