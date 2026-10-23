import { HOST_HOOKS } from '../host-hooks';
import { entangleObjectKeys } from '../each-in-keyset';
import { $__tag } from './tag';

/** A `{{#each-in}}` row item: `[key, value]`. */
export type EachInPair = [unknown, unknown];

// Stable pairs per iterated object, namespaced by the KEY MODE so distinct
// `{{#each-in}}` blocks over the same object with different `key=` don't
// collide: `WeakMap<obj, Map<mode, Map<rowKey, pair>>>`. The inner map keys by
// the ROW KEY directly (object OR primitive), so object row keys compare by
// reference — no `String()` collapse. A pair keeps its identity — so the
// `@identity`-keyed lowered `each` keeps (and moves) its row — while its row key
// is unchanged.
const PAIRS = new WeakMap<object, Map<string, Map<unknown, EachInPair>>>();

/**
 * The ROW KEY of an entry for the `key=` option, the way Glimmer's
 * `toEachInIterator` + Ember's `keyEachInEntries` do (ember.js#21340 N21-N25):
 *   - `@identity` (default) / `@key`: the entry KEY (its object property name);
 *     they differ only on how a VALUE change is treated (see `$__eachIn`).
 *   - `@index`: the entry's POSITION.
 *   - a path (`id`, `a.b`): the path read on the VALUE (NOT on the `[key,value]`
 *     pair — resolving against the pair is why path/`@key` keys used to resolve
 *     to `undefined`).
 */
function rowKeyOf(
  entryKey: unknown,
  value: unknown,
  index: number,
  mode: string,
): unknown {
  if (mode === '@identity' || mode === '@key') return entryKey;
  if (mode === '@index') return index;
  if (value === null || value === undefined) return undefined;
  if (mode.indexOf('.') === -1) {
    return (value as Record<string, unknown>)[mode];
  }
  let current: unknown = value;
  for (const part of mode.split('.')) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * `{{#each-in obj key=KEY as |key value|}}` iteration source (G5; the compiler
 * lowers each-in to `$_eachSync(() => $__eachIn(obj, KEY), ([key, value],
 * $index, ctx) => …)` with the `each` keyed by `@identity` on the returned
 * pairs — this function owns the keying).
 *
 * Entries come from the host's `eachInEntries` hook when registered (Ember:
 * Glimmer's `toEachInIterator`), else from the object's own enumerable keys,
 * each value read through the property-tag tap (`$__tag`) and the key SET
 * entangled (`entangleObjectKeys`) so a host key-addition signal re-runs the
 * source. Nullish / primitive sources iterate nothing.
 *
 * `key` (default `@identity`) selects how a row is kept vs re-created:
 *   - `@identity`: keyed by the entry; a VALUE change is a NEW pair (new row) —
 *     Glimmer `@identity` keys each-in by value. (Historic default, unchanged.)
 *   - `@key` / `@index` / a path: keyed by the entry key / position / resolved
 *     path value; while that row key is unchanged the pair is RETAINED and its
 *     value updated IN PLACE, so a key-stable value change updates the row
 *     instead of re-creating it.
 */
export function $__eachIn(obj: unknown, key?: string | null): EachInPair[] {
  if (obj === null || obj === undefined) return [];
  const type = typeof obj;
  if (type !== 'object' && type !== 'function') return [];
  const source = obj as object;
  const mode = key == null ? '@identity' : key;
  let entries: ReadonlyArray<EachInPair>;
  const hook = HOST_HOOKS.eachInEntries;
  if (hook !== undefined) {
    entries = hook(source) ?? [];
  } else {
    const keys = Object.keys(source);
    entangleObjectKeys(source, keys);
    entries = keys.map((k) => [k, $__tag(source, k)] as EachInPair);
  }
  let modeMap = PAIRS.get(source);
  if (modeMap === undefined) {
    modeMap = new Map();
    PAIRS.set(source, modeMap);
  }
  let pairs = modeMap.get(mode);
  if (pairs === undefined) {
    pairs = new Map();
    modeMap.set(mode, pairs);
  }
  const out: EachInPair[] = new Array(entries.length);
  const live = new Set<unknown>();
  for (let i = 0; i < entries.length; i++) {
    const [entryKey, value] = entries[i]!;
    const rowKey = rowKeyOf(entryKey, value, i, mode);
    live.add(rowKey);
    let pair = pairs.get(rowKey);
    if (pair === undefined) {
      pair = [entryKey, value];
      pairs.set(rowKey, pair);
    } else if (mode === '@identity') {
      // Glimmer `@identity`: a value change is a NEW row. Replace the pair
      // OBJECT (new identity) so the `@identity`-keyed each re-creates the row.
      if (!Object.is(pair[1], value)) {
        pair = [entryKey, value];
        pairs.set(rowKey, pair);
      }
    } else if (!Object.is(pair[1], value) || !Object.is(pair[0], entryKey)) {
      // Stable row key, changed value/key: RETAIN the pair identity (keep the
      // row) and update its value/key IN PLACE (a reactive row body re-reads the
      // new value rather than the row being re-created).
      pair[0] = entryKey;
      pair[1] = value;
    }
    out[i] = pair;
  }
  // Forget pairs for THIS mode whose row key is no longer live (a re-added key
  // gets a fresh pair / row). Other modes' pairs are left untouched.
  if (pairs.size > out.length) {
    for (const rowKey of Array.from(pairs.keys())) {
      if (!live.has(rowKey)) pairs.delete(rowKey);
    }
  }
  return out;
}
