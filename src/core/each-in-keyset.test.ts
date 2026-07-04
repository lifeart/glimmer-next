import { describe, test, expect } from 'vitest';
import { formula, getTracker, setTracker } from './reactive';
import {
  entangleObjectKeys,
  notifyObjectKeyAdded,
  hasObservedKeySet,
  keySetRevisionFor,
} from './each-in-keyset';

/**
 * Run `fn` inside a fresh tracking frame and return the cells it consumed.
 * Mirrors `reactive-collections.test.ts` — avoids the full DOM pipeline.
 */
function track<T>(fn: () => T): { value: T; consumed: Set<unknown> } {
  const prev = getTracker();
  const trk = new Set<any>();
  setTracker(trk);
  try {
    const value = fn();
    return { value, consumed: trk };
  } finally {
    setTracker(prev);
  }
}

/**
 * Model an `{{#each-in obj}}` iteration source the way Ember's rewritten
 * `{{#each (gxtEntriesOf obj)}}` does: enumerate the object's own keys,
 * entangle the key-set, and render `k=v` pairs. (Outside a render frame a
 * `MergedCell` recomputes on every `.value` read, so this doubles as a
 * re-iteration trigger.)
 */
function eachInSource(obj: Record<string, unknown>) {
  return formula(() => {
    const keys = Object.keys(obj);
    entangleObjectKeys(obj, keys);
    return keys.map((k) => `${k}=${String(obj[k])}`).join(',');
  }, 'each-in-source');
}

describe('each-in key-set reactivity', () => {
  test('entangle records the observed key-set for the object', () => {
    const obj = { a: 1 };
    expect(hasObservedKeySet(obj)).toBe(false);
    entangleObjectKeys(obj, Object.keys(obj));
    expect(hasObservedKeySet(obj)).toBe(true);
  });

  test('entangle subscribes the active tracker frame; no-op outside one', () => {
    const obj = { a: 1 };
    // Inside a tracking frame, entangle consumes exactly one cell — the
    // object's key-set revision cell (plain key/value reads tap no gxt cells).
    // This is the subscription the source formula relies on.
    const { consumed } = track(() => entangleObjectKeys(obj, Object.keys(obj)));
    expect(consumed.size).toBe(1);

    // Outside a tracking frame the read registers nothing.
    expect(getTracker()).toBeNull();
    entangleObjectKeys(obj, Object.keys(obj));
    expect(getTracker()).toBeNull();
  });

  test('a NEW key bumps the key-set revision (host add-signal)', () => {
    const obj: Record<string, unknown> = { a: 1 };
    entangleObjectKeys(obj, Object.keys(obj));
    expect(keySetRevisionFor(obj)).toBe(0);

    obj.b = 2;
    notifyObjectKeyAdded(obj, 'b');
    expect(keySetRevisionFor(obj)).toBe(1);
  });

  test('a value-only change of an existing key does NOT bump the key-set', () => {
    const obj: Record<string, unknown> = { a: 1 };
    entangleObjectKeys(obj, Object.keys(obj));
    expect(keySetRevisionFor(obj)).toBe(0);

    // Re-writing an ALREADY-observed key is not a key-set addition — the
    // revision must stay put (the per-value cell owns value changes).
    obj.a = 99;
    notifyObjectKeyAdded(obj, 'a');
    expect(keySetRevisionFor(obj)).toBe(0);
  });

  test('adding the same new key twice bumps exactly once (idempotent)', () => {
    const obj: Record<string, unknown> = { a: 1 };
    entangleObjectKeys(obj, Object.keys(obj));

    obj.b = 2;
    notifyObjectKeyAdded(obj, 'b');
    notifyObjectKeyAdded(obj, 'b'); // duplicate add — inert
    expect(keySetRevisionFor(obj)).toBe(1);
  });

  test('notify on an object no each-in ever iterated is a no-op', () => {
    const obj = { x: 1 };
    // Never entangled → no seen-set, no cell. Must not throw or allocate a cell.
    expect(hasObservedKeySet(obj)).toBe(false);
    expect(() => notifyObjectKeyAdded(obj, 'y')).not.toThrow();
    expect(hasObservedKeySet(obj)).toBe(false);
    expect(keySetRevisionFor(obj)).toBe(0);
  });

  test('re-iteration forgets removed keys so a later re-add bumps again', () => {
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    entangleObjectKeys(obj, Object.keys(obj)); // observes {a, b}

    // Key deletion is not itself an add-signal, but a subsequent add re-runs
    // the source, which re-records the CURRENT key-set (without 'b').
    delete obj.b;
    obj.c = 3;
    notifyObjectKeyAdded(obj, 'c'); // bump #1
    expect(keySetRevisionFor(obj)).toBe(1);
    entangleObjectKeys(obj, Object.keys(obj)); // re-iterate → observes {a, c}

    // 'b' was dropped from the observed set, so re-adding it is a genuine
    // addition again.
    obj.b = 20;
    notifyObjectKeyAdded(obj, 'b'); // bump #2
    expect(keySetRevisionFor(obj)).toBe(2);
  });

  test('two objects have independent key-sets', () => {
    const a: Record<string, unknown> = { x: 1 };
    const b: Record<string, unknown> = { x: 1 };
    entangleObjectKeys(a, Object.keys(a));
    entangleObjectKeys(b, Object.keys(b));

    a.y = 2;
    notifyObjectKeyAdded(a, 'y');
    expect(keySetRevisionFor(a)).toBe(1);
    expect(keySetRevisionFor(b)).toBe(0); // untouched
  });

  test('end-to-end: an each-in source both subscribes to and reflects an added key', () => {
    const obj: Record<string, unknown> = { a: 1 };
    const source = eachInSource(obj);

    // The source formula subscribes to the key-set cell while evaluating.
    const { consumed } = track(() => source.value);
    expect(consumed.size).toBe(1);
    expect(source.value).toBe('a=1');

    // Host adds a brand-new key + forwards the add-signal → revision bumps
    // (invalidating the subscribed source) and the re-evaluated source
    // reflects the new key.
    obj.b = 2;
    notifyObjectKeyAdded(obj, 'b');
    expect(keySetRevisionFor(obj)).toBe(1);
    expect(source.value).toBe('a=1,b=2');
  });
});
