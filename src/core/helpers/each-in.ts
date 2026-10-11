import { HOST_HOOKS } from '../host-hooks';
import { entangleObjectKeys } from '../each-in-keyset';
import { $__tag } from './tag';

/** A `{{#each-in}}` row item: `[key, value]`. */
export type EachInPair = [unknown, unknown];

// Stable pairs per iterated object and key: the SAME pair object while the
// key's value is unchanged, so the `@identity`-keyed lowered `each` keeps (and
// moves) the row; a changed value is a new pair → a new row (Glimmer
// `@identity` keys each-in rows by value).
const PAIRS = new WeakMap<object, Map<unknown, EachInPair>>();

/**
 * `{{#each-in obj as |key value|}}` iteration source (G5; the EMBER_NATIVE
 * compiler lowers each-in to `$_eachSync(() => $__eachIn(obj), ([key, value],
 * $index, ctx) => …)`).
 *
 * Entries come from the host's `eachInEntries` hook when registered (Ember:
 * Glimmer's `toEachInIterator` — Maps / native iterables of pairs,
 * forEach-ables, arrays, plain objects — consuming the tags that make the
 * iteration reactive), else from the object's own enumerable keys, each value
 * read through the property-tag tap (`$__tag`, host `getProp` when present)
 * and the key SET entangled (`entangleObjectKeys`) so a host key-addition
 * signal re-runs the source. Nullish / primitive sources iterate nothing.
 */
export function $__eachIn(obj: unknown): EachInPair[] {
  if (obj === null || obj === undefined) return [];
  const type = typeof obj;
  if (type !== 'object' && type !== 'function') return [];
  const source = obj as object;
  let entries: ReadonlyArray<EachInPair>;
  const hook = HOST_HOOKS.eachInEntries;
  if (hook !== undefined) {
    entries = hook(source) ?? [];
  } else {
    const keys = Object.keys(source);
    entangleObjectKeys(source, keys);
    entries = keys.map((key) => [key, $__tag(source, key)] as EachInPair);
  }
  let pairs = PAIRS.get(source);
  if (pairs === undefined) {
    pairs = new Map();
    PAIRS.set(source, pairs);
  }
  const out: EachInPair[] = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i]!;
    let pair = pairs.get(key);
    if (pair === undefined || !Object.is(pair[1], value)) {
      pair = [key, value];
      pairs.set(key, pair);
    }
    out[i] = pair;
  }
  if (pairs.size > out.length) {
    // Forget removed keys (a re-added key gets a fresh pair / row).
    const live = new Set(out.map((pair) => pair[0]));
    for (const key of Array.from(pairs.keys())) {
      if (!live.has(key)) pairs.delete(key);
    }
  }
  return out;
}
