import { module, test } from 'qunit';
import { isArray, isFn, isEmpty, isPrimitive, isTagLike } from '@/utils/shared';

module('Integration | Shared', function () {
  test('isArray function', function (assert) {
    assert.true(isArray([]), 'isArray returns true for arrays');
    assert.false(isArray({}), 'isArray returns false for non-arrays');
  });

  test('isFn function', function (assert) {
    assert.true(isFn(() => {}), 'isFn returns true for functions');
    assert.false(isFn({}), 'isFn returns false for non-functions');
  });

  test('isEmpty function', function (assert) {
    assert.true(isEmpty(null), 'isEmpty returns true for null');
    assert.true(isEmpty(undefined), 'isEmpty returns true for undefined');
    assert.false(isEmpty({}), 'isEmpty returns false for non-empty values');
  });

  test('isPrimitive function', function (assert) {
    assert.true(isPrimitive('string'), 'isPrimitive returns true for strings');
    assert.true(isPrimitive(42), 'isPrimitive returns true for numbers');
    assert.false(isPrimitive({}), 'isPrimitive returns false for non-primitives');
  });

  test('isTagLike function', function (assert) {
    const tag = { [Symbol('isTag')]: true };
    assert.true(isTagLike(tag), 'isTagLike returns true for tag-like objects');
    assert.false(isTagLike({}), 'isTagLike returns false for non-tag-like objects');
  });
});
