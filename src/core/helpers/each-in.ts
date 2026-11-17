import { HOST_HOOKS } from '../host-hooks';
import { entangleObjectKeys } from '../each-in-keyset';
import { $__tag } from './tag';

/**
 * A `{{#each-in}}` row item: `[key, value, rowKey]`, `rowKey` the key of the
 * entry's row (see `$__eachIn`).
 */
export type EachInEntry = [unknown, unknown, unknown];

/**
 * The raw row key of an entry for the `key=` option, as Glimmer's `keyFor`
 * (`@glimmer/reference` iterable.ts) computes it over the each-in iterator,
 * whose memo is the entry's key:
 *   - `@identity` (the default): the value;
 *   - `@key`: the entry's key;
 *   - `@index`: the entry's key as a string (so every object key of a Map
 *     yields the same one);
 *   - a path (`id`, `a.b`): the value at that path of the VALUE (not of the
 *     `[key, value]` pair).
 */
function rawRowKey(entryKey: unknown, value: unknown, mode: string): unknown {
  if (mode === '@identity') return value;
  if (mode === '@key') return entryKey;
  if (mode === '@index') return String(entryKey);
  let current: unknown = value;
  for (const part of mode.indexOf('.') === -1 ? [mode] : mode.split('.')) {
    if (current === null || current === undefined) return current;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// The row keys of the 2nd, 3rd, … entries with the same object raw key in one
// pass (Glimmer's `uniqueKeyFor`): stable per (object, occurrence), and held
// only as long as the object.
const REPEATED_OBJECT_KEYS = new WeakMap<object, object[]>();

/**
 * The row key of the `count`-th (0-based) entry of a pass whose raw key is
 * `raw`, unique among the pass's entries as Glimmer's `uniqueKeyFor` makes
 * it. An object (or a symbol) is its own key on its first occurrence, so the
 * list compares it by reference — two objects never collide, as they would
 * through `String()` — and a primitive is a string qualified by its type.
 */
function uniqueRowKey(raw: unknown, count: number): unknown {
  const type = typeof raw;
  if (raw !== null && (type === 'object' || type === 'function')) {
    if (count === 0) return raw;
    let keys = REPEATED_OBJECT_KEYS.get(raw as object);
    if (keys === undefined) {
      keys = [];
      REPEATED_OBJECT_KEYS.set(raw as object, keys);
    }
    let key = keys[count - 1];
    if (key === undefined) {
      key = {};
      keys[count - 1] = key;
    }
    return key;
  }
  if (type === 'symbol' && count === 0) return raw;
  return `${type}:${String(raw)}#${count}`;
}

/**
 * `{{#each-in obj key=KEY as |key value|}}` iteration source (G5; the compiler
 * lowers each-in to `$_eachSync(() => $__eachIn(obj, KEY), ($__entry, $index,
 * ctx) => …, "@each-in")`, the row reading its key and value through the
 * reference to its entry, `$__entry.value[0]` / `[1]`).
 *
 * Entries come from the host's `eachInEntries` hook when registered (Ember:
 * Glimmer's `toEachInIterator`), else from the object's own enumerable keys,
 * each value read through the property-tag tap (`$__tag`) and the key SET
 * entangled (`entangleObjectKeys`) so a host key-addition signal re-runs the
 * source. Nullish / primitive sources iterate nothing.
 *
 * Each entry carries the key of its row for `key` (default `@identity`), as
 * Glimmer keys an each-in list (see `rawRowKey`, `uniqueRowKey`). The list
 * keys its rows by it, so a row is kept, moved or replaced as in Glimmer — the
 * same for every source object the list iterates, a new object with the same
 * entries included — and a kept row shows the entry's current key and value.
 */
export function $__eachIn(obj: unknown, key?: string | null): EachInEntry[] {
  if (obj === null || obj === undefined) return [];
  const type = typeof obj;
  if (type !== 'object' && type !== 'function') return [];
  const source = obj as object;
  const mode = key == null ? '@identity' : key;
  let entries: ReadonlyArray<[unknown, unknown]>;
  const hook = HOST_HOOKS.eachInEntries;
  if (hook !== undefined) {
    entries = hook(source) ?? [];
  } else {
    const keys = Object.keys(source);
    entangleObjectKeys(source, keys);
    entries = keys.map((k) => [k, $__tag(source, k)] as [unknown, unknown]);
  }
  const out: EachInEntry[] = new Array(entries.length);
  const occurrences = new Map<unknown, number>();
  for (let i = 0; i < entries.length; i++) {
    const [entryKey, value] = entries[i]!;
    const raw = rawRowKey(entryKey, value, mode);
    const count = occurrences.get(raw) ?? 0;
    occurrences.set(raw, count + 1);
    out[i] = [entryKey, value, uniqueRowKey(raw, count)];
  }
  return out;
}
