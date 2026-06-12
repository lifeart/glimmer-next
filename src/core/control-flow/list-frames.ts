/**
 * Frame mode (v2) for the static-block {{#each}} fast path.
 *
 * RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A1 / §5 (E5): the static-block v1
 * path already builds qualifying rows via cloneNode + slot wiring, but still
 * pays the FULL per-row keyed bookkeeping: a marker comment, ~7 map entries
 * (keyMap/indexMap/boundItemMap/itemMarkers/markerSet/rowCtxMap), a RowContext
 * with cId()/addToTree/destructor registry, renderElement recursion and one
 * MergedCell formula per binding. Instrumentation showed that bookkeeping —
 * not clone+bind — dominates happy-dom create1k. Frame mode removes it:
 *
 *   Per row, ONE record:    Frame = { root, nodes[], thunks[], values[],
 *                                     item, index, itemCells/Unsubs/Slots, itemOp }
 *   Row boundary:           the single root element itself (the compiler gate
 *                           guarantees single-root blocks) — no marker comment.
 *   Teardown ownership:     the LIST owns frame teardown (run `itemUnsubs`);
 *                           no rowBodyCtx / cId / addToTree / destructor cascade.
 *   Bindings:               no per-binding MergedCells. Each slot's value thunk
 *                           is PROBED with the ambient tracker (the same
 *                           tracking primitive `formula` uses) on every run:
 *     - tracked cell owned by the row's item (`cellFor(item, k)` /
 *       `@tracked`-backed — detected via `_relatedObj` or membership in
 *       `cellsMap.get(item)`) → ONE op subscription per (row, cell); the op
 *       re-runs only that row's item-dep slots with prev-value guards.
 *     - any other tracked cell (`this.*`, args, outer formulas — formulas
 *       probe through to their LEAF cells, since reading a MergedCell under a
 *       tracker runs its fn() in OUR frame) → ONE LIST-LEVEL subscription per
 *       distinct cell; its op sweeps all frames re-running only the slots
 *       registered for that cell (flat loop + value guards — no formula
 *       re-tracking, no relatedTags churn).
 *     - no cells tracked on the FIRST run → static slot: written once
 *       (mirroring `$prop`/`$attr`/`$ev`'s const-collapse), never re-run.
 *   Routing is GROW-ONLY and re-probed on every slot re-run, so conditional
 *   dep sets (`this.a ? this.b : this.c`) can only ever OVER-subscribe
 *   (guarded no-op re-runs), never go stale. Dropped deps are reclaimed on
 *   row teardown (item cells) / list teardown (shared cells).
 *   Relocation:             keyed LIS move phase preserved; a move is ONE
 *                           `insertBefore(frame.root, anchor)` instead of a
 *                           marker-extent fragment walk.
 *   Rebind (ref-swapped item under a stable key): swap `frame.item`,
 *   re-create the thunks from the new item, re-run every slot, re-route the
 *   item-dep subscriptions. (Subsumes the `__gxtRebindEachItem` host hook —
 *   frame mode is gated OFF when an Ember host is detected, see below.)
 *
 * Reactive core reuse: subscriptions go through the SAME `opsForTag` channel
 * `opcodeFor` uses (see `subscribeOp` — identical to `opcodeFor` minus the
 * immediate evaluation, because the initial slot run already happened);
 * delivery is the normal `tagsToRevalidate` → drain. No parallel reactivity.
 *
 * Qualification (runtime gate, decided once in the BasicListComponent
 * constructor — the compiler already guarantees single-root inline-element
 * bodies for any emitted `$_blk`):
 *   - a compiler-emitted block + blockValues (v1 prerequisite);
 *   - NO 'event' slots (event listeners keep v1 — they need the per-row
 *     destructor plumbing frame records intentionally drop);
 *   - `hasIndex === false` (bodies reading `{{index}}` need the per-row index
 *     formula machinery — v1);
 *   - not SSR / not rehydrating (block path can't adopt server DOM);
 *   - no Ember-host hooks installed (`__gxtRegisterObjectValueOwner` /
 *     `__gxtCurrentTemplateThis` / `__gxtRebindEachItem`): those hosts rely
 *     on per-binding formulas for leaf-owner registration
 *     (registerLeafOwnersForFormula / materializeAbsentPathCell) and on the
 *     rebind hook's proxy-holder swap — keep them on v1;
 *   - not recycle mode (its own dedicated path).
 * Everything else — component bodies, multi-root, nested control flow,
 * modifiers, `...attributes`, duplicate-unsafe constructs — already bailed at
 * the compiler's block extraction and stays on the standard keyed path.
 */
import type { DOMApi } from '@/core/types';
import type { StaticBlockDef, StaticBlockSlot } from '@/core/static-block';
import {
  type AnyCell,
  type Cell,
  type tagOp,
  opsFor,
  opsForTag,
  releaseOpArray,
  getTracker,
  setTracker,
  cellsMap,
  deepFnValue,
} from '@/core/reactive';
import { isFn, isEmpty, isTagLike } from '@/core/shared';
import {
  longestIncreasingSubsequence,
  type BasicListComponent,
} from './list';

/** Per-row frame record — the ONLY per-row state frame mode keeps. */
export interface EachFrame<T> {
  /** The cloned single-root row element. IS the row boundary (no marker). */
  root: Node;
  /** Slot nodes, parallel to the block's slot table. */
  nodes: Node[];
  /** Raw positional slot values from `blockValues(item, index, list)`. */
  thunks: readonly unknown[];
  /** Last APPLIED values (per-kind normalized), parallel to the slot table. */
  values: unknown[];
  item: T;
  /** Position as of the last sync (feeds the LIS move phase). */
  index: number;
  /** Item-owned dep cells subscribed for this row (null until first dep). */
  itemCells: AnyCell[] | null;
  /** subscribeOp cleanups, parallel to itemCells. */
  itemUnsubs: Array<() => void> | null;
  /** Slot indices with item-cell deps — what `itemOp` re-runs. */
  itemSlots: number[] | null;
  /** The row's single update op (reused across rebinds). */
  itemOp: tagOp | null;
  /** `cellsMap.get(item)` snapshot at bind/rebind (item-cell classification —
   * avoids a WeakMap get per slot run). */
  bag: Map<string | number | symbol, Cell<unknown>> | undefined;
}

/** One list-level subscription per distinct shared (non-item) dep cell. */
export interface FrameSharedEntry {
  /** Union of slot indices (across rows) that tracked this cell. */
  slots: number[];
  unsub: () => void;
}

/** "no value applied yet" — lets the prop/class first-run guard mirror
 * `$prop`'s `prevPropValue = undefined` semantics exactly. */
const UNSET: unknown = Symbol();

/** Runtime frame-mode qualification over the compiled slot table. */
export function framesQualify(block: StaticBlockDef): boolean {
  const slots = block.slots;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].k === 'event') return false;
  }
  return true;
}

/** Ember-host detection — hosts keep the v1 formula-based bindings. */
export function frameHostHooksInstalled(): boolean {
  const g = globalThis as Record<string, unknown>;
  return (
    typeof g.__gxtRegisterObjectValueOwner === 'function' ||
    g.__gxtCurrentTemplateThis !== undefined ||
    typeof g.__gxtRebindEachItem === 'function'
  );
}

/**
 * Subscribe an op to a tag WITHOUT the immediate evaluation `opcodeFor`
 * performs (the caller has already run/applied the slot). The returned
 * unsubscribe is byte-for-byte `opcodeFor`'s.
 */
function subscribeOp(tag: AnyCell, op: tagOp): () => void {
  const ops = opsFor(tag)!;
  ops.push(op);
  return () => {
    const index = ops.indexOf(op);
    if (index > -1) {
      ops.splice(index, 1);
    }
    if (ops.length === 0) {
      opsForTag.delete(tag.id);
      releaseOpArray(ops);
      if ('destroy' in tag) {
        tag.destroy();
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Reusable scratch (module-level; frame syncs never nest: frame bodies contain
// no control flow, so no inner list can sync while a frame sync is mid-flight,
// and slot runs are synchronous + non-reentrant)
// ---------------------------------------------------------------------------
const PROBE: Set<Cell> = new Set();
const KEYS: string[] = [];
const KEYSET: Set<string> = new Set();
const EXIST_KEYS: string[] = [];
const EXIST_OLD: number[] = [];
const EXIST_NEW: number[] = [];
const LIS_OUT: Set<number> = new Set();
const MOVE: Set<string> = new Set();

type AnyList = BasicListComponent<any>;

function isItemCell(
  cell: AnyCell,
  item: unknown,
  bag: Map<string | number | symbol, Cell<unknown>> | undefined,
): boolean {
  if ((cell as Cell)._relatedObj === (item as object)) return true;
  if (bag !== undefined) {
    for (const c of bag.values()) {
      if ((c as AnyCell) === cell) return true;
    }
  }
  return false;
}

/** Route the cells PROBE collected for slot `s` (grow-only). */
function routeSlotDeps(
  list: AnyList,
  frame: EachFrame<unknown>,
  s: number,
): void {
  const item = frame.item;
  let bag = frame.bag;
  if (bag === undefined && item !== null && typeof item === 'object') {
    // the probe itself may have materialized the item's first cell (lazy
    // `@tracked` getters) — refresh the snapshot before classifying
    bag = frame.bag = cellsMap.get(item as object);
  }
  for (const cell of PROBE) {
    if (isItemCell(cell, item, bag)) {
      let cells = frame.itemCells;
      if (cells === null) {
        cells = frame.itemCells = [];
        frame.itemUnsubs = [];
        frame.itemSlots = [];
      }
      if (cells.indexOf(cell) === -1) {
        cells.push(cell);
        let op = frame.itemOp;
        if (op === null) {
          op = frame.itemOp = () => {
            const slots = frame.itemSlots;
            if (slots === null) return;
            for (let i = 0; i < slots.length; i++) {
              runSlot(list, frame, slots[i], false);
            }
          };
        }
        frame.itemUnsubs!.push(subscribeOp(cell, op));
      }
      if (frame.itemSlots!.indexOf(s) === -1) {
        frame.itemSlots!.push(s);
      }
    } else {
      let shared = list.frameShared;
      if (shared === null) {
        shared = list.frameShared = new Map();
      }
      const entry = shared.get(cell);
      if (entry === undefined) {
        const slots: number[] = [s];
        const op: tagOp = () => {
          const frames = list.frames;
          if (frames === null) return;
          for (const f of frames.values()) {
            for (let i = 0; i < slots.length; i++) {
              // `cell` is this entry's own dep — when a re-probe yields
              // exactly it again (the overwhelmingly common stable-dep
              // case), routing is provably already in place and skipped.
              runSlot(list, f, slots[i], false, cell);
            }
          }
        };
        shared.set(cell, { slots, unsub: subscribeOp(cell, op) });
      } else if (entry.slots.indexOf(s) === -1) {
        entry.slots.push(s);
      }
    }
  }
}

/**
 * Apply a computed slot value — per-kind semantics mirror what v1 wires
 * through `$prop` / `$attr` / `$ev(TEXT_CONTENT)`:
 *   static  (first run tracked no cells): the const-collapsed branch —
 *           empty values are skipped, others written raw, never re-run;
 *   text    : `String(value ?? '')`, guarded on the applied string;
 *   class/prop: `null → ''`, first-run `undefined` skipped (the
 *           `prevPropValue` quirk), `style`-empty removes the attribute;
 *   attr    : initial run always writes (opcodeFor's immediate evaluation
 *           parity), re-runs guarded on the raw value.
 */
function applySlot(
  api: DOMApi,
  frame: EachFrame<unknown>,
  s: number,
  slot: StaticBlockSlot,
  value: unknown,
  initial: boolean,
  isStatic: boolean,
): void {
  const node = frame.nodes[s];
  const kind = slot.k;
  if (kind === 'text') {
    if (isStatic) {
      frame.values[s] = value;
      if (isEmpty(value)) return;
      api.textContent(node, value as string);
      return;
    }
    const str = String(value ?? '');
    if (frame.values[s] === str) return;
    frame.values[s] = str;
    api.textContent(node, str);
  } else if (kind === 'attr') {
    if (isStatic) {
      frame.values[s] = value;
      if (isEmpty(value)) return;
      api.attr(node, slot.n!, value as string);
      return;
    }
    if (!initial && frame.values[s] === value) return;
    frame.values[s] = value;
    api.attr(node, slot.n!, value as string);
  } else {
    // 'class' | 'prop'
    const name = kind === 'class' ? 'className' : slot.n!;
    if (isStatic) {
      frame.values[s] = value;
      if (isEmpty(value)) return;
      api.prop(node, name, value);
      return;
    }
    const val = value === null ? '' : value;
    const prev = frame.values[s] === UNSET ? undefined : frame.values[s];
    if (val === prev) return;
    frame.values[s] = val;
    // mirrors $prop's reactive-style cleanup: an empty style write must not
    // leave a stale `style=""` attribute behind
    if (
      name === 'style' &&
      (val === '' || val === undefined) &&
      (node as HTMLElement).removeAttribute
    ) {
      api.prop(node, name, val);
      if ((node as HTMLElement).getAttribute('style') === '') {
        (node as HTMLElement).removeAttribute('style');
      }
      return;
    }
    api.prop(node, name, val);
  }
}

/**
 * Run one slot: evaluate its thunk under the tracker (probe), route any
 * tracked cells (grow-only), apply with the per-kind guard. The probe is the
 * same mechanism `formula`/`resolveBindingValue` use — a MergedCell read
 * under an active tracker runs its fn() in our frame, so deps flatten to
 * leaf cells.
 */
function runSlot(
  list: AnyList,
  frame: EachFrame<unknown>,
  s: number,
  initial: boolean,
  knownCell?: AnyCell,
): void {
  const slot = list.block!.slots[s];
  const raw = frame.thunks[s];
  let value: unknown;
  let isStatic = false;
  if (isFn(raw) || isTagLike(raw)) {
    const prevTracker = getTracker();
    PROBE.clear();
    setTracker(PROBE);
    try {
      value = isFn(raw) ? deepFnValue(raw) : (raw as AnyCell).value;
    } finally {
      setTracker(prevTracker);
    }
    if (PROBE.size > 0) {
      // sweep fast path: the probe re-found exactly the cell whose op is
      // running — its (cell → slot) routing already exists by construction
      if (
        PROBE.size !== 1 ||
        knownCell === undefined ||
        !PROBE.has(knownCell as Cell)
      ) {
        routeSlotDeps(list, frame, s);
      }
    } else if (initial) {
      isStatic = true;
    }
  } else {
    value = raw;
    isStatic = initial;
  }
  applySlot(list.api, frame, s, slot, value, initial, isStatic);
}

function createFrame(
  list: AnyList,
  item: unknown,
  index: number,
): EachFrame<unknown> {
  const block = list.block!;
  const { root, nodes } = block.cloneFrame(list.api);
  const k = block.slots.length;
  const frame: EachFrame<unknown> = {
    root,
    nodes,
    thunks: list.blockValues!(item, index, list),
    values: new Array(k).fill(UNSET),
    item,
    index,
    itemCells: null,
    itemUnsubs: null,
    itemSlots: null,
    itemOp: null,
    bag:
      item !== null && typeof item === 'object'
        ? cellsMap.get(item as object)
        : undefined,
  };
  for (let s = 0; s < k; s++) {
    runSlot(list, frame, s, true);
  }
  return frame;
}

function unsubscribeFrameItems(frame: EachFrame<unknown>): void {
  const unsubs = frame.itemUnsubs;
  if (unsubs !== null) {
    for (let i = 0; i < unsubs.length; i++) {
      unsubs[i]();
    }
    frame.itemUnsubs = null;
    frame.itemCells = null;
    frame.itemSlots = null;
  }
}

/**
 * Keyed reuse with a ref-swapped item: swap `frame.item`, rebuild the thunks
 * from the new item and re-run every slot (values guards skip unchanged DOM),
 * re-routing the item-dep subscriptions. `itemOp` is reused — it reads the
 * frame's current itemSlots.
 */
function rebindFrame(
  list: AnyList,
  frame: EachFrame<unknown>,
  item: unknown,
  index: number,
): void {
  unsubscribeFrameItems(frame);
  frame.item = item;
  frame.index = index;
  frame.thunks = list.blockValues!(item, index, list);
  frame.bag =
    item !== null && typeof item === 'object'
      ? cellsMap.get(item as object)
      : undefined;
  const k = list.block!.slots.length;
  for (let s = 0; s < k; s++) {
    runSlot(list, frame, s, false);
  }
}

function dropFrame(api: DOMApi, frame: EachFrame<unknown>, removeDom: boolean): void {
  unsubscribeFrameItems(frame);
  if (removeDom) {
    api.destroy(frame.root);
  }
}

/**
 * Tear down every frame. Bulk-clears the parent DOM (O(1) innerHTML='') when
 * this list owns it end-to-end — the same guard `fastCleanup` uses — falling
 * back to per-root removal otherwise. Frame teardown is just "run the
 * unsubs": frame rows have no modifiers/components, so no destructor cascade
 * exists to run.
 */
export function clearAllFrames(list: AnyList): void {
  const frames = list.frames;
  if (frames === null || frames.size === 0) return;
  const api = list.api;
  const { topMarker, bottomMarker } = list;
  const parent = api.parent(bottomMarker);
  const bulk =
    parent !== null &&
    parent.lastChild === bottomMarker &&
    parent.firstChild === topMarker;
  if (bulk) {
    api.clearChildren(parent);
    api.insert(parent, topMarker);
    api.insert(parent, bottomMarker);
  }
  for (const frame of frames.values()) {
    dropFrame(api, frame, !bulk);
  }
  frames.clear();
}

/**
 * Full frame-state teardown for the LIST's own destruction: frames + the
 * list-level shared-dep subscriptions. Idempotent (the list destructor and
 * the `syncList([])` teardown destructor can both reach it).
 */
export function destroyFrameState(list: AnyList): void {
  clearAllFrames(list);
  const shared = list.frameShared;
  if (shared !== null) {
    for (const entry of shared.values()) {
      entry.unsub();
    }
    shared.clear();
    list.frameShared = null;
  }
}

/**
 * The frame-mode keyed sync (replaces updateItems/fastCleanup/destroyItem for
 * frame lists). Same observable keyed semantics as v1: position-qualified
 * duplicate keys (via the list's own `keyForItem`), removals before
 * insertions, LIS-minimal relocation, append/replace/clear fast paths.
 * Inverse rendering stays with the caller (the subclass syncList wrappers).
 */
export function syncFrames<T extends { id: number }>(
  list: BasicListComponent<T>,
  items: T[],
): void {
  return syncFramesAny(list, items);
}

function syncFramesAny(list: AnyList, items: unknown[]): void {
  const api = list.api;
  const bottomMarker = list.bottomMarker;
  let frames = list.frames;
  if (frames === null) {
    frames = list.frames = new Map();
  }
  if (list.isFirstRender) {
    list.isFirstRender = false;
  }
  const n = items.length;

  // ----- clear
  if (n === 0) {
    clearAllFrames(list);
    return;
  }

  const keyForItem = list.keyForItem;

  // ----- pass 1: keys (position-qualified for duplicates by keyForItem)
  KEYS.length = n;
  KEYSET.clear();
  for (let i = 0; i < n; i++) {
    const key = keyForItem(items[i], i, items);
    KEYS[i] = key;
    KEYSET.add(key);
  }

  // ----- pass 2: removals (bulk when EVERY existing row goes away)
  if (frames.size > 0) {
    let survivors = 0;
    for (const key of frames.keys()) {
      if (KEYSET.has(key)) survivors++;
    }
    if (survivors === 0) {
      clearAllFrames(list);
    } else if (survivors < frames.size) {
      for (const [key, frame] of frames) {
        if (!KEYSET.has(key)) {
          dropFrame(api, frame, true);
          frames.delete(key);
        }
      }
    }
  }

  // ----- fresh render: batch every row through one fragment insert
  if (frames.size === 0) {
    const fragment = api.fragment();
    for (let i = 0; i < n; i++) {
      const frame = createFrame(list, items[i], i);
      frames.set(KEYS[i], frame);
      api.insert(fragment, frame.root);
    }
    const parent = api.parent(bottomMarker);
    if (parent !== null) {
      api.insert(parent, fragment, bottomMarker);
    }
    KEYS.length = 0;
    return;
  }

  // ----- pass 3: create/rebind + collect existing-row order for LIS
  EXIST_KEYS.length = 0;
  EXIST_OLD.length = 0;
  EXIST_NEW.length = 0;
  for (let i = 0; i < n; i++) {
    const key = KEYS[i];
    const frame = frames.get(key);
    if (frame === undefined) {
      // built now, inserted by the move phase below (root not yet connected)
      frames.set(key, createFrame(list, items[i], i));
    } else {
      if (frame.item !== items[i]) {
        rebindFrame(list, frame, items[i], i);
      }
      EXIST_KEYS.push(key);
      EXIST_NEW.push(i);
      EXIST_OLD.push(frame.index);
      frame.index = i;
    }
  }

  // ----- LIS over the existing rows' old indices (new-list order): only
  // rows OUTSIDE the longest stable subsequence relocate.
  MOVE.clear();
  if (EXIST_KEYS.length > 1) {
    const stable = longestIncreasingSubsequence(EXIST_OLD, LIS_OUT);
    for (let j = 0; j < EXIST_KEYS.length; j++) {
      if (!stable.has(j)) {
        MOVE.add(EXIST_KEYS[j]);
      }
    }
  } else if (EXIST_KEYS.length === 1 && EXIST_OLD[0] !== EXIST_NEW[0]) {
    MOVE.add(EXIST_KEYS[0]);
  }

  // ----- move phase: right-to-left anchor walk; relocation moves frame.root
  // directly (single node — no marker-extent fragment collection).
  const parent = api.parent(bottomMarker);
  let anchor: Node = bottomMarker;
  for (let i = n - 1; i >= 0; i--) {
    const frame = frames.get(KEYS[i])!;
    const root = frame.root;
    if (root.parentNode === null) {
      // fresh row
      if (parent !== null) api.insert(parent, root, anchor);
    } else if (MOVE.has(KEYS[i]) && root.nextSibling !== anchor) {
      if (parent !== null) api.insert(parent, root, anchor);
    }
    anchor = root;
  }
  KEYS.length = 0;
}
