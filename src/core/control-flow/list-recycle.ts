/**
 * Opt-in row recycling — "sliding window of references"
 * (reference-swap variant; RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A2).
 *
 * Opt-in surface: `{{#each items key="@recycle" as |item|}}`. The compiler
 * (plugins/compiler/serializers/control.ts buildEach) detects the sentinel key
 * at COMPILE time and emits `$_eachRecycled` / `$_eachSyncRecycled` instead of
 * `$_each` / `$_eachSync`. That keeps this entire module TREE-SHAKABLE: apps
 * that never write key="@recycle" never import these entry points, so a
 * bundler drops the ~400 lines of recycle machinery from the shipped bundle.
 * Apps that do use it pay automatically — no manual setup.
 *
 * Activation channel: the entry points construct the regular list classes and
 * thread `syncRecycle` through `ListComponentArgs.recycle`; the list keeps
 * only a tiny nullable `recycleImpl` dispatch hook checked in `syncList`
 * (see list.ts). Per-list recycle STATE lives here, in a WeakMap keyed by the
 * list instance — list.ts carries zero recycle fields.
 *
 * NOTE: constructing a list class DIRECTLY with `key: '@recycle'` (without
 * these entry points) now treats '@recycle' as a property-name key — the
 * dev-mode "Key for item not found" guard surfaces the misuse. Template users
 * are unaffected: the compiler routes `key="@recycle"` here.
 *
 * Semantics (INTENTIONALLY different from keyed {{#each}}):
 *   - Rows are reused strictly by POSITION, never by key. Row DOM identity
 *     does NOT follow item identity (non-keyed in js-framework-benchmark
 *     terms). Focus/selection/input state, CSS transitions and third-party
 *     widget state inside a row BLEED across items on replace.
 *   - The block param the body renders against is NOT the raw item: it is a
 *     stable per-row STATE object whose property reads forward through a
 *     re-pointable holder `Cell<T>` to the currently-bound item. So `item`
 *     inside the body has a different object identity than the array element
 *     (`===` against raw items, or passing the block param to code that
 *     mutates/compares identities, will not behave like keyed mode).
 *   - A list replace becomes "swap N holder references"; push reactivity
 *     re-runs only the k bindings per row. All subscriptions, opcodes and
 *     DOM survive — no destroy/create.
 *   - Shrinking retires trailing rows into a pool (DOM detached into a
 *     per-row fragment; subscriptions stay LIVE — a shared-cell fan-out,
 *     e.g. `selected`, still re-runs pooled rows' formulas against detached
 *     DOM). Growth re-inserts pooled rows (re-bind + one fragment insert)
 *     before building new ones. The pool is capped (RECYCLE_POOL_LIMIT);
 *     overflow rows get real teardown so a one-off size spike doesn't pin
 *     memory and per-update CPU to the historical maximum forever.
 *
 * Reactivity routing: a body binding evaluating `state.prop` reads
 * (1) `holder.value` — entangling with the per-row holder cell (the
 * reference swap channel), and (2) `item.prop` through the raw item's own
 * accessor — so `cellFor(item, 'prop')`-backed items keep their fine-grained
 * push path (`item.label = x` still updates exactly that row's binding).
 *
 * Known limitations (acceptable for an opt-in mode, documented here so they
 * are decisions rather than surprises):
 *   - object items only (dev-mode warning otherwise);
 *   - inverse (else) teardown is synchronous even under AsyncListComponent —
 *     async element/modifier destructors on inverse content are not awaited;
 *   - dev-mode HMR swaps row components by walking `keyMap`, which recycling
 *     doesn't populate — hot-reloading a recycled row body needs a full reload;
 *   - rehydration falls back to the default keyed path (see entry points).
 */

import type { Component, ComponentReturnType } from '@/core/component-class';
import type { ComponentLike, DOMApi } from '@/core/types';
import { renderElement } from '@/core/render-core';
import {
  Cell,
  type MergedCell,
  // Recycle-mode reference swaps happen INSIDE the drain (the list-tag opcode
  // runs from syncDomSync), where a plain Cell.update() is dropped by the
  // drain's terminal tagsToRevalidate.clear(). applyCellUpdateSync is the
  // drain-safe path: direct mutate + synchronous subscriber flush.
  applyCellUpdateSync,
} from '@/core/reactive';
import { initDOM } from '@/core/context';
import { isRehydrationScheduled } from '@/core/ssr/rehydration';
import { setParentContext } from '@/core/tracking';
import { $_each, $_eachSync, $_fin } from '@/core/dom';
import {
  AsyncListComponent,
  SyncListComponent,
  type BasicListComponent,
  type InverseFn,
} from './list';

type GenericReturnType = Array<ComponentLike | Node> | ComponentLike | Node;

export const RECYCLE_KEY = '@recycle';

// Retired rows kept for reuse. Beyond this, shrink tears rows down for real:
// pooled rows keep live subscriptions (shared-cell changes re-execute their
// formulas against detached DOM), so an unbounded pool would tax every later
// update with the list's historical maximum size.
const RECYCLE_POOL_LIMIT = 256;

type RecycledRow<T> = {
  /** Stable per-row state object the body rendered against (the block param). */
  state: T;
  /** Re-pointable reference every `state.*` read routes through. */
  holder: Cell<T>;
  /** Props with forwarding accessors materialized on `state`. */
  props: Set<string>;
  /** Raw item currently bound (ref-compare fast path for no-op rebinds). */
  boundItem: T;
  /** Row top boundary; DOM extent = [marker, nextRowMarker | bottomMarker). */
  marker: Comment;
  /** Position-independent internal key (rowCtxMap / teardown bookkeeping). */
  key: string;
  /** Reactive index cell — only allocated when the body reads `{{index}}`. */
  indexCell: Cell<number> | null;
  /** Holds the row's detached DOM while pooled; reused across retire cycles. */
  fragment: DocumentFragment | null;
};

/**
 * Structural view of the list-instance members the recycle functions touch.
 * `rowBodyCtx`/`destroyRowCtx` are `protected` on BasicListComponent, so the
 * dispatch entry casts the instance to this interface; everything stays on
 * the existing list machinery (per-row destructor-owner ctxs, marker
 * registry, inverse rendering).
 */
interface RecycleHost<T> {
  api: DOMApi;
  bottomMarker: Comment;
  markerSet: Set<Comment>;
  hasIndex: boolean;
  inverseFn: InverseFn | null;
  inverseContent: GenericReturnType | null;
  ItemComponent(
    item: T,
    index: number | MergedCell,
    ctx: Component<any>,
  ): GenericReturnType;
  rowBodyCtx(key: string): ComponentLike;
  destroyRowCtx(key: string): void;
  destroyInverseSync(): void;
  renderInverse(): void;
}

/**
 * Per-list recycle state, lazily created on first dispatch. Keyed by the list
 * instance in a module-level WeakMap so the list class carries ZERO recycle
 * fields and the state is GC'd with the list.
 */
type RecycleState<T> = {
  active: Array<RecycledRow<T>>;
  pool: Array<RecycledRow<T>>;
  /** Monotonic per-list row-key sequence (`@r0`, `@r1`, ...). */
  seq: number;
  /** True while syncRecycle is applying items; see the guard in syncRecycle. */
  syncInProgress: boolean;
};

const RECYCLE_STATES: WeakMap<object, RecycleState<any>> = new WeakMap();

// ==========================================================================
// Row recycling — positional sync (see RECYCLE_KEY docs above).
// Installed as the list's `recycleImpl` dispatch hook; replaces the whole
// keyed diff:
//   - overlapping positions: swap each row's holder reference (re-bind);
//   - shrink: retire trailing rows into the pool (DOM detached, alive);
//   - growth: re-insert + re-bind pooled rows first, then build new rows.
// Fully synchronous — no destroy cascades in steady state. Real teardown
// (opcode unsubscription, rowCtx destruction) only happens when the LIST
// itself is destroyed, via the existing TREE cascade over rowCtxMap.
// ==========================================================================
export function syncRecycle<T extends { id: number }>(
  list: BasicListComponent<T>,
  items: T[],
): void {
  let state = RECYCLE_STATES.get(list) as RecycleState<T> | undefined;
  if (state === undefined) {
    state = { active: [], pool: [], seq: 0, syncInProgress: false };
    RECYCLE_STATES.set(list, state);
  }
  // Re-entry guard, shared by the Sync and Async subclasses: a holder flush
  // can run host code that synchronously mutates the source array, and a
  // nested syncRecycle would corrupt active/pool while the outer pass is
  // still iterating. The outer call already applies the current tag value;
  // nested calls are safe to drop.
  if (state.syncInProgress) return;
  state.syncInProgress = true;
  try {
    syncRecycleInner(list as unknown as RecycleHost<T>, state, items);
  } finally {
    state.syncInProgress = false;
  }
}

function syncRecycleInner<T>(
  host: RecycleHost<T>,
  state: RecycleState<T>,
  items: T[],
): void {
  const api = host.api;
  const { active, pool } = state;
  const { bottomMarker } = host;
  if (items.length > 0 && host.inverseContent !== null) {
    host.destroyInverseSync();
  }
  const prevCount = active.length;
  const nextCount = items.length;
  const shared = prevCount < nextCount ? prevCount : nextCount;
  // 1) Overlapping positions: the reference swap. Push reactivity re-runs
  //    the k bindings of each row whose holder actually changed.
  for (let i = 0; i < shared; i++) {
    rebindRecycledRow(active[i], items[i], i);
  }
  if (nextCount > prevCount) {
    // 2) Growth. ALL new/reused rows are appended IN ORDER into a single
    //    detached batch fragment (append-only — no per-row anchor scans),
    //    then moved into the live DOM with ONE insertBefore(bottomMarker).
    const batch = api.fragment();
    let index = prevCount;
    // 2a) Reuse pooled rows: one fragment re-insert + one reference swap.
    while (index < nextCount && pool.length > 0) {
      const rec = pool.pop()!;
      api.insert(batch, rec.fragment!);
      rebindRecycledRow(rec, items[index], index);
      active.push(rec);
      index++;
    }
    // 2b) Build brand-new rows for the remainder. `buildRecycledRow`
    // resolves the insert parent via `api.parent(targetNode)`, and a bare
    // DocumentFragment has NO parent — so (mirroring `getTargetNode(0)`)
    // give the batch a tail marker to act as the in-fragment anchor, and
    // drop it once the batch lands in the live DOM.
    if (index < nextCount) {
      const batchTail = IS_DEV_MODE
        ? api.comment('recycle batch tail')
        : api.comment();
      api.insert(batch, batchTail);
      const self = host as unknown as ComponentLike;
      setParentContext(self);
      for (; index < nextCount; index++) {
        active.push(buildRecycledRow(host, state, items[index], index, batchTail));
      }
      setParentContext(null);
      api.destroy(batchTail);
    }
    api.insert(api.parent(bottomMarker)!, batch, bottomMarker);
  } else if (nextCount < prevCount) {
    // 3) Shrink: retire trailing rows into the pool. Iterate forward so each
    //    row's end boundary (the NEXT row's marker) is still connected when
    //    we detach its extent.
    for (let i = nextCount; i < prevCount; i++) {
      const rec = active[i];
      const end: Node = i + 1 < prevCount ? active[i + 1].marker : bottomMarker;
      retireRecycledRow(host, rec, end);
      if (pool.length < RECYCLE_POOL_LIMIT) {
        pool.push(rec);
      } else {
        destroyRecycledRow(host, rec);
      }
    }
    active.length = nextCount;
  }
  if (nextCount === 0 && host.inverseFn) {
    host.renderInverse();
  }
}

/**
 * Real teardown for a retired row that exceeds the pool cap: unsubscribe its
 * binding opcodes (rowCtx cascade), unregister its boundary marker, and drop
 * the fragment so the detached DOM becomes collectable. Mirrors what list
 * destruction would eventually do for pooled rows, just eagerly.
 */
function destroyRecycledRow<T>(host: RecycleHost<T>, rec: RecycledRow<T>): void {
  host.destroyRowCtx(rec.key);
  host.markerSet.delete(rec.marker);
  const _unreg = (
    globalThis as { __gxtUnregisterListMarker?: (m: Comment) => void }
  ).__gxtUnregisterListMarker;
  if (_unreg) _unreg(rec.marker);
  rec.fragment = null;
}

/**
 * Re-point a recycled row at `item` (the actual "swap one reference" op).
 * No-ops when the row is already bound to the same object reference —
 * which also keeps same-ref correctness: any in-place item mutation routed
 * through `cellFor(item, prop)` stayed subscribed the whole time.
 */
function rebindRecycledRow<T>(rec: RecycledRow<T>, item: T, index: number): void {
  // applyCellUpdateSync (not Cell.update + manual flush): update() defers to
  // the host _cellUpdateDeferralHook when one is installed, which would
  // leave `_value` stale while we synchronously re-execute subscribers.
  if (rec.indexCell !== null) {
    applyCellUpdateSync(rec.indexCell, index);
  }
  if (rec.boundItem === item) {
    return;
  }
  rec.boundItem = item;
  // Heterogeneous item shapes: materialize forwarding accessors for any
  // prop this row hasn't seen yet. Homogeneous case = one Set.has per prop.
  defineRecycledStateProps(rec.state, rec.holder, item, rec.props);
  // The reference swap: every body binding that read `state.*` is
  // subscribed to `holder` and re-evaluates against the new item (also
  // re-entangling with the NEW item's own cellFor-backed accessors).
  applyCellUpdateSync(rec.holder, item);
}

/**
 * Define forwarding accessors on the row's state object for every own
 * enumerable prop of `item` not yet materialized. Reads route through the
 * holder cell (reference-swap subscription) AND the raw item's accessor
 * (fine-grained per-item cell push, e.g. `cellFor(item,'label')`). Writes
 * forward to the currently-bound item.
 *
 * Forwarded props are everything `for..in` reaches: own enumerable props
 * AND enumerable prototype accessors (legacy `@tracked` installs enumerable
 * prototype getters — filtering to own props would render tracked class
 * items blank). Non-enumerable prototype members (regular class methods/
 * getters) are not forwarded.
 *
 * Limitation (documented): props that exist on NO item bound so far have no
 * accessor, so a body read of them returns undefined without holder
 * entanglement. Items with a stable shape — the recycling use case — are
 * unaffected.
 */
function defineRecycledStateProps<T>(
  state: T,
  holder: Cell<T>,
  item: T,
  props: Set<string>,
): void {
  if (item === null || typeof item !== 'object') {
    // The state-object indirection forwards PROPERTY reads; a primitive item
    // has nothing to forward, so the body would render the empty state
    // object instead of the value. Recycling is documented as object-items
    // only — surface the misuse instead of rendering garbage.
    if (IS_DEV_MODE) {
      console.warn(
        `key="@recycle" requires object items; got ${item === null ? 'null' : typeof item} — the row body will not see this value`,
      );
    }
    return;
  }
  for (const prop in item) {
    if (props.has(prop)) continue;
    props.add(prop);
    Object.defineProperty(state, prop, {
      get() {
        return (holder.value as Record<string, unknown>)[prop];
      },
      set(v: unknown) {
        (holder.value as Record<string, unknown>)[prop] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
}

/**
 * Build a fresh recycled row at `index`, rendered against a stable state
 * object + holder cell instead of the raw item. Inserted before
 * `targetNode` (bottomMarker, or the batched fill fragment's marker).
 */
function buildRecycledRow<T>(
  host: RecycleHost<T>,
  state: RecycleState<T>,
  item: T,
  index: number,
  targetNode: Node,
): RecycledRow<T> {
  const api = host.api;
  const key = `@r${state.seq++}`;
  const marker = IS_DEV_MODE
    ? api.comment(`recycle row ${key}`)
    : api.comment();
  // Same contract as keyed per-item markers: track in markerSet (the list
  // destructor's unregister loop walks it) and tell the host registry the
  // comment is load-bearing — Ember's artifact stripper prunes unregistered
  // empty comments, which would orphan the row's retire boundary.
  host.markerSet.add(marker);
  const _reg = (
    globalThis as { __gxtRegisterListMarker?: (m: Comment) => void }
  ).__gxtRegisterListMarker;
  if (_reg) _reg(marker);
  const holder = new Cell<T>(
    item,
    IS_DEV_MODE ? `recycle-holder:${key}` : undefined,
  );
  const rowState = {} as T;
  const props = new Set<string>();
  defineRecycledStateProps(rowState, holder, item, props);
  let idx: number | Cell<number> = index;
  let indexCell: Cell<number> | null = null;
  if (host.hasIndex) {
    // Positional index — a plain Cell is enough (rows never reorder in
    // recycle mode; only pool reuse / rebind can change a row's position).
    indexCell = new Cell<number>(
      index,
      IS_DEV_MODE ? `recycle-index:${key}` : undefined,
    );
    idx = indexCell;
  }
  const parent = api.parent(targetNode)!;
  api.insert(parent, marker, targetNode);
  // Per-row destructor-owner ctx (TREE child of the list) — real teardown
  // of the row's binding opcodes happens via the list-destroy cascade.
  const bodyCtx = host.rowBodyCtx(key);
  const row = host.ItemComponent(
    rowState,
    idx as unknown as number | MergedCell,
    bodyCtx as unknown as Component<any>,
  );
  if (row !== undefined && row !== null) {
    renderElement(
      api,
      host as unknown as ComponentLike,
      parent,
      row,
      targetNode,
    );
  }
  return {
    state: rowState,
    holder,
    props,
    boundItem: item,
    marker,
    key,
    indexCell,
    fragment: null,
  };
}

/**
 * Retire a row: detach its DOM extent [marker, end) into the row's own
 * reusable fragment. NOTHING is destroyed — subscriptions, opcodes and DOM
 * survive for later re-insertion.
 */
function retireRecycledRow<T>(
  host: RecycleHost<T>,
  rec: RecycledRow<T>,
  end: Node,
): void {
  const api = host.api;
  const fragment = rec.fragment ?? (rec.fragment = api.fragment());
  let node: Node | null = rec.marker;
  let next: Node | null;
  while (node !== null && node !== end) {
    next = node.nextSibling;
    api.insert(fragment, node);
    node = next;
  }
}

// ==========================================================================
// Compiler entry points. buildEach emits these instead of $_each/$_eachSync
// when the each key is the '@recycle' sentinel. Signature mirrors
// $_each/$_eachSync 1:1 (the key slot is accepted but ignored — rows are
// positional) so the compiler's arg-slot layout is unchanged.
// ==========================================================================
function eachRecycled<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  ctx: Component<any>,
  inverseFn: InverseFn | undefined,
  hasIndex: boolean | undefined,
  sync: boolean,
) {
  // Rehydration bail: the recycle sync path builds rows from scratch and
  // knows nothing about adopting server-rendered DOM, so a rehydrating
  // render falls back to the default keyed path (@identity) — correct,
  // just without recycling for that initial pass.
  if (isRehydrationScheduled()) {
    if (IS_DEV_MODE) {
      console.warn(
        'key="@recycle" is not supported during rehydration; falling back to keyed rendering',
      );
    }
    return sync
      ? $_eachSync(items, fn, null, ctx, inverseFn, hasIndex)
      : $_each(items, fn, null, ctx, inverseFn, hasIndex);
  }
  const api = initDOM(ctx);
  // Mirrors dom.ts getRenderTargets minus the rehydration branch (handled
  // by the keyed fallback above).
  const placeholder = IS_DEV_MODE
    ? api.comment('recycled-each-placeholder')
    : api.comment('');
  const outlet = api.fragment();
  api.insert(outlet, placeholder);
  // `key: null` — rows are positional; `this.key` stays '@identity' so the
  // dev-mode key validation never misfires if a keyed path is reached.
  const args = {
    tag: items as Cell<T[]>,
    ItemComponent: fn,
    key: null,
    ctx,
    inverseFn,
    hasIndex,
    recycle: syncRecycle as (
      list: BasicListComponent<any>,
      items: any[],
    ) => void,
  };
  const instance = sync
    ? new SyncListComponent<T>(args, outlet, placeholder)
    : new AsyncListComponent<T>(args, outlet, placeholder);
  return $_fin(Array.from(outlet.childNodes), instance);
}

export function $_eachRecycled<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  _key: string | null = null,
  ctx: Component<any>,
  inverseFn?: InverseFn,
  hasIndex?: boolean,
) {
  return eachRecycled(items, fn, ctx, inverseFn, hasIndex, false);
}

export function $_eachSyncRecycled<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  _key: string | null = null,
  ctx: Component<any>,
  inverseFn?: InverseFn,
  hasIndex?: boolean,
) {
  return eachRecycled(items, fn, ctx, inverseFn, hasIndex, true);
}
