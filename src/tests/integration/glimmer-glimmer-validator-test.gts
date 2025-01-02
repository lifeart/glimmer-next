import { module, test } from 'qunit';
import {
  dirtyTagFor,
  isTracking,
  consumeTag,
  trackedData,
  beginTrackFrame,
  endTrackFrame,
  track,
  untrack,
  beginUntrackFrame,
  endUntrackFrame,
  valueForTag,
  validateTag,
  tagFor,
} from '@/utils/glimmer/glimmer-validator';
import { cell } from '@/utils/reactive';

module('Integration | Glimmer | Glimmer Validator', function () {
  test('dirtyTagFor marks a tag as dirty', function (assert) {
    const obj = { foo: 'bar' };
    const tag = tagFor(obj, 'foo');
    dirtyTagFor(obj, 'foo');
    assert.ok(tag.isDirty, 'Tag is marked as dirty');
  });

  test('isTracking returns correct tracking state', function (assert) {
    assert.notOk(isTracking(), 'Not tracking by default');
    beginTrackFrame();
    assert.ok(isTracking(), 'Tracking after beginTrackFrame');
    endTrackFrame();
    assert.notOk(isTracking(), 'Not tracking after endTrackFrame');
  });

  test('consumeTag adds a tag to the current tracker', function (assert) {
    const tag = cell(42);
    beginTrackFrame();
    consumeTag(tag);
    assert.ok(isTracking(), 'Tag is added to the tracker');
    endTrackFrame();
  });

  test('trackedData returns getter and setter for tracked property', function (assert) {
    class Foo {
      @trackedData('bar')
      bar = 'baz';
    }
    const foo = new Foo();
    assert.strictEqual(foo.bar, 'baz', 'Getter returns correct value');
    foo.bar = 'qux';
    assert.strictEqual(foo.bar, 'qux', 'Setter updates value correctly');
  });

  test('beginTrackFrame and endTrackFrame manage tracking state', function (assert) {
    assert.notOk(isTracking(), 'Not tracking by default');
    beginTrackFrame();
    assert.ok(isTracking(), 'Tracking after beginTrackFrame');
    endTrackFrame();
    assert.notOk(isTracking(), 'Not tracking after endTrackFrame');
  });

  test('track executes callback within tracking frame', function (assert) {
    assert.notOk(isTracking(), 'Not tracking by default');
    track(() => {
      assert.ok(isTracking(), 'Tracking within track callback');
    });
    assert.notOk(isTracking(), 'Not tracking after track callback');
  });

  test('untrack executes callback outside of tracking frame', function (assert) {
    beginTrackFrame();
    assert.ok(isTracking(), 'Tracking by default');
    untrack(() => {
      assert.notOk(isTracking(), 'Not tracking within untrack callback');
    });
    assert.ok(isTracking(), 'Tracking after untrack callback');
    endTrackFrame();
  });

  test('beginUntrackFrame and endUntrackFrame manage untracking state', function (assert) {
    beginTrackFrame();
    assert.ok(isTracking(), 'Tracking by default');
    beginUntrackFrame();
    assert.notOk(isTracking(), 'Not tracking after beginUntrackFrame');
    endUntrackFrame();
    assert.ok(isTracking(), 'Tracking after endUntrackFrame');
    endTrackFrame();
  });

  test('valueForTag retrieves the value from a tag', function (assert) {
    const tag = cell(42);
    assert.strictEqual(valueForTag(tag), 42, 'Tag value is correct');
  });

  test('validateTag always returns false', function (assert) {
    assert.notOk(validateTag(), 'validateTag returns false');
  });
});
