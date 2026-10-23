/**
 * R12 (ember.js#21340 N21-N25): key-aware native `{{#each-in}}`.
 *
 * `$__eachIn(obj, key)` resolves the `key=` option against each ENTRY (the way
 * Glimmer's toEachInIterator + Ember's keyEachInEntries do), not against the
 * lowered `[key, value]` pair — so `@key`/path keys no longer resolve to
 * `undefined`. A pair keeps its identity (the lowered `each` keeps its row)
 * while its row key is unchanged; a key-stable value change updates the pair's
 * value in place, while an `@identity` value change makes a new pair (new row).
 */
import { describe, test, expect } from 'vitest';
import { $__eachIn } from './helpers/each-in';

type V = { id: number; label: string };

describe('key-aware $__eachIn (R12)', () => {
  test('default (@identity): a value change makes a NEW pair (new row)', () => {
    const v1: V = { id: 1, label: 'a' };
    const obj: Record<string, V> = { x: v1 };
    const p1 = $__eachIn(obj)[0];
    expect(p1).toEqual(['x', v1]);
    // re-read, unchanged → same pair identity
    expect($__eachIn(obj)[0]).toBe(p1);
    // replace the value (same key) → new pair (identity keying = by value)
    obj.x = { id: 1, label: 'b' };
    expect($__eachIn(obj)[0]).not.toBe(p1);
  });

  test('path key: keyed by value[path]; retained+updated while path stable, new pair when path changes', () => {
    const v1: V = { id: 1, label: 'a' };
    const obj: Record<string, V> = { x: v1 };
    const p1 = $__eachIn(obj, 'id')[0];
    expect(p1).toEqual(['x', v1]);
    // replace the value object but KEEP id=1 → RETAIN pair, update value in place
    const v2: V = { id: 1, label: 'b' };
    obj.x = v2;
    const p2 = $__eachIn(obj, 'id')[0];
    expect(p2).toBe(p1);
    expect(p2[1]).toBe(v2);
    // change id → new pair (new row)
    obj.x = { id: 99, label: 'c' };
    expect($__eachIn(obj, 'id')[0]).not.toBe(p1);
  });

  test('@key: keyed by the entry key; a value change RETAINS the row', () => {
    const v1: V = { id: 1, label: 'a' };
    const obj: Record<string, V> = { x: v1 };
    const p1 = $__eachIn(obj, '@key')[0];
    const v2: V = { id: 2, label: 'b' };
    obj.x = v2; // same key 'x', different value (and different id)
    const p2 = $__eachIn(obj, '@key')[0];
    expect(p2).toBe(p1); // retained by entry key
    expect(p2[1]).toBe(v2);
  });

  test('@index: keyed by position; the row at a position is retained + updated', () => {
    const a: V = { id: 1, label: 'a' };
    const b: V = { id: 2, label: 'b' };
    const obj: Record<string, V> = { x: a, y: b };
    const r1 = $__eachIn(obj, '@index');
    const p0 = r1[0];
    const a2: V = { id: 9, label: 'a2' };
    obj.x = a2; // value at position 0 changes
    const r2 = $__eachIn(obj, '@index');
    expect(r2[0]).toBe(p0); // position 0 retained
    expect(r2[0][1]).toBe(a2);
  });

  test('distinct key modes over the same object do not clobber each other', () => {
    const v1: V = { id: 1, label: 'a' };
    const obj: Record<string, V> = { x: v1 };
    const identPair = $__eachIn(obj)[0];
    const idPair = $__eachIn(obj, 'id')[0];
    // Separate per-mode caches: the two modes hand out independent pairs.
    expect(idPair).not.toBe(identPair);
    // Each mode is stable across re-reads.
    expect($__eachIn(obj)[0]).toBe(identPair);
    expect($__eachIn(obj, 'id')[0]).toBe(idPair);
  });

  test('a removed key drops its pair; a re-added key gets a fresh pair', () => {
    const v1: V = { id: 1, label: 'a' };
    const obj: Record<string, V> = { x: v1 };
    const p1 = $__eachIn(obj, 'id')[0];
    delete obj.x;
    expect($__eachIn(obj, 'id')).toHaveLength(0);
    obj.x = { id: 1, label: 'a' };
    expect($__eachIn(obj, 'id')[0]).not.toBe(p1); // fresh pair
  });

  test('nullish / primitive sources iterate nothing', () => {
    expect($__eachIn(null, 'id')).toEqual([]);
    expect($__eachIn(undefined)).toEqual([]);
    expect($__eachIn(42 as unknown, 'id')).toEqual([]);
  });
});
