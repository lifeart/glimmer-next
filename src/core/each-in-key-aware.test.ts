/**
 * Key-aware native `{{#each-in}}` (emberjs/ember.js#21340: the native
 * "{{#each-in}} with the key option" tests).
 *
 * `$__eachIn(obj, key)` gives each entry the key of its row, as Glimmer keys an
 * each-in list for the `key=` option (`keyFor` over the each-in iterator, whose
 * memo is the entry's key, made unique by `uniqueKeyFor`): the value
 * (`@identity`, the default), the entry's key (`@key`), the entry's key as a
 * string (`@index`), or the value at a path of the value. The list keys its
 * rows by it (list.ts `EACH_IN_KEY`).
 */
import { describe, test, expect, afterEach } from 'vitest';
import { $__eachIn } from './helpers/each-in';
import { HOST_HOOKS } from './host-hooks';

type V = { id: number; label: string };

const rowKeys = (obj: unknown, key?: string) => $__eachIn(obj, key).map((entry) => entry[2]);

// The host's entries of a Map (Glimmer's each-in iterator), which the default
// enumeration of own keys cannot give.
function useMapEntries() {
  HOST_HOOKS.eachInEntries = (obj: object) =>
    obj instanceof Map ? Array.from(obj.entries()) : Object.entries(obj);
}

describe('key-aware $__eachIn (each-in key option)', () => {
  afterEach(() => {
    delete (HOST_HOOKS as Record<string, unknown>).eachInEntries;
  });

  test('an entry is [key, value, rowKey]', () => {
    const v1: V = { id: 1, label: 'a' };
    expect($__eachIn({ x: v1, y: 2 })).toEqual([
      ['x', v1, v1],
      ['y', 2, 'number:2#0'],
    ]);
  });

  test('default (@identity): keyed by the value, the same for another object with the same values', () => {
    const v1: V = { id: 1, label: 'a' };
    expect(rowKeys({ a: 1, b: v1 })).toEqual(['number:1#0', v1]);
    expect(rowKeys({ b: v1, a: 1 })).toEqual([v1, 'number:1#0']);
    // a changed value is another row key (a new row)
    expect(rowKeys({ a: 1, b: { ...v1 } })[1]).not.toBe(v1);
    // `null` and `undefined` values are keys of their own
    expect(rowKeys({ a: null, b: undefined })).toEqual(['object:null#0', 'undefined:undefined#0']);
  });

  test('@key: keyed by the entry key, whatever the value', () => {
    expect(rowKeys({ a: 1, b: 2 }, '@key')).toEqual(['string:a#0', 'string:b#0']);
    expect(rowKeys({ a: 9, b: 3 }, '@key')).toEqual(['string:a#0', 'string:b#0']);
    useMapEntries();
    const k1 = { name: 'k1' };
    expect(rowKeys(new Map([[k1, 1]]), '@key')).toEqual([k1]);
  });

  test('@index: keyed by the entry key as a string, so object keys of a Map collide and are told apart by occurrence', () => {
    expect(rowKeys({ b: 2, a: 9 }, '@index')).toEqual(['string:b#0', 'string:a#0']);
    useMapEntries();
    const a = { name: 'a' };
    const b = { name: 'b' };
    expect(rowKeys(new Map([[a, 1], [b, 2]]), '@index')).toEqual([
      'string:[object Object]#0',
      'string:[object Object]#1',
    ]);
  });

  test('a path key: keyed by the value at that path of the value', () => {
    expect(rowKeys({ a: { id: 1 }, b: { id: 2 } }, 'id')).toEqual(['number:1#0', 'number:2#0']);
    expect(rowKeys({ a: { v: { id: 'x' } } }, 'v.id')).toEqual(['string:x#0']);
    expect(rowKeys({ a: null }, 'id')).toEqual(['object:null#0']);
  });

  test('repeated row keys are told apart by occurrence, an object by a stable key per occurrence', () => {
    const v1: V = { id: 1, label: 'a' };
    const first = rowKeys({ a: v1, b: v1, c: v1 });
    expect(first[0]).toBe(v1);
    expect(first[1]).not.toBe(v1);
    expect(first[2]).not.toBe(first[1]);
    const again = rowKeys({ x: v1, y: v1, z: v1 });
    again.forEach((key, i) => expect(key).toBe(first[i]));
    expect(rowKeys({ a: 1, b: 1 })).toEqual(['number:1#0', 'number:1#1']);
    // two symbols with the same description stay apart
    const s1 = Symbol('s');
    const s2 = Symbol('s');
    expect(rowKeys({ a: s1, b: s2 })).toEqual([s1, s2]);
  });

  test('nullish / primitive sources iterate nothing', () => {
    expect($__eachIn(null, 'id')).toEqual([]);
    expect($__eachIn(undefined)).toEqual([]);
    expect($__eachIn(42 as unknown, 'id')).toEqual([]);
  });
});
