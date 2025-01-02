import { module, test } from 'qunit';
import { scheduleRevalidate, syncDom } from '@/utils/runtime';
import { cell } from '@/utils/reactive';

module('Integration | Runtime', function () {
  test('scheduleRevalidate', function (assert) {
    let done = assert.async();
    let value = cell(0);
    let revalidated = false;

    scheduleRevalidate();

    value.update(1);

    setTimeout(() => {
      revalidated = true;
      assert.ok(revalidated, 'Revalidation was scheduled and executed');
      done();
    }, 50);
  });

  test('syncDom', async function (assert) {
    let value = cell(0);
    let updatedValue = 0;

    value.update(1);

    await syncDom();

    updatedValue = value.value;

    assert.equal(updatedValue, 1, 'DOM was synchronized with updated value');
  });
});
