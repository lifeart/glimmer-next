/**
 * Reactive Map/Set support.
 *
 * Provides mutation tracking for native `Map` and `Set` instances so they
 * can be consumed inside reactive contexts (e.g. `{{#each-in this.map}}`).
 *
 * Strategy (Option C from the design doc):
 *
 *   - Maintain a process-wide `WeakMap<Map|Set, Cell<number>>` of shadow
 *     revision cells, lazily created on the first observed read.
 *   - Monkey-patch the read methods (`entries`, `values`, `keys`, `forEach`,
 *     `Symbol.iterator`, `get`, `has`, `size`) so that, when called inside a
 *     tracking frame, they consume the shadow cell. Outside of tracking
 *     frames the patched methods are transparent — `cell.value` only
 *     registers a consumer if `currentTracker` is non-null.
 *   - Monkey-patch the mutation methods (`set`, `delete`, `clear` on Map;
 *     `add`, `delete`, `clear` on Set) to bump the shadow cell after calling
 *     the original implementation. Bumping the cell dirties all formulas
 *     that previously consumed it, scheduling a re-render.
 *
 * The patch is idempotent and applied once per realm at module load via
 * `ensureReactiveCollectionsPatched()`. It preserves object identity
 * (`===`), iteration order, and all standard method semantics.
 *
 * NOTE: This touches the global `Map` / `Set` prototypes for the whole
 * process. That's intentional — consumers don't need an opt-in API, and
 * the overhead on non-reactive Maps is a single `WeakMap.get` miss per
 * mutation.
 */

import { Cell, cell, getTracker } from '@/core/reactive';

const SHADOW_CELLS: WeakMap<Map<unknown, unknown> | Set<unknown>, Cell<number>> =
  new WeakMap();

let _patched = false;

/**
 * Returns (creating if needed) the shadow revision cell for a Map/Set.
 * Exposed for tests; normal code does not need to call this directly.
 */
export function shadowCellFor(
  obj: Map<unknown, unknown> | Set<unknown>,
): Cell<number> {
  let c = SHADOW_CELLS.get(obj);
  if (c === undefined) {
    c = cell(
      0,
      IS_DEV_MODE
        ? `${obj instanceof Map ? 'Map' : 'Set'}.shadow`
        : undefined,
    ) as Cell<number>;
    SHADOW_CELLS.set(obj, c);
  }
  return c;
}

/**
 * Read the shadow cell's value so that the current tracking frame
 * registers a dependency. No-op outside a tracking frame.
 */
function consume(obj: Map<unknown, unknown> | Set<unknown>): void {
  if (getTracker() === null) return;
  // `cell.value` auto-consumes when a tracker is active.
  void shadowCellFor(obj).value;
}

/**
 * Bump the shadow cell (if any), marking the collection dirty and
 * scheduling a revalidation pass.
 */
function bump(obj: Map<unknown, unknown> | Set<unknown>): void {
  const c = SHADOW_CELLS.get(obj);
  if (c === undefined) return;
  c.update((c.value as number) + 1);
}

export function ensureReactiveCollectionsPatched(): void {
  if (_patched) return;
  _patched = true;

  // ---- Map mutations ----
  const origMapSet = Map.prototype.set;
  const origMapDelete = Map.prototype.delete;
  const origMapClear = Map.prototype.clear;

  Map.prototype.set = function reactiveMapSet(
    this: Map<unknown, unknown>,
    k: unknown,
    v: unknown,
  ) {
    const r = origMapSet.call(this, k, v);
    bump(this);
    return r;
  };
  Map.prototype.delete = function reactiveMapDelete(
    this: Map<unknown, unknown>,
    k: unknown,
  ) {
    const r = origMapDelete.call(this, k);
    if (r) bump(this);
    return r;
  };
  Map.prototype.clear = function reactiveMapClear(
    this: Map<unknown, unknown>,
  ) {
    const hadSize = this.size > 0;
    origMapClear.call(this);
    if (hadSize) bump(this);
  };

  // ---- Map reads ----
  //
  // IMPORTANT: we only instrument *iteration* APIs (`entries`, `keys`,
  // `values`, `Symbol.iterator`). We intentionally do NOT instrument
  // `get` / `has` / `size` / `forEach`, because the reactive runtime
  // itself uses Maps/Sets internally (`opsForTag`, `relatedTags`,
  // per-tracker `Set<Cell>`, keyMap/indexMap in list rendering, …) and
  // performs hot-path `get`/`has`/`size` reads inside tracking frames.
  // Auto-consuming those would pollute caller trackers with shadow
  // cells for the VM's own bookkeeping, producing spurious invalidations.
  //
  // Iteration APIs are rarely called on internal VM Maps inside tracking
  // frames, and they are exactly what `gxtEntriesOf` uses via
  // `Array.from(map.entries())` to drive `{{#each-in}}`.
  const origMapEntries = Map.prototype.entries;
  const origMapKeys = Map.prototype.keys;
  const origMapValues = Map.prototype.values;
  const origMapIter = Map.prototype[Symbol.iterator];

  Map.prototype.entries = function reactiveMapEntries(
    this: Map<unknown, unknown>,
  ) {
    consume(this);
    return origMapEntries.call(this);
  };
  Map.prototype.keys = function reactiveMapKeys(
    this: Map<unknown, unknown>,
  ) {
    consume(this);
    return origMapKeys.call(this);
  };
  Map.prototype.values = function reactiveMapValues(
    this: Map<unknown, unknown>,
  ) {
    consume(this);
    return origMapValues.call(this);
  };
  Map.prototype[Symbol.iterator] = function reactiveMapSymbolIterator(
    this: Map<unknown, unknown>,
  ) {
    consume(this);
    return origMapIter.call(this);
  };

  // ---- Set: capture originals up-front (before any reassignment) ----
  //
  // Same rationale as Map: only instrument iteration APIs, not
  // membership / size / forEach / element access.
  const origSetAdd = Set.prototype.add;
  const origSetDelete = Set.prototype.delete;
  const origSetClear = Set.prototype.clear;
  const origSetEntries = Set.prototype.entries;
  const origSetKeys = Set.prototype.keys;
  const origSetValues = Set.prototype.values;
  const origSetHas = Set.prototype.has;
  const origSetIter = Set.prototype[Symbol.iterator];

  Set.prototype.add = function reactiveSetAdd(
    this: Set<unknown>,
    v: unknown,
  ) {
    const hadBefore = origSetHas.call(this, v);
    const r = origSetAdd.call(this, v);
    if (!hadBefore) bump(this);
    return r;
  };
  Set.prototype.delete = function reactiveSetDelete(
    this: Set<unknown>,
    v: unknown,
  ) {
    const r = origSetDelete.call(this, v);
    if (r) bump(this);
    return r;
  };
  Set.prototype.clear = function reactiveSetClear(this: Set<unknown>) {
    const hadSize = this.size > 0;
    origSetClear.call(this);
    if (hadSize) bump(this);
  };

  // ---- Set reads ----
  Set.prototype.entries = function reactiveSetEntries(
    this: Set<unknown>,
  ) {
    consume(this);
    return origSetEntries.call(this);
  };
  Set.prototype.keys = function reactiveSetKeys(this: Set<unknown>) {
    consume(this);
    return origSetKeys.call(this);
  };
  Set.prototype.values = function reactiveSetValues(this: Set<unknown>) {
    consume(this);
    return origSetValues.call(this);
  };
  Set.prototype[Symbol.iterator] = function reactiveSetSymbolIterator(
    this: Set<unknown>,
  ) {
    consume(this);
    return origSetIter.call(this);
  };
}

// Apply the patch at module load. Idempotent.
ensureReactiveCollectionsPatched();
