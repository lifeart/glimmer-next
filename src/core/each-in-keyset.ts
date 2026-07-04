/**
 * Native `{{#each-in}}` key-SET reactivity.
 *
 * `{{#each-in obj}}` iterates an object's OWN enumerable keys. Enumerating
 * those keys (`Object.keys(obj)`) taps each key's per-VALUE cell but NOT the
 * *set of keys*: when a brand-new key is added to a plain object
 * (`obj.newKey = v`, or Ember's `set(obj, 'newKey', v)`), the iteration source
 * has no dependency on "the key set" and never re-runs — so the new key is
 * never rendered.
 *
 * GXT cannot observe key ADDITION on a plain (non-cell, non-proxy) object: a
 * bare `obj.newKey = v` is invisible without a pre-installed getter/setter or a
 * Proxy, and `{{#each-in}}` must preserve object identity (no wrapping). So the
 * ADD-SIGNAL has to come from whoever owns the write path — for the Ember
 * dual-backend that is its `set` / `notifyPropertyChange` layer, which already
 * routes every keyed write through one seam. (Reactive `Map` / `Set` DO get
 * native addition tracking — their mutation methods are patched in
 * `reactive-collections.ts`; only plain objects need the host add-signal.)
 *
 * This module owns the reactivity PRIMITIVE — a per-object key-set revision
 * cell plus the observed-key bookkeeping that decides whether a write is a
 * genuine ADDITION — and exposes two host-facing seams:
 *
 *   - {@link entangleObjectKeys} — the iteration source (each-in) calls this
 *     while enumerating. It records the keys it observed for `obj` and reads
 *     `obj`'s key-set revision cell inside the active tracker frame, so the
 *     source formula subscribes to future additions.
 *   - {@link notifyObjectKeyAdded} — the host calls this on every keyed write.
 *     If an each-in source has observed `obj` and `key` is one it has NOT seen,
 *     the revision cell bumps → the source re-iterates and picks up the new
 *     key. A value-only change of an already-observed key is a no-op here (it
 *     already propagates through that key's own per-value cell).
 *
 * Both seams are host→GXT calls (GXT has no interior each-in caller). Standalone
 * GXT that never calls them keeps two empty `WeakMap`s and allocates nothing —
 * and the whole module tree-shakes out of a build that never imports it.
 */

import { cell, type Cell } from '@/core/reactive';

/**
 * Observed key set per iterated object. Present iff an each-in source has
 * enumerated the object at least once; the presence check is what gates
 * {@link notifyObjectKeyAdded} (a write to an object no each-in tracks is a
 * no-op). Keyed by the object → GC'd with it (no leak).
 */
const KEY_SET_SEEN = new WeakMap<object, Set<PropertyKey>>();

/**
 * Per-object key-set revision cell. Read by {@link entangleObjectKeys} (to
 * subscribe the source formula), bumped by {@link notifyObjectKeyAdded} (on a
 * genuine key addition). Keyed by the object → GC'd with it (no leak). Uses a
 * bare `cell(0)` — NOT `cellFor(obj, …)` — so the object itself is never
 * touched (no synthetic own-property, `{{#each-in}}` identity preserved).
 */
const KEY_SET_CELLS = new WeakMap<object, Cell<number>>();

function keySetCellFor(obj: object): Cell<number> {
  let c = KEY_SET_CELLS.get(obj);
  if (c === undefined) {
    c = cell(0, IS_DEV_MODE ? 'each-in.keySet' : undefined) as Cell<number>;
    KEY_SET_CELLS.set(obj, c);
  }
  return c;
}

/**
 * Called by an each-in iteration source (e.g. the host's `gxtEntriesOf`) while
 * it enumerates `obj`'s keys, from INSIDE the source formula's tracker frame.
 *
 * Records `keys` as the currently-observed key set for `obj` (replacing any
 * prior record, so a re-iteration after keys were removed correctly forgets
 * them) and reads `obj`'s key-set revision cell so the active source formula
 * subscribes to future additions. `cell.value` only registers a dependency
 * when a tracker is active, so calling this outside a tracking frame is a cheap
 * no-op read that still primes the seen-set for a later
 * {@link notifyObjectKeyAdded}.
 *
 * No-op for non-objects.
 */
export function entangleObjectKeys(
  obj: object,
  keys: readonly PropertyKey[],
): void {
  if (obj === null || typeof obj !== 'object') return;
  let seen = KEY_SET_SEEN.get(obj);
  if (seen === undefined) {
    seen = new Set<PropertyKey>();
    KEY_SET_SEEN.set(obj, seen);
  } else {
    seen.clear();
  }
  for (let i = 0; i < keys.length; i++) {
    seen.add(keys[i]);
  }
  // Subscribe the active source formula to this object's key-set revision.
  // `cell.value` auto-consumes only when a tracker frame is active.
  void keySetCellFor(obj).value;
}

/**
 * Called by the host on every keyed write to `obj` (the add-signal GXT cannot
 * derive itself for a plain object). Bumps `obj`'s key-set revision cell — and
 * thereby re-runs every each-in source that iterated `obj` — IFF:
 *
 *   - an each-in source has actually enumerated `obj` (a seen-set exists), and
 *   - `key` is one that source has NOT already observed (a genuine addition).
 *
 * A write to an object no each-in tracks, or a value-only change of an
 * already-observed key, is a no-op here. Idempotent: adding the same new key
 * twice bumps once.
 */
export function notifyObjectKeyAdded(obj: object, key: PropertyKey): void {
  const seen = KEY_SET_SEEN.get(obj);
  // Only objects an each-in source has iterated carry a seen-set. A value-only
  // change of an already-observed key needs no key-set bump — its own per-value
  // cell already propagates.
  if (seen === undefined || seen.has(key)) return;
  seen.add(key);
  const c = KEY_SET_CELLS.get(obj);
  if (c !== undefined) {
    c.update((c._value as number) + 1);
  }
}

/**
 * Test seam: whether an each-in source has recorded a key-set for `obj`.
 * Exposed for tests (mirrors `reactive-collections.shadowCellFor`); not part of
 * the host contract.
 */
export function hasObservedKeySet(obj: object): boolean {
  return KEY_SET_SEEN.has(obj);
}

/**
 * Test seam: `obj`'s key-set revision — the number of genuine key additions
 * {@link notifyObjectKeyAdded} has bumped for it (0 if never bumped / no cell).
 * Lets tests assert the invalidation contract directly, independent of how a
 * `MergedCell` memoizes (in a non-rendering harness it recomputes on every
 * read). Not part of the host contract.
 */
export function keySetRevisionFor(obj: object): number {
  const c = KEY_SET_CELLS.get(obj);
  return c === undefined ? 0 : (c._value as number);
}
