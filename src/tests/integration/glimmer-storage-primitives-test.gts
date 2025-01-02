import { module, test } from 'qunit';
import { createStorage, getValue, setValue } from '@/utils/glimmer/storage-primitives';

module('Integration | Glimmer | Storage Primitives', function () {
  test('createStorage creates a storage primitive', function (assert) {
    const storage = createStorage(42);
    assert.strictEqual(getValue(storage), 42, 'Storage value is correct');
  });

  test('getValue retrieves the value from the storage', function (assert) {
    const storage = createStorage(42);
    assert.strictEqual(getValue(storage), 42, 'Storage value is correct');
  });

  test('setValue updates the value in the storage', function (assert) {
    const storage = createStorage(42);
    setValue(storage, 84);
    assert.strictEqual(getValue(storage), 84, 'Storage value is updated correctly');
  });
});
