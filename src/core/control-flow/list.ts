/**
 * List Control Flow - Level 5
 *
 * Sync and Async list components for rendering arrays.
 */

// Import types from component-class to avoid circular dependency
import type { Component } from '@/core/component-class';
import type { ComponentLike, DOMApi } from '@/core/types';

// Import render/destroy functions directly (no late-binding needed)
import { renderElement, getFirstNode } from '@/core/render-core';
import { destroyElementSync, destroyElement } from '@/core/destroy';

import {
  Cell,
  MergedCell,
  formula,
  deepFnValue,
  registerLeafOwnersForFormula,
} from '@/core/reactive';
import { opcodeFor } from '@/core/vm';
import {
  $_debug_args,
  IN_SSR_ENV,
  isArray,
  isFn,
  isPrimitive,
  isTagLike,
  LISTS_FOR_HMR,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  isEmpty,
} from '@/core/shared';
import { RENDERING_CONTEXT_PROPERTY } from '@/core/types';
import { TREE, CHILD, PARENT, cId, addToTree } from '@/core/tree';
import { isRehydrationScheduled } from '@/core/ssr/rehydration';
import { initDOM } from '@/core/context';
import {
  registerDestructor,
  isDestructionStarted,
} from '../glimmer/destroyable';
import { setParentContext, getParentContext } from '../tracking';

// Re-export getFirstNode for backward compatibility
export { getFirstNode };

// Fine-grained mode gate (host-set). When ON, syncList re-binds a reused row's
// block-param to a new source object via the host `__gxtRebindEachItem` hook
// (group-E). OFF (shipping) → none of this runs → byte-identical.
function _fineGrainedEachRebind(): boolean {
  return (globalThis as any).__GXT_SPIKE_SKIP_MORPH === true;
}

/*
  List manager for rendering and syncing arrays of items.
  Uses per-item comment markers for stable DOM boundaries,
  LIS-based move minimization, and DocumentFragment batching.

  Based on Glimmer-VM list update logic.
*/
type GenericReturnType = Array<ComponentLike | Node> | ComponentLike | Node;

// Lightweight per-row destructor-owner context. It is a valid render context
// (carries the list's DOM api + a tree id) but renders NO DOM of its own — the
// row's actual DOM (the `<tr>` etc.) is tracked + removed by the list's existing
// keyMap/marker machinery. Its sole job is to OWN the row body's element
// binding-opcode destructors (and any nested control-flow children) so they
// tear down per-row instead of leaking onto the surviving list instance.
type RowContext = {
  [COMPONENT_ID_PROPERTY]: number;
  [RENDERED_NODES_PROPERTY]: Array<Node>;
  [RENDERING_CONTEXT_PROPERTY]: DOMApi;
  [key: symbol]: unknown;
};

export type InverseFn = (ctx: Component<any>) => GenericReturnType | null;

type ListComponentArgs<T> = {
  tag: Cell<T[]> | MergedCell;
  key: string | null;
  ctx: Component<any>;
  ItemComponent: (item: T, index?: number | MergedCell) => GenericReturnType;
  inverseFn?: InverseFn;
  // Set by the compiler when the each-block body actually reads `index`
  // (`{{index}}` becomes `index.value`). When false (the common case in
  // Krausest-style large lists) we skip allocating a per-row reactive
  // index formula and pass the raw number instead — this saves one
  // MergedCell + closure capture per item on every render.
  hasIndex?: boolean;
};
type RenderTarget = HTMLElement | DocumentFragment;

// Reusable arrays for LIS algorithm — avoids allocations on each update
const _lisTails: number[] = [];
const _lisTailIdx: number[] = [];
const _lisPred: number[] = [];

/**
 * Normalize an arbitrary `{{#each}}` input value into a real Array<T>.
 *
 * Glimmer-VM's `{{#each}}` semantics treat any non-array, non-iterable
 * value as falsy (renders the inverse). For iterables that aren't plain
 * arrays (Set, Map, custom Symbol.iterator classes, generators), the body
 * iterates with the spread elements. Ember's ArrayProxy is normalized via
 * its `.content` slot.
 *
 * Returns:
 *   - The same array if `Array.isArray(value)` (covers plain arrays and
 *     Ember `A()` / NativeArray, which IS-A Array).
 *   - `[...value]` if `value[Symbol.iterator]` is callable.
 *   - Recursive normalization on `value.content` for ArrayProxy-shaped
 *     objects (defensive: falls back to `[]` if access throws or the proxy
 *     is destroyed).
 *   - `[]` for everything else (null, undefined, false, '', 0, NaN, true,
 *     non-iterable strings, plain objects, functions, numbers).
 *
 * Strings are intentionally treated as `[]` — Glimmer's `{{#each}}` does
 * NOT iterate string characters, and the upstream tests require `'hello'`
 * to render the inverse block.
 */
// Registered Symbol matching `@ember/reactive` (gxt-backend validator.ts
// `GXT_COLLECTION_TAG`). A reactive-collection proxy (trackedArray / trackedSet)
// returns its internal native-GXT-cell-backed `collection` tag when read with
// this key. `Symbol.for` shares one identity across the ember-source bundle and
// this glimmer-next bundle without a cross-package import.
const GXT_COLLECTION_TAG = Symbol.for('@ember/reactive:gxt-collection-tag');

// If `value` is a reactive-collection proxy, read its collection cell so the
// CURRENTLY-EVALUATING formula subscribes to structural mutation. Reading the
// inner native cell's `.value` performs the `tracker.add(cell)` entanglement.
// Cheap (O(1)) and a no-op for plain arrays / ArrayProxy / non-proxy values.
function subscribeReactiveCollection(value: unknown): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return;
  }
  try {
    const tag = (value as Record<symbol, unknown>)[GXT_COLLECTION_TAG] as
      | { _innerCell?: { value: unknown } }
      | undefined;
    if (tag && tag._innerCell) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      tag._innerCell.value;
    }
  } catch {
    /* best-effort subscription */
  }
}

export function normalizeIterableValue<T>(value: unknown): T[] {
  // Fast paths: empty or already-an-array
  if (
    value === null ||
    value === undefined ||
    value === false ||
    value === '' ||
    value === 0
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    // FIX 3b: an `@ember/reactive` collection proxy (trackedArray) reports as
    // an Array (its getPrototypeOf returns Array.prototype). Returning it
    // unchanged means updateItems' per-element `items[index]` reads — run
    // ×passes ×N — hit the proxy `get` trap (readStorageFor + consumeTag per
    // index), ballooning the backing `storages` map and dominating large-list
    // syncs. The list-tag formula has ALREADY established the structural
    // subscription by reading `_innerCell.value` (see compile site +
    // subscribeReactiveCollection), so we can safely SNAPSHOT the proxy to a
    // plain array. `.slice()` hits the proxy's ARRAY_GETTER_METHODS branch —
    // ONE consumeTag + a native target.slice() — yielding a trap-free array
    // (vs Array.from which iterates index-by-index through N traps).
    if (
      (value as unknown as Record<symbol, unknown>)[GXT_COLLECTION_TAG] !==
      undefined
    ) {
      return (value as T[]).slice();
    }
    return value as T[];
  }
  // Strings have Symbol.iterator but Glimmer's #each treats them as falsy
  if (typeof value !== 'object' && typeof value !== 'function') {
    // primitives we haven't already filtered: true, non-zero numbers, bigints, symbols
    return [];
  }
  // ArrayProxy-shaped objects: defer to .content (covers Ember.ArrayProxy)
  // We check this BEFORE Symbol.iterator — ArrayProxy itself is iterable
  // via .content, but the safer/cheaper path is to read .content directly,
  // which avoids walking through the proxy's iterator-trap layer.
  if (
    typeof value === 'object' &&
    value !== null &&
    'content' in (value as object)
  ) {
    const proxy = value as {
      content?: unknown;
      isDestroyed?: boolean;
      isDestroying?: boolean;
    };
    if (proxy.isDestroyed || proxy.isDestroying) {
      return [];
    }
    try {
      const content = proxy.content;
      if (content === value) {
        // self-referential — fall through to iterator handling below
      } else if (content !== undefined) {
        return normalizeIterableValue<T>(content);
      }
    } catch {
      return [];
    }
  }
  // Generic iterable (Set, Map, custom Symbol.iterator class, generators)
  if (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      'function'
  ) {
    try {
      return Array.from(value as Iterable<T>);
    } catch {
      return [];
    }
  }
  // ForEach-based delegates (Ember test ForEachable, custom collection
  // wrappers without Symbol.iterator). Glimmer-VM iterates these via the
  // `forEach` callback to produce an array of items. Also require a
  // `length` property so we don't accidentally drain a non-collection
  // object that happens to expose a `forEach` method (e.g. NodeList-like
  // shapes are fine; arbitrary objects with an unrelated `forEach` would
  // be unusual but length-gating keeps us closer to a "collection" shape).
  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { forEach?: unknown }).forEach === 'function' &&
    typeof (value as { length?: unknown }).length === 'number'
  ) {
    try {
      const out: T[] = [];
      (value as { forEach: (cb: (item: T) => void) => void }).forEach(
        (item) => {
          out.push(item);
        },
      );
      return out;
    } catch {
      return [];
    }
  }
  // Plain objects, functions, anything else — falsy
  return [];
}

/**
 * Compute positions in `arr` that form the Longest Increasing Subsequence.
 * Items at these positions are already in correct relative order and don't
 * need to be relocated.  O(n log n) time, O(n) space (reused).
 */
export function longestIncreasingSubsequence(
  arr: number[],
  out?: Set<number>,
): Set<number> {
  const n = arr.length;
  const result = out ?? new Set<number>();
  if (out) out.clear();
  if (n === 0) return result;

  const tails = _lisTails;
  const tailIdx = _lisTailIdx;
  const pred = _lisPred;
  tails.length = 0;
  tailIdx.length = 0;
  pred.length = n;

  for (let i = 0; i < n; i++) {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < arr[i]) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = arr[i];
    tailIdx[lo] = i;
    pred[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }

  // Reconstruct: walk predecessors back from the last element of the LIS
  let k = tailIdx[tails.length - 1];
  for (let i = tails.length - 1; i >= 0; i--) {
    result.add(k);
    k = pred[k];
  }
  return result;
}

export class BasicListComponent<T extends { id: number }> {
  keyMap: Map<string, GenericReturnType> = new Map();
  indexMap: Map<string, number> = new Map();
  // Track reactive index formulas for cleanup (dev mode only, lazily initialized)
  indexFormulaMap: Map<string, MergedCell> | null = null;
  // Fine-grained mode (gated): the RAW source object currently bound to each
  // key's row body. On a keyed REUSE where the source object changed by ref
  // (group-E: in-place mutation of the keyed property stales the key, then a
  // ref-swap reuses by the stale key), we notify the host so the row's
  // block-param re-binds to the new object WITHOUT recreating the row. Only
  // populated when `__GXT_SPIKE_SKIP_MORPH` is on. Lazily allocated.
  boundItemMap: Map<string, T> | null = null;
  // Per-row destructor-owner context.
  //
  // The compiled each-body (`ItemComponent`) registers its per-element binding
  // opcodes (e.g. `class={{if (isSelected row)}}`, attr/text bindings, `{{on}}`
  // events, modifiers) against the ctx passed as the body's 3rd arg via
  // `registerDestructorBatch(ctx, destructors)` in `_DOM`. Historically that ctx
  // was the LIST instance (`self`), which SURVIVES a `data.length=0` clear (the
  // `{{#each}}` stays mounted) — so on clear those opcodes were NEVER torn down
  // and their formulas stayed subscribed to shared cells (`selected`, …) forever.
  // Each later mutation then re-ran every leaked + live formula (cumulative).
  //
  // Fix: hand each row a dedicated per-row destroyable ctx (a child of this list
  // in the TREE) as the body's 3rd arg. On row destroy (`fastCleanup` /
  // `destroyItem`) we `destroyElementSync(rowCtx, skipDom=true)` so the row's
  // binding opcodes UNSUBSCRIBE. Keyed by item key, parallel to `keyMap`. Only
  // allocated in fine-grained mode (`__GXT_SPIKE_SKIP_MORPH`); shipping morph-ON
  // keeps passing `self` (byte-identical, the whole-template morph owns updates).
  rowCtxMap: Map<string, RowContext> | null = null;
  // Track per-item markers for stable relocation boundaries
  itemMarkers: Map<string, Comment> = new Map();
  markerSet: Set<Comment> = new Set();
  // P7: per-update cache of the install-once-stable `__gxtRegisterListMarker`
  // host hook (resolved at the top of updateItems). undefined when no hook
  // installed (shipping default → no-op).
  private _registerMarkerHook: ((m: Comment) => void) | undefined = undefined;
  // Reusable arrays/sets — cleared per update to avoid GC pressure
  private _existKeys: string[] = [];
  private _existNewIdx: number[] = [];
  private _existOldIdx: number[] = [];
  private _itemKeys: string[] = []; // cached keys for current update
  private _lisResult: Set<number> = new Set();
  private _updatingKeys: Set<string> = new Set();
  private _moveSet: Set<string> = new Set();
  private _freshMoveKeys: Set<string> = new Set();
  // Reused dedupe set for the right-to-left move phase — only populated
  // when the items array contains duplicate keys. Cleared per call.
  private _processedKeys: Set<string> = new Set();
  protected _keysToRemove: string[] = [];
  protected _rowsToRemove: GenericReturnType[] = [];
  // FIX 3a: set by syncList when the incoming items are a strict
  // append-only superset of the current rows (existing prefix unchanged +
  // in order) AND nothing was removed. updateItems reads this to take the
  // O(added) incremental-append path (skip existing-key bookkeeping + LIS +
  // full move scan). Reset to false at the start of every syncList.
  protected _appendOnlyVerdict = false;
  [RENDERED_NODES_PROPERTY]: Array<Node> = [];
  [COMPONENT_ID_PROPERTY] = cId();
  ItemComponent: (
    item: T,
    index: number | MergedCell,
    ctx: Component<any>,
  ) => GenericReturnType;
  inverseFn: InverseFn | null = null;
  inverseContent: GenericReturnType | null = null;
  bottomMarker!: Comment;
  topMarker!: Comment;
  key: string = '@identity';
  tag!: Cell<T[]> | MergedCell;
  isFirstRender = true;
  get ctx() {
    return this;
  }
  protected keysForItems(
    items: T[],
    keyForItem: (item: T, index: number, items: T[]) => string,
  ): Set<string> {
    const set = this._updatingKeys;
    set.clear();
    for (let i = 0; i < items.length; i++) {
      set.add(keyForItem(items[i], i, items));
    }
    return set;
  }
  /**
   * Detach this list's child-id set before bulk destruction.
   *
   * This lets child destructors skip parent-sibling bookkeeping and avoids
   * allocating a replacement empty Set on every fast cleanup.
   */
  protected detachTreeChildren(): void {
    CHILD.delete(this[COMPONENT_ID_PROPERTY]);
  }
  /**
   * Resolve the ctx that the row body (`ItemComponent`) should register its
   * per-element binding-opcode destructors against.
   *
   * Fine-grained (morph-OFF): allocate a per-row {@link RowContext} that is a
   * child of this list in the TREE and store it by key, so a clear/remove
   * unsubscribes the row's `class`/attr/text/event/modifier opcodes. Morph-ON
   * (shipping): return `self` unchanged (byte-identical legacy behaviour).
   *
   * IMPORTANT: this does NOT touch `setParentContext`. The leak is confined to
   * the row body's DIRECT element binding opcodes (which `_DOM` registers
   * against the ctx ARG, i.e. this returned rowCtx) — for a "stable" each-body
   * (single element, no `$_ucw` wrapper; the Krausest `<tr>` case). When the
   * body is `$_ucw`-wrapped (text / multi-child / nested-control rows), the UCW
   * is ITSELF a per-row destroyable already tracked in `keyMap` and torn down by
   * the existing `destroyElementSync(keyMapRow)` path, so there is no leak to
   * fix there — and the UCW must keep attaching to its lexical parent (the list
   * `self`, via the unchanged ambient `getParentContext()`). Re-parenting the
   * UCW under rowCtx regressed `toggling {{#each}}` / `{{#each-in}}` inverse
   * (else-branch) rendering, so we leave the parent-context chain untouched and
   * let rowCtx own ONLY the opcodes `_DOM` registers directly against it.
   */
  protected rowBodyCtx(key: string, self: ComponentLike): ComponentLike {
    if (!_fineGrainedEachRebind()) {
      return self;
    }
    const rowCtx: RowContext = {
      [COMPONENT_ID_PROPERTY]: cId(),
      [RENDERED_NODES_PROPERTY]: [],
      [RENDERING_CONTEXT_PROPERTY]: this.api,
      // Mark as a glimmer-next-native block wrapper so host consumers (e.g.
      // ember.js' gxt-backend `$_tag` / `$_GET_ARGS` path) DON'T re-stamp our
      // COMPONENT_ID with the shared gxt-root id. Without this, the row body
      // (rendered with rowCtx as its ctx) re-stamps rowCtx's id to the root id
      // → rowCtx's CHILD bucket collapses into the root's, so destroying the
      // row cascades through the ENTIRE root subtree (incl. the list itself).
      // Symbol.for keeps the contract identical to dom.ts's $BLOCK_WRAPPER_SYMBOL
      // across the package boundary (no import → no cycle).
      [Symbol.for('gxt-block-wrapper')]: true,
    };
    // @ts-expect-error rowCtx is a minimal ComponentLike for tree bookkeeping
    addToTree(this, rowCtx, 'from list rowBodyCtx');
    if (this.rowCtxMap === null) this.rowCtxMap = new Map();
    this.rowCtxMap.set(key, rowCtx);
    return rowCtx as unknown as ComponentLike;
  }
  /**
   * Tear down the per-row destructor-owner ctx for `key` (if any), firing the
   * row body's element binding opcodes AND cascading to its TREE children.
   *
   * `skipDom=false`: when the row body is `$_ucw`-wrapped (text / multi-child /
   * nested-control rows), the UCW component is `addToTree`'d UNDER rowCtx (see
   * `_component`'s `addToTree(ctx, instance)` with ctx = our rowCtx). So the
   * UCW (and its yielded/rendered DOM) is a tree child of rowCtx and MUST be
   * removed by this cascade — `skipDom=true` would mark it destroyed without
   * removing its DOM, and the caller's separate `destroyElementSync(row)` then
   * no-ops (the row IS that already-destroyed UCW), leaking the DOM (the
   * `{{#each}}{{yield}}` accumulation bug). For a stable `<tr>` body rowCtx has
   * no tree children + empty RENDERED_NODES, so this only fires its opcodes and
   * the raw `<tr>` node is removed by the caller's row path. Idempotent.
   */
  protected destroyRowCtx(key: string): void {
    const map = this.rowCtxMap;
    if (map === null) return;
    const rowCtx = map.get(key);
    if (rowCtx === undefined) return;
    map.delete(key);
    const rowId = rowCtx[COMPONENT_ID_PROPERTY];
    destroyElementSync(rowCtx as unknown as ComponentLike, false, this.api);
    // Detach the (now-destroyed) row ctx from the tree maps.
    CHILD.delete(rowId);
    TREE.delete(rowId);
    PARENT.delete(rowId);
    const childSet = CHILD.get(this[COMPONENT_ID_PROPERTY]);
    if (childSet !== undefined) childSet.delete(rowId);
  }
  /**
   * Tear down EVERY tracked per-row ctx (used by the bulk clear paths). Runs
   * each row's element binding opcodes synchronously (skipDom — the row DOM is
   * removed by the bulk `clearChildren`) and detaches all row ctxs from the
   * tree, then clears the map. No-op when not tracking per-row ctxs.
   */
  protected teardownAllRowCtxs(): void {
    const rowCtxMap = this.rowCtxMap;
    if (rowCtxMap === null || rowCtxMap.size === 0) return;
    const listId = this[COMPONENT_ID_PROPERTY];
    const childSet = CHILD.get(listId);
    for (const rowCtx of rowCtxMap.values()) {
      const rowId = rowCtx[COMPONENT_ID_PROPERTY];
      destroyElementSync(rowCtx as unknown as ComponentLike, true, this.api);
      CHILD.delete(rowId);
      TREE.delete(rowId);
      PARENT.delete(rowId);
      if (childSet !== undefined) childSet.delete(rowId);
    }
    rowCtxMap.clear();
  }
  /**
   * Fast-path for updates that preserve all existing items and only append
   * new ones at the end.
   *
   * We can safely skip the removal scan only when every old position still
   * points to the same key in the incoming list prefix.
   */
  protected isAppendOnlySuperset(
    items: T[],
    amountOfKeys: number,
    keyForItem: (item: T, index: number, items: T[]) => string,
  ): boolean {
    if (items.length < amountOfKeys) return false;
    const { indexMap } = this;
    for (let index = 0; index < amountOfKeys; index++) {
      const key = keyForItem(items[index], index, items);
      if (indexMap.get(key) !== index) {
        return false;
      }
    }
    return true;
  }
  // Cached fragment reused across relocateItem calls to avoid allocating new ones
  private _relocateFragment!: DocumentFragment;
  declare api: DOMApi;
  hasIndex = false;
  constructor(
    { tag, ctx, key, ItemComponent, inverseFn, hasIndex }: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    this.api = initDOM(ctx);
    if (inverseFn) {
      this.inverseFn = inverseFn;
    }
    if (hasIndex) {
      this.hasIndex = true;
    }
    this._relocateFragment = this.api.fragment();
    this.ItemComponent = ItemComponent;
    // Propagate $_eval from parent context for deferred rendering
    if (WITH_DYNAMIC_EVAL) {
      // @ts-expect-error $_eval may exist on ctx
      if (ctx?.$_eval) {
        // @ts-expect-error $_eval may exist
        this.$_eval = ctx.$_eval;
      }
    }
    // Prefer the current parent context (set by $_ucw / block wrappers)
    // over the lexical `ctx` passed by the compiler. For nested lists
    // inside an {{#each}} body, the compiled code emits the outer
    // component `this` as ctx, but the *actual* parent in the render
    // tree is the UnstableChildWrapper created per-iteration. Linking
    // the list to that wrapper (rather than the top-level component)
    // ensures the list is destroyed when its enclosing iteration is
    // torn down, so its opcode on the source cell is unregistered.
    const parentCtx = (getParentContext() as Component<any> | null) || ctx;
    // @ts-expect-error typings error
    addToTree(parentCtx, this, 'from list constructor');
    this[RENDERED_NODES_PROPERTY] = [];
    if (key) {
      this.key = key;
    }
    this.setupKeyForItem();
    // Register destructor to clean up the list's own TREE/PARENT/CHILD entries.
    // Attach to `this` so it fires when this list instance is destroyed as
    // part of its parent's child teardown (see parentCtx handling above).
    const listId = this[COMPONENT_ID_PROPERTY];
    registerDestructor(this, () => {
      CHILD.delete(listId);
      TREE.delete(listId);
      PARENT.delete(listId);
      // Unregister all per-item markers from the consumer-provided registry
      // (if any). The registry lets host environments (e.g. ember.js's
      // gxt-backend artifact stripper) skip our list-marker comments when
      // pruning empty comments from rendered output. See registration sites
      // in the constructor and updateItems.
      const _unreg = (
        globalThis as {
          __gxtUnregisterListMarker?: (m: Comment) => void;
        }
      ).__gxtUnregisterListMarker;
      if (_unreg) {
        for (const marker of this.markerSet) {
          _unreg(marker);
        }
        if (this.topMarker) _unreg(this.topMarker);
        if (this.bottomMarker) _unreg(this.bottomMarker);
      }
      this.itemMarkers.clear();
      this.markerSet.clear();
    });
    if (IS_DEV_MODE) {
      Object.defineProperty(this, $_debug_args, {
        get() {
          return {
            list: this.tag,
            key: this.key,
          };
        },
      });
      LISTS_FOR_HMR.add(this);
      registerDestructor(this, () => {
        LISTS_FOR_HMR.delete(this);
      });
    }
    // "list bottom marker"
    if (IS_DEV_MODE) {
      this.bottomMarker = this.api.comment('list bottom marker');
    } else {
      this.bottomMarker = this.api.comment();
    }
    this.topMarker = topMarker;
    if (IS_DEV_MODE) {
      // HMR / inspector bounds: topMarker..bottomMarker defines the full list extent
      this[RENDERED_NODES_PROPERTY] = [topMarker, this.bottomMarker];
    }

    this.api.insert(outlet, this.topMarker);
    this.api.insert(outlet, this.bottomMarker);

    // Notify any consumer-provided registry that these markers belong to a
    // list and must NOT be stripped by external "remove empty comments"
    // passes (e.g. ember.js's removeGxtArtifacts). The hook is a no-op when
    // no consumer has installed it.
    {
      const _reg = (
        globalThis as { __gxtRegisterListMarker?: (m: Comment) => void }
      ).__gxtRegisterListMarker;
      if (_reg) {
        _reg(this.topMarker);
        _reg(this.bottomMarker);
      }
    }

    const originalTag = tag;

    if (!isTagLike(tag)) {
      if (isArray(tag)) {
        console.warn('iterator for @each should be a cell');
        tag = new Cell(tag, 'list tag');
      } else if (isFn(originalTag)) {
        tag = formula(() => {
          const v = deepFnValue(originalTag);
          // Fine-grained reactive-collection subscription: if the each source
          // resolves to an `@ember/reactive` collection proxy (trackedArray /
          // trackedSet), read its internal collection cell so THIS list-tag
          // formula entangles with it. An in-place push/splice/swap/length=0
          // dirties that native GXT cell → this formula invalidates → the list
          // opcode re-runs `syncList` → keyed LIS diff (move/insert/remove by
          // key). Without this read the source `() => this.foo` returns a stable
          // proxy reference → the formula is const → the each freezes on
          // in-place mutation (it relied on the now-deleted morph full-rebuild).
          subscribeReactiveCollection(v);
          return v;
        }, 'list tag');
        registerDestructor(ctx, () => {
          (tag as MergedCell).destroy();
        });
      } else {
        // Non-tag, non-array, non-fn: normalize to an array (covers
        // Set/Map/iterables/ArrayProxy/falsy-objects passed directly).
        const normalized = normalizeIterableValue<T>(tag);
        tag = new Cell(normalized, 'list tag');
      }
    }
    this.tag = tag;
    // Fine-grained (morph-OFF) only: when the each source is a dynamic
    // expression (a MergedCell formula) whose deps include a LEAF object read
    // off the render context (e.g. `{{#each-in (get this.hashes this.hashes.type)}}`
    // — the source reads `this.hashes` then `.type` on the raw held object,
    // which taps no cell), register each tracked cell's held object as a
    // value-owner of its (ownerObj, ownerKey) with the Ember host. Then a
    // nested `set(this.hashes, 'type', ...)` reaches the source formula through
    // SyncCore's reverse lookup → the list re-iterates. The morph-ON path
    // re-renders the whole template and is unaffected (the host hook is
    // installed only in fine-grained mode → no-op when flag is off).
    if (
      (globalThis as any).__GXT_SPIKE_SKIP_MORPH &&
      this.tag instanceof MergedCell
    ) {
      // Force the formula to compute once so relatedCells is populated.
      (this.tag as MergedCell).value;
      registerLeafOwnersForFormula(this.tag as MergedCell);
    }
  }
  private relocateItem(marker: Comment, anchor: Node, parent: Node) {
    // Defensive: anchor is the same marker we're about to move. This can
    // happen under duplicate-key lists where the same DOM subtree is the
    // anchor for itself. Moving would attempt to re-insert the marker
    // before itself AFTER extracting it, which throws NotFoundError.
    if (marker === anchor) return;
    const { markerSet, bottomMarker, _relocateFragment: fragment } = this;
    // Find end boundary: next item marker or bottomMarker
    let end: Node = bottomMarker;
    let node: Node | null = marker.nextSibling;
    while (node && node !== bottomMarker) {
      if (node.nodeType === 8 && markerSet.has(node as Comment)) {
        end = node;
        break;
      }
      node = node.nextSibling;
    }
    // Item already immediately precedes the anchor — nothing to move
    if (end === anchor) return;
    // Collect marker + content into reusable fragment
    node = marker;
    let next: Node | null;
    while (node && node !== end) {
      next = node.nextSibling;
      this.api.insert(fragment, node);
      node = next;
    }
    this.api.insert(parent, fragment, anchor);
  }
  protected removeMarker(key: string) {
    const marker = this.itemMarkers.get(key);
    if (!marker) return;
    this.itemMarkers.delete(key);
    this.markerSet.delete(marker);
    // Unregister from the consumer-provided registry (if any) so the WeakSet
    // entry can be released and the marker can be GC'd promptly.
    const _unreg = (
      globalThis as { __gxtUnregisterListMarker?: (m: Comment) => void }
    ).__gxtUnregisterListMarker;
    if (_unreg) _unreg(marker);
    if (marker.isConnected) {
      this.api.destroy(marker);
    }
  }
  /**
   * Per-`items[]` first-occurrence cache for duplicate-key qualification.
   *
   * Both `@identity` and explicit-key paths have to detect when a base key
   * (object identity, or the value of `item[this.key]`) has already been
   * seen at an earlier index in the *current* items array, so subsequent
   * occurrences can be position-qualified (`baseKey:i`) and treated as
   * distinct rows by the diff algorithm.
   *
   * Two-phase strategy to avoid per-syncList Map allocation in the
   * overwhelmingly common no-duplicates case (krausest, sane apps):
   *
   *  1. First call for a fresh items[] does a single pass over items[]
   *     adding every base key to a reusable instance Set
   *     (`_dupDetectSet`). If the Set's final size equals items.length,
   *     there are no dupes — we set `_dupHasDupes = false` and return.
   *     No Map is allocated; no entry object is allocated.
   *
   *  2. If dupes ARE detected, we lazily build the Map<baseKey,
   *     firstIndex> on the SAME pass (using a reusable instance Map,
   *     `_dupFirstIdxMap`) and set `_dupHasDupes = true`.
   *
   * The cached verdict is keyed by `_dupItemsRef`, an instance-level
   * single-slot identity cache. Per-row callers compare `items` against
   * `_dupItemsRef`; if they match, the cached verdict is consulted. Otherwise
   * detection runs.
   *
   * The cache is invalidated explicitly at the top of every `syncList`
   * (and `_dupItemsRef` is set to null) — it's intentionally narrow-scoped
   * to a single sync pass. Inside one syncList we may receive several calls
   * to `keyForItem` from `isAppendOnlySuperset`, `keysForItems`, and
   * `updateItems`; the first hit pays the O(n) detection cost, all
   * subsequent calls hit the cached verdict.
   */
  protected _dupItemsRef: T[] | null = null;
  protected _dupHasDupes = false;
  protected _dupDetectSet: Set<string> = new Set();
  protected _dupFirstIdxMap: Map<string, number> = new Map();

  /**
   * Run dedup detection for `items[]` if it differs from the cached ref.
   * After return, `_dupHasDupes` and (if true) `_dupFirstIdxMap` are
   * populated. Returns true if dupes were detected.
   *
   * `_dupDetectSet` is cleared once at the start of detection. We don't
   * clear it on the no-dupes path (the contents are scratch and will be
   * cleared on next detection). We don't clear `_dupFirstIdxMap` on the
   * no-dupes path either — `_dupHasDupes === false` ensures callers won't
   * read it; we clear lazily on the next `_dupHasDupes = true` transition.
   */
  private detectDupes(
    items: T[],
    resolveBaseKey: (item: T, i: number) => string,
  ): boolean {
    if (this._dupItemsRef === items) return this._dupHasDupes;
    const set = this._dupDetectSet;
    set.clear();
    let hasDupes = false;
    let map: Map<string, number> | null = null;
    for (let j = 0; j < items.length; j++) {
      const k = resolveBaseKey(items[j], j);
      const sizeBefore = set.size;
      set.add(k);
      if (set.size !== sizeBefore + 1) {
        // Duplicate detected. Lazily allocate (well, re-use) the index
        // map on first dupe; do NOT re-record an existing entry.
        if (!hasDupes) {
          hasDupes = true;
          map = this._dupFirstIdxMap;
          map.clear();
          // Backfill: every key already in `set` is at its first
          // occurrence. Iterate items[0..j-1] and record the first
          // index for each key (re-using existing keys without
          // re-resolving where possible). The simpler/correct path
          // is to recompute baseKey for [0..j-1].
          for (let p = 0; p < j; p++) {
            const pk = resolveBaseKey(items[p], p);
            if (!map.has(pk)) map.set(pk, p);
          }
          // Current j is duplicate; its first index is already in map.
        }
        // No-op: we keep the firstIndex we have.
      } else if (hasDupes) {
        // Past first dupe — record any newly-seen key.
        if (!map!.has(k)) map!.set(k, j);
      }
    }
    this._dupItemsRef = items;
    this._dupHasDupes = hasDupes;
    return hasDupes;
  }

  private setupKeyForItem() {
    if (this.key === '@identity') {
      let cnt = 0;
      const map: WeakMap<T & object, string> = new WeakMap();
      const baseKeyOf = (item: T, i: number): string => {
        if (isPrimitive(item) || isEmpty(item)) {
          return `${String(item)}:${i}`;
        }
        const existing = map.get(item as T & object);
        if (existing !== undefined) return existing;
        const key = ++cnt as unknown as string;
        map.set(item as T & object, key);
        return key;
      };
      this.keyForItem = (item: T, i: number, items?: T[]) => {
        const baseKey = baseKeyOf(item, i);
        if (isPrimitive(item) || isEmpty(item)) {
          // Primitive base keys are already position-qualified, so the
          // duplicate-detection step below is unnecessary and would
          // misfire (every primitive of the same value would re-qualify
          // again).
          return baseKey;
        }
        // Duplicate-reference support: when the same object ref appears
        // more than once in the current items array, the first occurrence
        // uses the stable identity key; every subsequent occurrence gets
        // a position-qualified key so the diff algorithm treats it as a
        // distinct row. This preserves identity stability for the common
        // (no-duplicates) case. Inline fast-path: when the cached verdict
        // matches `items` and reports no dupes, the entire branch reduces
        // to two ref-equal compares + a boolean check (no method call).
        if (items !== undefined) {
          if (this._dupItemsRef !== items) {
            this.detectDupes(items, baseKeyOf);
          }
          if (this._dupHasDupes) {
            const firstIdx = this._dupFirstIdxMap.get(baseKey);
            if (firstIdx !== undefined && firstIdx < i) {
              return `${baseKey}:${i}` as unknown as string;
            }
          }
        }
        return baseKey;
      };
    } else {
      const resolveRawKey = (item: T, i: number): string => {
        // Null/undefined/primitive items cannot be keyed by an arbitrary
        // property name. Fall back to a position-qualified primitive key,
        // matching the `@identity` branch behavior. This avoids throwing on
        // arrays such as `[1, null]` or `[1, undefined]`, which the upstream
        // Ember runtime treats as render-but-not-keyed entries.
        if (item === null || item === undefined || isPrimitive(item)) {
          return `${String(item)}:${i}`;
        }
        if (IS_DEV_MODE) {
          if (this.key.split('.').length > 1) {
            console.warn(
              'Nested keys are not supported yet, likely you need to specify custom keyForItem function',
            );
            const resolvedKeyValue = this.key.split('.').reduce((acc, key) => {
              // @ts-expect-error unknown key
              return acc?.[key];
            }, item);
            console.log({ resolvedKeyValue, key: this.key, item });
            return String(resolvedKeyValue);
          }
          // @ts-expect-error unknown key
          if (typeof item[this.key] === 'undefined') {
            throw new Error(
              `Key for item not found, ${JSON.stringify(item)} ${this.key}`,
            );
          }
        }
        // @ts-expect-error unknown key
        return item[this.key] as unknown as string;
      };
      const baseKeyOf = (item: T, i: number): string => resolveRawKey(item, i);
      this.keyForItem = (item: T, i: number, items?: T[]) => {
        const baseKey = resolveRawKey(item, i);
        // Duplicate-key support: when multiple items produce the same
        // key (e.g. `{{#each list key="text"}}` with several items having
        // the same text), each subsequent occurrence gets a position-
        // qualified key so they're rendered as distinct rows. Preserves
        // stable identity for the common (no-duplicates) case. Inline
        // fast-path: when the cached verdict matches `items` and reports
        // no dupes, the entire branch reduces to two ref-equal compares +
        // a boolean check (no method call).
        if (items !== undefined) {
          if (this._dupItemsRef !== items) {
            this.detectDupes(items, baseKeyOf);
          }
          if (this._dupHasDupes) {
            const firstIdx = this._dupFirstIdxMap.get(baseKey);
            if (firstIdx !== undefined && firstIdx < i) {
              return `${baseKey}:${i}`;
            }
          }
        }
        return baseKey;
      };
    }
  }
  renderInverse() {
    if (!this.inverseFn || this.inverseContent !== null) return;
    const self = this as unknown as ComponentLike;
    setParentContext(self);
    this.inverseContent = this.inverseFn(self as unknown as Component<any>);
    setParentContext(null);
    const parent = this.api.parent(this.bottomMarker)!;
    renderElement(
      this.api,
      self,
      parent,
      this.inverseContent,
      this.bottomMarker,
    );
  }
  destroyInverseSync() {
    if (this.inverseContent === null) return;
    const content = this.inverseContent;
    this.inverseContent = null;
    // Run destructors on the inverse content component (cleans up reactivity, etc.)
    // Use skipDom=true because we manually remove DOM nodes below.
    // The inverse content's RENDERED_NODES_PROPERTY can become stale/corrupted
    // in compat mode, so relying on destroyElementSync for DOM removal is unreliable.
    destroyElementSync(content as ComponentLike, true, this.api);
    // Manually remove all DOM nodes between topMarker and bottomMarker.
    // This is the definitive cleanup — any inverse content nodes live in this range.
    this.clearInverseNodes();
  }
  /**
   * Remove all DOM nodes between topMarker and bottomMarker.
   * Used by destroyInverseSync/Async to ensure inverse content is fully cleaned up
   * regardless of RENDERED_NODES_PROPERTY state.
   */
  protected clearInverseNodes() {
    const { topMarker, bottomMarker, api } = this;
    let node = topMarker.nextSibling;
    while (node && node !== bottomMarker) {
      const next = node.nextSibling;
      api.destroy(node);
      node = next;
    }
  }
  async destroyInverseAsync() {
    if (this.inverseContent === null) return;
    const content = this.inverseContent;
    this.inverseContent = null;
    // Run destructors with skipDom=true, then manually remove DOM nodes
    // (same approach as destroyInverseSync — see comment there)
    await destroyElement(content as ComponentLike, true, this.api);
    this.clearInverseNodes();
  }
  // @ts-expect-error non-string return type
  keyForItem(item: T, index: number, items?: T[]): string {
    if (IS_DEV_MODE) {
      throw new Error(`Key for item not implemented, ${JSON.stringify(item)}`);
    }
  }
  private getTargetNode(amountOfKeys: number) {
    if (amountOfKeys > 0) {
      return this.bottomMarker;
    } else {
      let fragment!: DocumentFragment;
      // list fragment marker
      const marker = IS_DEV_MODE
        ? this.api.comment('list fragment target marker')
        : this.api.comment();
      if (isRehydrationScheduled()) {
        fragment = this.api.parent(marker) as unknown as DocumentFragment;
        // TODO: figure out, likely error here, because we don't append fragment
      } else {
        fragment = this.api.fragment();
        this.api.insert(fragment, marker);
      }
      return marker;
    }
  }
  // FIX 3a helper: construct a NEW row for `key`/`item` at `index`, register
  // its maps + marker, and (when appending) insert + render it before
  // `targetNode`. Extracted from updateItems' new-row branch so the
  // incremental append fast-path shares one source of truth. Returns the row
  // (or null/undefined when ItemComponent produced no output).
  private _buildAndInsertRow(
    item: T,
    index: number,
    key: string,
    targetNode: Node,
    isAppendOnly: boolean,
  ): void {
    const { keyMap, indexMap, itemMarkers, markerSet, api } = this;
    const self = this as unknown as ComponentLike;
    let marker = itemMarkers.get(key);
    if (!marker) {
      marker = IS_DEV_MODE ? api.comment(`list item ${key}`) : api.comment();
      itemMarkers.set(key, marker);
      markerSet.add(marker);
      // P7: reuse the hook hoisted by updateItems (this method is only called
      // from updateItems, after `_registerMarkerHook` is set). Fall back to a
      // direct read if invoked out of band.
      const _reg =
        this._registerMarkerHook ??
        (globalThis as { __gxtRegisterListMarker?: (m: Comment) => void })
          .__gxtRegisterListMarker;
      if (_reg) _reg(marker);
    }
    let idx: number | MergedCell = index;
    if (this.hasIndex) {
      const indexFormula = formula(
        () => {
          if (isPrimitive(item)) {
            return index;
          }
          const values = this.tag.value as T[];
          const itemIndex = values.indexOf(item);
          if (itemIndex === -1) {
            return values.findIndex((value: T, i) => {
              return this.keyForItem(value, i, values) === key;
            });
          }
          const firstKey = this.keyForItem(item, itemIndex, values);
          if (firstKey === key) return itemIndex;
          for (let j = itemIndex + 1; j < values.length; j++) {
            if (
              values[j] === item &&
              this.keyForItem(values[j], j, values) === key
            ) {
              return j;
            }
          }
          return itemIndex;
        },
        IS_DEV_MODE ? `each.index[${index}]` : undefined,
      );
      idx = indexFormula;
      if (!this.indexFormulaMap) this.indexFormulaMap = new Map();
      this.indexFormulaMap.set(key, indexFormula);
    }

    // Per-row destructor-owner ctx (fine-grained); `self` otherwise. Owns the
    // row body's direct element binding opcodes so they unsubscribe on teardown.
    const bodyCtx = this.rowBodyCtx(key, self);
    const row = this.ItemComponent(
      item,
      idx,
      bodyCtx as unknown as Component<any>,
    );

    keyMap.set(key, row);
    indexMap.set(key, index);
    if (_fineGrainedEachRebind()) {
      if (!this.boundItemMap) this.boundItemMap = new Map();
      this.boundItemMap.set(key, item);
    }
    if (isAppendOnly) {
      const parent = api.parent(targetNode)!;
      api.insert(parent, marker, targetNode);
      if (row !== undefined && row !== null) {
        renderElement(api, self, parent, row, targetNode);
      }
    } else {
      this._moveSet.add(key);
      this._freshMoveKeys.add(key);
    }
  }

  updateItems(items: T[], amountOfKeys: number, removedCount: number) {
    const {
      indexMap,
      keyMap,
      bottomMarker,
      keyForItem,
      ItemComponent,
      isFirstRender,
      api,
      itemMarkers,
      markerSet,
      _existKeys: existKeys,
      _existNewIdx: existNewIdx,
      _existOldIdx: existOldIdx,
      _lisResult: lisResult,
      _itemKeys: itemKeys,
      _moveSet: moveSet,
      _freshMoveKeys: freshMoveKeys,
    } = this;
    // P7: hoist the per-marker consumer-registry lookup. `__gxtRegisterListMarker`
    // is install-once-stable (manager.ts installs it idempotently at boot), so
    // reading it once per updateItems (instead of once per new marker) removes a
    // global-property lookup per row on the create/append path. Stashed on the
    // instance so `_buildAndInsertRow` (the append fast-path) reuses it too.
    this._registerMarkerHook = (
      globalThis as { __gxtRegisterListMarker?: (m: Comment) => void }
    ).__gxtRegisterListMarker;
    const _registerMarker = this._registerMarkerHook;
    existKeys.length = 0;
    existNewIdx.length = 0;
    existOldIdx.length = 0;
    itemKeys.length = items.length;
    moveSet.clear();
    freshMoveKeys.clear();

    const amountOfExistingKeys = amountOfKeys - removedCount;

    const self = this as unknown as ComponentLike;

    // FIX 3a — incremental append-only fast path. When syncList determined the
    // incoming items are a strict append-only superset (existing prefix
    // unchanged + in order) and nothing was removed, the existing rows
    // `[0, amountOfExistingKeys)` need no diff / LIS / move work: they are
    // provably stable and in order. We only construct + append the new tail
    // rows `[amountOfExistingKeys, items.length)`. O(added) instead of
    // O(items.length). Keyed correctness preserved: keyMap/indexMap/itemMarkers
    // for the prefix are untouched, and each new tail row is appended in order
    // before bottomMarker.
    //
    // Safety: the verdict only checked the prefix; a tail item could still
    // collide with an existing key (a duplicate object reference). If any tail
    // key already exists in keyMap, abort the fast path and fall through to the
    // general diff loop (which handles duplicates correctly).
    if (
      this._appendOnlyVerdict &&
      removedCount === 0 &&
      amountOfExistingKeys > 0 &&
      items.length > amountOfExistingKeys &&
      !isFirstRender
    ) {
      // Pre-fill itemKeys for the unchanged prefix (the move phase / index
      // formulas read itemKeys; the prefix keys equal their existing keys).
      let collision = false;
      for (let index = 0; index < amountOfExistingKeys; index++) {
        itemKeys[index] = keyForItem(items[index], index, items);
      }
      // Validate the tail keys are all NEW before mutating anything.
      for (let index = amountOfExistingKeys; index < items.length; index++) {
        const key = keyForItem(items[index], index, items);
        itemKeys[index] = key;
        if (keyMap.has(key)) {
          collision = true;
          break;
        }
      }
      if (!collision) {
        // Append target: bottomMarker (rows go just before it, in order).
        const appendTarget = this.getTargetNode(0);
        setParentContext(self);
        for (let index = amountOfExistingKeys; index < items.length; index++) {
          const item = items[index];
          const key = itemKeys[index];
          this._buildAndInsertRow(item, index, key, appendTarget, true);
        }
        setParentContext(null);
        // Flush the batched append fragment into the live DOM before
        // bottomMarker (mirrors the general path's fragment-insert below).
        if (appendTarget !== bottomMarker) {
          const parent = api.parent(appendTarget)!;
          const trueParent = api.parent(bottomMarker)!;
          if (!IN_SSR_ENV) {
            if (parent) {
              api.destroy(appendTarget);
            }
          }
          if (parent && trueParent !== parent) {
            api.insert(trueParent, parent, bottomMarker);
          }
        }
        if (isFirstRender) {
          this.isFirstRender = false;
        }
        return;
      }
      // collision: fall through to the general path (state below re-derives
      // everything from scratch; itemKeys is overwritten by the main loop).
    }

    let targetNode = items.length
      ? this.getTargetNode(amountOfExistingKeys)
      : bottomMarker;
    let seenKeys = 0;
    let isAppendOnly = isFirstRender;
    setParentContext(self);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (seenKeys === amountOfExistingKeys) {
        isAppendOnly = true;
        if (targetNode === bottomMarker) {
          // optimization for appending items case
          targetNode = this.getTargetNode(0);
        }
      }

      const key = keyForItem(item, index, items);
      itemKeys[index] = key;
      if (!keyMap.has(key)) {
        let marker = itemMarkers.get(key);
        if (!marker) {
          marker = IS_DEV_MODE
            ? api.comment(`list item ${key}`)
            : api.comment();
          itemMarkers.set(key, marker);
          markerSet.add(marker);
          // Register per-item marker with the consumer registry (no-op when
          // no consumer hook is installed). P7: hook hoisted to `_registerMarker`
          // at the top of updateItems (install-once-stable).
          if (_registerMarker) _registerMarker(marker);
        }
        // Provide a reactive `index` cell only when the compiled body
        // actually reads `index.value` (compiler sets `hasIndex` for that
        // case). Templates that bind `as |item|` only — including the
        // Krausest benchmark — skip the per-row MergedCell allocation +
        // closure capture and pass the raw integer instead. Templates that
        // do read the index get a formula that re-locates `item` in the
        // current tag value (handling duplicates by matching on key) so
        // reordering — e.g. `insertAt(1, ...)` shifting subsequent items
        // down — causes every existing row's index cell to recompute on
        // the next render pass.
        let idx: number | MergedCell = index;
        if (this.hasIndex) {
          const indexFormula = formula(
            () => {
              if (isPrimitive(item)) {
                return index;
              }
              const values = this.tag.value as T[];
              const itemIndex = values.indexOf(item);
              if (itemIndex === -1) {
                return values.findIndex((value: T, i) => {
                  return keyForItem(value, i, values) === key;
                });
              }
              // For the common (non-duplicate) case, indexOf is correct. When
              // the item appears multiple times in `values`, compute the key
              // at each occurrence and return the one that matches.
              const firstKey = keyForItem(item, itemIndex, values);
              if (firstKey === key) return itemIndex;
              for (let j = itemIndex + 1; j < values.length; j++) {
                if (
                  values[j] === item &&
                  keyForItem(values[j], j, values) === key
                ) {
                  return j;
                }
              }
              return itemIndex;
            },
            IS_DEV_MODE ? `each.index[${index}]` : undefined,
          );
          idx = indexFormula;
          // Track formula for cleanup when item is destroyed
          if (!this.indexFormulaMap) this.indexFormulaMap = new Map();
          this.indexFormulaMap.set(key, indexFormula);
        }

        // Per-row destructor-owner ctx (fine-grained); `self` otherwise. Owns the
        // row body's direct element binding opcodes so they unsubscribe on teardown.
        const bodyCtx = this.rowBodyCtx(key, self);
        const row = ItemComponent(item, idx, bodyCtx as unknown as Component<any>);

        keyMap.set(key, row);
        indexMap.set(key, index);
        if (_fineGrainedEachRebind()) {
          if (!this.boundItemMap) this.boundItemMap = new Map();
          this.boundItemMap.set(key, item);
        }
        if (isAppendOnly) {
          // TODO: in ssr parentNode may not exist
          const parent = api.parent(targetNode)!;
          api.insert(parent, marker, targetNode);
          // Skip renderElement when ItemComponent produced no output.
          // This can happen during destroy cascades when the item's
          // body expression evaluates against a torn-down context
          // (e.g., primitive-key rows where every shift invalidates
          // every key and triggers a mid-sync teardown).
          if (row !== undefined && row !== null) {
            renderElement(api, self, parent, row, targetNode);
          }
        } else {
          moveSet.add(key);
          freshMoveKeys.add(key);
        }
      } else {
        seenKeys++;
        const oldIndex = indexMap.get(key)!;
        existKeys.push(key);
        existNewIdx.push(index);
        existOldIdx.push(oldIndex);
        if (oldIndex !== index) {
          indexMap.set(key, index);
        }
        // Group-E: keyed REUSE. If the source object bound to this key changed
        // by reference (e.g. the keyed property was mutated in place, staling
        // the key, then a ref-swap reused the row by that stale key), re-bind
        // the row's block-param to the NEW object IN PLACE — preserving DOM
        // identity (no recreate). The host hook swaps the body-proxy's holder
        // target + re-fires the body. Gated to fine-grained mode.
        if (this.boundItemMap !== null) {
          const boundItem = this.boundItemMap.get(key);
          if (boundItem !== item) {
            const rebind = (globalThis as any).__gxtRebindEachItem;
            if (typeof rebind === 'function') {
              rebind(boundItem, item);
            }
            this.boundItemMap.set(key, item);
          }
        }
      }
    }

    // Use LIS on existing items' old indices (in new-list order) to find
    // the largest subset already in correct relative order.  Only items
    // outside the LIS need actual DOM relocation.
    if (existKeys.length > 1) {
      const stable = longestIncreasingSubsequence(existOldIdx, lisResult);
      for (let i = 0; i < existKeys.length; i++) {
        if (!stable.has(i)) {
          moveSet.add(existKeys[i]);
        }
      }
    } else if (existKeys.length === 1 && existOldIdx[0] !== existNewIdx[0]) {
      moveSet.add(existKeys[0]);
    }

    setParentContext(null);

    // Insert batched append-only fragment into main DOM before the move phase,
    // so that all item markers are reachable in the live DOM tree.
    if (targetNode !== bottomMarker) {
      const parent = api.parent(targetNode)!;
      const trueParent = api.parent(bottomMarker)!;
      // parent may not exist in rehydration
      if (!IN_SSR_ENV) {
        if (parent) {
          api.destroy(targetNode);
        }
      }
      if (parent && trueParent !== parent) {
        api.insert(trueParent, parent, bottomMarker);
      }
    }

    // Move phase: iterate right-to-left through the new item list,
    // maintaining a running anchor.  Stable (LIS) items just update the
    // anchor; moved/new items are inserted before it.
    //
    // Duplicate-key handling: when the same item reference appears more
    // than once in the list (e.g. @identity key on a list containing the
    // same object ref multiple times) we only have ONE rendered DOM
    // subtree for that key. We must move it at most once per sync pass —
    // otherwise the second "move" tries to relocate the marker to itself
    // (or past an anchor that IS the marker), which throws in the browser
    // and corrupts the tree. The rightmost occurrence wins (first visited
    // in right-to-left order); subsequent duplicates are treated as
    // stable and simply update the anchor.
    //
    // The `processedKeys` dedupe set is only populated when the items
    // array actually contains duplicates (the firstIdxMap built during
    // the diff loop above tells us). The common path skips the per-row
    // Set.has check entirely.
    if (moveSet.size > 0) {
      const moveParent = api.parent(bottomMarker)!;
      let anchor: Node = bottomMarker;
      // The diff loop above will have called keyForItem(items[i], i, items)
      // for every i, so dedup detection has run for `items` and the cached
      // verdict on `_dupHasDupes` is authoritative for THIS items[].
      const hasDupes = this._dupItemsRef === items && this._dupHasDupes;
      const processedKeys = this._processedKeys;
      if (hasDupes) processedKeys.clear();
      for (let idx = items.length - 1; idx >= 0; idx--) {
        const key = itemKeys[idx];
        const alreadyProcessed = hasDupes && processedKeys.has(key);
        if (!moveSet.has(key) || alreadyProcessed) {
          // Stable item (LIS or already-appended, or a duplicate whose
          // single DOM subtree was already handled). Use its marker as
          // the running anchor.
          const marker = itemMarkers.get(key);
          if (marker) anchor = marker;
          continue;
        }
        if (hasDupes) processedKeys.add(key);
        const marker = itemMarkers.get(key);
        if (!marker) continue;

        if (freshMoveKeys.has(key)) {
          const row = keyMap.get(key);
          api.insert(moveParent, marker, anchor);
          // Skip renderElement if ItemComponent produced no output.
          if (row !== undefined && row !== null) {
            renderElement(api, self, moveParent, row, anchor);
          }
        } else {
          this.relocateItem(marker, anchor, moveParent);
        }
        anchor = marker;
      }
    }
    if (isFirstRender) {
      this.isFirstRender = false;
    }
  }
}

export class SyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  // Re-entry guard: true while syncList is actively running on this instance.
  // Prevents destructor-triggered syncList([]) from re-entering during item
  // removal cascades (e.g., when @identity keys include index and every key
  // changes after a shiftObject on a primitive-item array). Without this,
  // a child destroy cascade can call back into a destructor that runs
  // `this.syncList([])` mid-update, corrupting keyMap/indexMap state and
  // causing the outer updateItems to throw and skip re-rendering new items.
  private _syncInProgress = false;
  constructor(
    params: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    super(params, outlet, topMarker);
    // Register destructors on `this` (the list instance) rather than
    // `params.ctx`. The list instance is added to the destruction tree
    // as a child of the parent context via addToTree in the base
    // constructor, so it gets destroyed when the parent tears down.
    //
    // Registering on `params.ctx` breaks nested lists: a nested
    // {{#each}} inside a parent {{#each}}'s item body captures the
    // top-level test component as params.ctx (because that's what
    // GXT emits for the compiled fn). When the parent each removes an
    // item, its DOM is torn down, but because the inner list's
    // destructors were attached to the top-level component (not the
    // item), the inner list's opcode on its tag cell is NEVER removed.
    // Later, when the cell value changes, the orphaned opcode fires and
    // creates new item components (triggering their init hooks), even
    // though the inner list's DOM has been reparented/removed.
    //
    // Attaching the destructors to `this` (the list instance, which
    // sits under the parent item in the TREE/CHILD map) means the
    // inner list's opcode is correctly cleaned up when its parent
    // item is destroyed, matching Ember's expected teardown order.
    registerDestructor(
      this,
      () => {
        // If syncList is already running (destructor cascade fired during an
        // active sync), skip — the in-progress sync will tear items down
        // according to the new value; running another syncList([]) here
        // would corrupt keyMap state and throw inside updateItems.
        if (this._syncInProgress) return;
        this.inverseFn = null;
        this.destroyInverseSync();
        this.syncList([]);
      },
      opcodeFor(this.tag, (value) => {
        if (isDestructionStarted(this)) return;
        // Same re-entry guard: if an outer syncList on this instance is
        // active, drop this opcode invocation. The outer call already sees
        // the current tag value.
        if (this._syncInProgress) return;
        this.syncList(normalizeIterableValue<T>(value));
      }),
    );
  }
  fastCleanup() {
    const { keyMap, bottomMarker, topMarker, indexMap, indexFormulaMap, api } =
      this;
    const parent = api.parent(bottomMarker);
    if (
      parent &&
      parent.lastChild === bottomMarker &&
      parent.firstChild === topMarker
    ) {
      // Detach CHILD so item destructors skip parent-sibling deletes.
      this.detachTreeChildren();
      // O(n^2) FIX: bulk-clear the parent's DOM FIRST (innerHTML='' is O(1)),
      // BEFORE running the per-row destructors. The guard above proves this
      // list owns the entire parent (its markers are first/last child), so a
      // bulk clear is safe and removes every row in one reflow. The per-row
      // `destroyElementSync(value, skipDom=true)` cascade below still runs the
      // reactive cleanup (registered destructors, cell/formula `.destroy()`),
      // but each row's top node is a raw <tr>/element passed to
      // `api.destroy(node)` -> `node.remove()`. When the parent still held all
      // N siblings, every individual `.remove()` was an O(N) live-childlist
      // splice + layout invalidation, making a full keyed-each clear O(N^2)
      // (measured: 1k=32ms, 10k=2980ms ~ 93x for 10x rows). With the parent
      // already emptied, those `.remove()` calls see `parentNode === null` and
      // are O(1) no-ops, collapsing teardown to linear.
      this.api.clearChildren(parent);
      this.api.insert(parent, topMarker);
      this.api.insert(parent, bottomMarker);
      for (const value of keyMap.values()) {
        destroyElementSync(value as ComponentLike, true, this.api);
      }
      // Tear down each row's per-row destructor-owner ctx (fine-grained), so the
      // row body's `class`/attr/text/event/modifier opcodes UNSUBSCRIBE from
      // shared cells. Without this they leaked onto the surviving list instance.
      this.teardownAllRowCtxs();
      // Clean up all reactive index formulas
      if (indexFormulaMap) {
        for (const formula of indexFormulaMap.values()) {
          formula.destroy();
        }
        indexFormulaMap.clear();
      }
      keyMap.clear();
      indexMap.clear();
      if (this.boundItemMap !== null) this.boundItemMap.clear();
      this.itemMarkers.clear();
      this.markerSet.clear();
      return true;
    } else {
      return false;
    }
  }
  syncList(items: T[]) {
    // Defensive normalization: while the opcode handler already normalizes
    // incoming cell values, syncList may be invoked through other paths
    // (legacy callers, internal teardown) — guarantee a real array.
    if (!Array.isArray(items)) {
      items = normalizeIterableValue<T>(items);
    }
    // Re-entry guard: during an item-destroy cascade, Ember's KVO/backtracking
    // layer can synchronously fire a destructor that re-invokes syncList on
    // this same instance. A nested call observes half-destroyed keyMap state
    // and corrupts it. Skip nested calls — the outer one is already applying
    // `items`, which is either the final desired state or `[]` (teardown).
    if (this._syncInProgress) return;
    this._syncInProgress = true;
    // Invalidate the duplicate-key detection cache for this sync pass — a
    // mutated-in-place array would otherwise carry stale verdict forward.
    this._dupItemsRef = null;
    try {
      const { keyMap, keyForItem } = this;

      if (items.length > 0 && this.inverseContent !== null) {
        this.destroyInverseSync();
      }

      if (items.length === 0 && !this.isFirstRender) {
        if (this.fastCleanup()) {
          if (this.inverseFn) this.renderInverse();
          return;
        }
      }
      let amountOfKeys = keyMap.size;
      let removedCount = 0;

      // FIX 3a: when the new items are a strict append-only superset of the
      // current rows, the removal/diff block below is skipped and updateItems
      // can take the O(added) incremental path. Compute the verdict once and
      // record it for updateItems (reset to false otherwise).
      const appendOnly =
        amountOfKeys > 0 &&
        this.isAppendOnlySuperset(items, amountOfKeys, keyForItem);
      this._appendOnlyVerdict = appendOnly;

      if (amountOfKeys > 0 && !appendOnly) {
        const updatingKeys = this.keysForItems(items, keyForItem);
        const keysToRemove = this._keysToRemove;
        const rowsToRemove = this._rowsToRemove;
        keysToRemove.length = 0;
        rowsToRemove.length = 0;

        for (const [key, row] of keyMap.entries()) {
          if (updatingKeys.has(key)) {
            continue;
          }
          keysToRemove.push(key);
          rowsToRemove.push(row);
        }
        if (keysToRemove.length) {
          // Only take the bulk `fastCleanup` path when the list is going fully
          // empty (`items.length === 0`). On a REF-SWAP to a disjoint non-empty
          // set (`set(this,'items', newArr)` where every old key is gone but new
          // keys arrive), every old key is in `keysToRemove` so
          // `keysToRemove.length === amountOfKeys`, but we still need to render
          // the new rows immediately afterwards. `fastCleanup` runs
          // `clearChildren(parent)` AND a `destroyElementSync(row, skipDom)`
          // cascade that — for Ember each-body rows — reaches the LIST's own
          // destructor, deleting the list from TREE. `updateItems` then resolves
          // `getParentContext()` to `undefined` and the new-row construction
          // throws ("reading 'Symbol()'" inside addToTree/provideContext),
          // leaving the list empty. Restricting the bulk path to the
          // going-empty case keeps that optimization for the common clear/teardown
          // while routing the disjoint ref-swap through per-row `destroyItem`
          // (which has the COMPONENT_ID safeToCascade guard and does NOT tear
          // down the list itself), so the list stays in TREE and new rows render.
          if (keysToRemove.length === amountOfKeys && items.length === 0) {
            if (this.fastCleanup()) {
              amountOfKeys = 0;
              keysToRemove.length = 0;
            } else {
              // fastCleanup failed but removing all items — detach CHILD
              // to skip parent-sibling delete work in each item's destructor.
              this.detachTreeChildren();
            }
          }
          removedCount = keysToRemove.length;
          for (let i = 0; i < keysToRemove.length; i++) {
            this.destroyItem(rowsToRemove[i], keysToRemove[i]);
          }
        }
        // Release references to destroyed rows
        rowsToRemove.length = 0;
      }
      this.updateItems(items, amountOfKeys, removedCount);

      if (items.length === 0 && this.inverseFn) {
        this.renderInverse();
      }
    } finally {
      this._syncInProgress = false;
    }
  }
  destroyItem(row: GenericReturnType, key: string) {
    const { keyMap, indexMap, indexFormulaMap } = this;
    keyMap.delete(key);
    indexMap.delete(key);
    if (this.boundItemMap !== null) this.boundItemMap.delete(key);
    // Tear down this row's per-row destructor-owner ctx (fine-grained) so its
    // element binding opcodes UNSUBSCRIBE from shared cells. No-op morph-ON.
    this.destroyRowCtx(key);
    // Clean up reactive index formula if it exists
    if (indexFormulaMap) {
      const formula = indexFormulaMap.get(key);
      if (formula) {
        formula.destroy();
        indexFormulaMap.delete(key);
      }
    }
    // Defensive tree-scoping: under some compat-mode wrappers a row object
    // can point at a shared/root-level ComponentLike (COMPONENT_ID_PROPERTY=1)
    // whose CHILD set is the tree-root's own children. Passing that row to
    // destroyElementSync would cascade through every sibling subtree (other
    // #each regions, layouts, etc.) and wipe anchors mid-sync.
    //
    // Only walk the CHILD tree when `row` is registered as OUR direct child
    // (PARENT[rowId] === listId). Otherwise restrict destruction to the row's
    // own rendered nodes without traversing CHILD — the real subtree owner
    // will tear itself down when its scope ends.
    const rowIsArray = Array.isArray(row);
    let safeToCascade = rowIsArray;
    if (!safeToCascade) {
      const rowAny = row as unknown as { [COMPONENT_ID_PROPERTY]?: number };
      if (rowAny !== null && typeof rowAny === 'object') {
        const rowId = rowAny[COMPONENT_ID_PROPERTY];
        if (
          rowId === undefined ||
          PARENT.get(rowId) === this[COMPONENT_ID_PROPERTY]
        ) {
          safeToCascade = true;
        }
      } else {
        // primitive/null row — pass through (destroyElementSync handles it)
        safeToCascade = true;
      }
    }
    if (safeToCascade) {
      destroyElementSync(row as ComponentLike, false, this.api);
    } else {
      // Shared/root row — scope DOM cleanup to this row's rendered nodes only.
      const rendered = (row as any)?.[RENDERED_NODES_PROPERTY];
      if (Array.isArray(rendered)) {
        for (let i = 0; i < rendered.length; i++) {
          const node = rendered[i];
          if (node && typeof node === 'object' && 'nodeType' in node) {
            const n = node as Node;
            if (n.isConnected) {
              try {
                this.api.destroy(n);
              } catch {
                /* best-effort */
              }
            }
          }
        }
      }
    }
    this.removeMarker(key);
  }
}

export class AsyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  destroyPromise: Promise<void[]> | null = null;
  constructor(
    params: ListComponentArgs<any>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    super(params, outlet, topMarker);
    // See SyncListComponent constructor for rationale: attach destructors
    // to `this` so a nested list's opcode is correctly unregistered when
    // its enclosing iteration is torn down.
    registerDestructor(
      this,
      () => {
        if (this.destroyPromise) {
          return this.destroyPromise;
        }
      },
      async () => {
        this.inverseFn = null;
        await this.destroyInverseAsync();
        await this.syncList([]);
      },
      opcodeFor(this.tag, async (value) => {
        if (isDestructionStarted(this)) return;
        await this.syncList(normalizeIterableValue<T>(value));
      }),
    );
  }
  async fastCleanup() {
    const { bottomMarker, topMarker, keyMap, indexMap, indexFormulaMap, api } =
      this;
    const parent = api.parent(bottomMarker);
    if (
      parent &&
      parent.lastChild === bottomMarker &&
      parent.firstChild === topMarker
    ) {
      // PR https://github.com/lifeart/glimmer-next/pull/212: when this list
      // is itself being torn down by a parent destruction cascade
      // (`isDestructionStarted(this) === true` while the LIST destructor is
      // running) the row destructors have ALREADY been invoked synchronously
      // by `runDestructorsInternal` when iterating LIST's CHILD set — and
      // `runDestructorsInternal` parks the per-row DOM removal behind the
      // row's pending modifier-destructor promises. Issuing
      // `clearChildren(parent)` here would short-circuit those promises and
      // wipe the row DOM before the async element destructors (e.g. fade-out
      // animations) finish. Bail out of the bulk-DOM path; the parent cascade
      // (and the per-row `destroyNodes(api, row[RENDERED_NODES_PROPERTY])`
      // queued behind each modifier promise) will reclaim the DOM at the
      // correct time. Regression: `Integration | InternalComponent | each >>
      // it wait for async element destructors before destroying`.
      const cascadeDestruction = isDestructionStarted(this);
      // Detach CHILD so item destructors skip parent-sibling deletes.
      this.detachTreeChildren();

      // FIX 4 — full-clear fast path. On a stand-alone full clear
      // (`!cascadeDestruction`) the DOM is reclaimed in ONE bulk
      // `clearChildren(parent)` (innerHTML='', O(1)). Awaiting a graph of
      // per-row destructor promises (one per row, each resolving its async
      // element/modifier destructors) BEFORE that bulk clear means the
      // Promise/microtask churn over N rows dominates (~50× at 10k rows) even
      // though the DOM removal itself is O(1) and `skipDom=true` (the
      // destructors don't touch DOM). So: clear the DOM IMMEDIATELY (sync),
      // then run the row destructors WITHOUT blocking the clear. The
      // destructors still RUN — they are just no longer on the critical path.
      // We collect them into `destroyPromise` so any caller that awaits
      // teardown (the list's own destructor returns `destroyPromise`) still
      // observes completion.
      //
      // The cascade-destruction branch (parent is tearing this list down) is
      // unchanged: it must NOT bulk-clear here (the parent cascade owns the
      // per-row DOM removal behind each modifier's pending promise — see PR
      // #212), and it still awaits so animated removals complete.
      if (!cascadeDestruction) {
        // Bulk-remove the rendered rows between the markers FIRST.
        this.api.clearChildren(parent);
        this.api.insert(parent, topMarker);
        this.api.insert(parent, bottomMarker);
        // Snapshot the rows, then clear keyMap so the fire-and-forget
        // destructors operate on a stable set independent of further syncs.
        const rows: ComponentLike[] = [];
        for (const value of keyMap.values()) {
          rows.push(value as ComponentLike);
        }
        if (indexFormulaMap) {
          for (const formula of indexFormulaMap.values()) {
            formula.destroy();
          }
          indexFormulaMap.clear();
        }
        // Snapshot + detach the per-row destructor-owner ctxs (fine-grained)
        // alongside the rows, so the row body's element binding opcodes (incl.
        // any async modifier teardowns) unsubscribe instead of leaking onto the
        // surviving list. Mirrors SyncListComponent.teardownAllRowCtxs but async.
        const rowCtxs: ComponentLike[] = [];
        const rowCtxMap = this.rowCtxMap;
        if (rowCtxMap !== null && rowCtxMap.size > 0) {
          const childSet = CHILD.get(this[COMPONENT_ID_PROPERTY]);
          for (const rowCtx of rowCtxMap.values()) {
            const rowId = rowCtx[COMPONENT_ID_PROPERTY];
            rowCtxs.push(rowCtx as unknown as ComponentLike);
            CHILD.delete(rowId);
            TREE.delete(rowId);
            PARENT.delete(rowId);
            if (childSet !== undefined) childSet.delete(rowId);
          }
          rowCtxMap.clear();
        }
        keyMap.clear();
        indexMap.clear();
        this.itemMarkers.clear();
        this.markerSet.clear();
        // Run destructors fire-and-forget (DOM already gone → skipDom=true).
        const teardown: Promise<void[]> = Promise.all([
          ...rows.map((row) => destroyElement(row, true, this.api)),
          ...rowCtxs.map((rc) => destroyElement(rc, true, this.api)),
        ]);
        // Track so the list destructor (which returns destroyPromise) can
        // await full teardown if needed; don't block this clear on it.
        this.destroyPromise = teardown;
        teardown.then(() => {
          if (this.destroyPromise === teardown) {
            this.destroyPromise = null;
          }
        });
        return true;
      }

      // Cascade-destruction path: await per-row destructors so async element
      // destructors (e.g. fade-out) finish; the parent cascade reclaims DOM.
      const promises: Array<Promise<void>> = [];
      for (const value of keyMap.values()) {
        promises.push(destroyElement(value as ComponentLike, true, this.api));
      }
      // Per-row destructor-owner ctxs (fine-grained). When the LIST itself is
      // torn down, the parent cascade also walks these (they are CHILD of the
      // list); destroyElement is idempotent so awaiting here is safe + ensures
      // they unsubscribe even on a standalone async clear.
      const rowCtxMap = this.rowCtxMap;
      if (rowCtxMap !== null && rowCtxMap.size > 0) {
        const childSet = CHILD.get(this[COMPONENT_ID_PROPERTY]);
        for (const rowCtx of rowCtxMap.values()) {
          const rowId = rowCtx[COMPONENT_ID_PROPERTY];
          promises.push(
            destroyElement(rowCtx as unknown as ComponentLike, true, this.api),
          );
          CHILD.delete(rowId);
          TREE.delete(rowId);
          PARENT.delete(rowId);
          if (childSet !== undefined) childSet.delete(rowId);
        }
        rowCtxMap.clear();
      }
      await Promise.all(promises);
      promises.length = 0;
      // Clean up all reactive index formulas
      if (indexFormulaMap) {
        for (const formula of indexFormulaMap.values()) {
          formula.destroy();
        }
        indexFormulaMap.clear();
      }
      keyMap.clear();
      indexMap.clear();
      this.itemMarkers.clear();
      this.markerSet.clear();
      return true;
    } else {
      return false;
    }
  }
  async syncList(items: T[]) {
    // Defensive normalization (see SyncListComponent.syncList).
    if (!Array.isArray(items)) {
      items = normalizeIterableValue<T>(items);
    }
    // Invalidate per-items-array duplicate-key cache (see SyncListComponent)
    this._dupItemsRef = null;
    // Destroy inverse when items arrive — guarded to avoid unnecessary await
    if (items.length > 0 && this.inverseContent !== null) {
      await this.destroyInverseAsync();
    }

    if (items.length === 0 && !this.isFirstRender) {
      if (await this.fastCleanup()) {
        if (this.inverseFn) this.renderInverse();
        return;
      }
    }
    const { keyMap, keyForItem } = this;
    let amountOfKeys = keyMap.size;
    let removedCount = 0;

    // FIX 3a: see SyncListComponent.syncList — record the append-only verdict
    // so updateItems can take the O(added) incremental path.
    const appendOnly =
      amountOfKeys > 0 &&
      this.isAppendOnlySuperset(items, amountOfKeys, keyForItem);
    this._appendOnlyVerdict = appendOnly;

    if (amountOfKeys > 0 && !appendOnly) {
      const keysToRemove = this._keysToRemove;
      const rowsToRemove = this._rowsToRemove;
      keysToRemove.length = 0;
      rowsToRemove.length = 0;
      const removeQueue: Array<Promise<void>> = [];

      const updatingKeys = this.keysForItems(items, keyForItem);
      for (const [key, row] of keyMap.entries()) {
        if (updatingKeys.has(key)) {
          continue;
        }
        keysToRemove.push(key);
        rowsToRemove.push(row);
      }
      if (keysToRemove.length) {
        if (keysToRemove.length === amountOfKeys) {
          if (await this.fastCleanup()) {
            amountOfKeys = 0;
            keysToRemove.length = 0;
          } else {
            // fastCleanup failed but removing all items — detach CHILD
            // to skip parent-sibling delete work in each item's destructor.
            this.detachTreeChildren();
          }
        }
        removedCount = keysToRemove.length;

        for (let i = 0; i < keysToRemove.length; i++) {
          removeQueue.push(this.destroyItem(rowsToRemove[i], keysToRemove[i]));
        }
      }
      // Release references to destroyed rows
      rowsToRemove.length = 0;

      const removePromise = Promise.all(removeQueue);

      if (removeQueue.length) {
        this.destroyPromise = removePromise;
        removePromise.then(() => {
          this.destroyPromise = null;
        });
      }
    }
    this.updateItems(items, amountOfKeys, removedCount);

    if (items.length === 0 && this.inverseFn) {
      this.renderInverse();
    }
  }
  async destroyItem(row: GenericReturnType, key: string) {
    const { keyMap, indexMap, indexFormulaMap } = this;
    keyMap.delete(key);
    indexMap.delete(key);
    // Clean up reactive index formula if it exists
    if (indexFormulaMap) {
      const formula = indexFormulaMap.get(key);
      if (formula) {
        formula.destroy();
        indexFormulaMap.delete(key);
      }
    }
    // Tear down this row's per-row destructor-owner ctx (fine-grained) FIRST,
    // with skipDom=false so its cascade removes any `$_ucw`-wrapped child DOM
    // (the UCW is a tree child of rowCtx — see destroyRowCtx doc) and awaits
    // async element/modifier destructors. Then destroy the row itself: for a
    // stable `<tr>` body that removes the raw node; for a UCW body it no-ops
    // (already destroyed via the cascade). No-op morph-ON.
    const rowCtxMap = this.rowCtxMap;
    const rowCtx = rowCtxMap?.get(key);
    if (rowCtx !== undefined) {
      const rowId = rowCtx[COMPONENT_ID_PROPERTY];
      rowCtxMap!.delete(key);
      const childSet = CHILD.get(this[COMPONENT_ID_PROPERTY]);
      await destroyElement(rowCtx as unknown as ComponentLike, false, this.api);
      CHILD.delete(rowId);
      TREE.delete(rowId);
      PARENT.delete(rowId);
      if (childSet !== undefined) childSet.delete(rowId);
    }
    await destroyElement(row as ComponentLike, false, this.api);
    this.removeMarker(key);
  }
}
