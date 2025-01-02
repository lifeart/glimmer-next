import { module, test } from 'qunit';
import {
  createComputeRef,
  createConstRef,
  createUnboundRef,
  createPrimitiveRef,
  childRefFor,
  valueForRef,
} from '@/utils/glimmer/glimmer-reference';
import { cell } from '@/utils/reactive';

module('Integration | Glimmer | Glimmer Reference', function () {
  test('createComputeRef creates a compute reference', function (assert) {
    const computeRef = createComputeRef(() => 42);
    assert.strictEqual(computeRef.value, 42, 'Compute reference value is correct');
  });

  test('createConstRef creates a constant reference', function (assert) {
    const constRef = createConstRef(42);
    assert.strictEqual(constRef.value, 42, 'Constant reference value is correct');
  });

  test('createUnboundRef creates an unbound reference', function (assert) {
    const unboundRef = createUnboundRef(42);
    assert.strictEqual(unboundRef.value, 42, 'Unbound reference value is correct');
  });

  test('createPrimitiveRef creates a primitive reference', function (assert) {
    const primitiveRef = createPrimitiveRef(42);
    assert.strictEqual(primitiveRef.value, 42, 'Primitive reference value is correct');
  });

  test('childRefFor creates a child reference for an object path', function (assert) {
    const obj = { foo: { bar: 42 } };
    const parentRef = cell(obj);
    const childRef = childRefFor(parentRef, 'foo.bar');
    assert.strictEqual(childRef.value, 42, 'Child reference value is correct');
  });

  test('valueForRef retrieves the value from a reference', function (assert) {
    const ref = createConstRef(42);
    assert.strictEqual(valueForRef(ref), 42, 'Reference value is correct');
  });
});
