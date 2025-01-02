import { module, test } from 'qunit';
import { createCache, getValue, isConst } from '@/utils/glimmer/caching-primitives';

module('Integration | Glimmer | Caching Primitives', function () {
  test('createCache creates a cache', function (assert) {
    const cache = createCache(() => 42);
    assert.strictEqual(getValue(cache), 42, 'Cache value is correct');
  });

  test('getValue retrieves the value from the cache', function (assert) {
    const cache = createCache(() => 42);
    assert.strictEqual(getValue(cache), 42, 'Cache value is correct');
  });

  test('isConst checks if the cache is constant', function (assert) {
    const cache = createCache(() => 42);
    assert.true(isConst(cache), 'Cache is constant');
  });
});
