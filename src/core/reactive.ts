/*
  This is a proof of concept for a new approach to reactive programming.
  It's related to Glimmer-VM's `@tracked` system, but without invalidation step.
  We explicitly update DOM only when it's needed and only if tags are changed.
*/
import { scheduleRevalidate } from '@/core/runtime';
import { isFn, isTag, isTagLike, debugContext } from '@/core/shared';
import { AdaptivePool, config } from '@/core/config';

// Async opcode support — tree-shaken when ASYNC_COMPILE_TRANSFORMS is false
const asyncOpcodes = new WeakSet<tagOp>();
let hasAnyAsyncOpcodes = false;

export function hasAsyncOpcodes() {
  return ASYNC_COMPILE_TRANSFORMS && hasAnyAsyncOpcodes;
}

export function markOpcodeAsync(op: tagOp) {
  if (ASYNC_COMPILE_TRANSFORMS) {
    asyncOpcodes.add(op);
    hasAnyAsyncOpcodes = true;
  }
}
// List of DOM operations for each tag
export const opsForTag: Map<
  number,
  Array<tagOp>
> = new Map();
// REVISION replacement, we use a set of tags to revalidate
export const tagsToRevalidate: Set<Cell> = new Set();
// List of derived tags for each cell
export const relatedTags: Map<number, Set<MergedCell>> = new Map();

// Adaptive pool for ops arrays with automatic growth/shrink
const opsPool = new AdaptivePool<Array<tagOp>>(
  config.opsArrayPool,
  () => [],
  (arr) => { arr.length = 0; },
);

function getOpArray(): Array<tagOp> {
  return opsPool.acquire();
}

export function releaseOpArray(arr: Array<tagOp>) {
  opsPool.release(arr);
}

export const DEBUG_MERGED_CELLS = new Set<MergedCell>();
export const DEBUG_CELLS = new Set<Cell>();
var currentTracker: Set<Cell> | null = null;
let _isRendering = false;

// Monotonic revision counter bumped on every Cell.update(), used by cached()
// to detect whether any dependency has changed since last compute.
let _globalRevision = 0;
export function currentGlobalRevision() {
  return _globalRevision;
}
export function bumpGlobalRevision() {
  return ++_globalRevision;
}
export const cellsMap = new WeakMap<
  object,
  Map<string | number | symbol, Cell<unknown>>
>();

export function getCells() {
  return Array.from(DEBUG_CELLS);
}
export function getMergedCells() {
  return Array.from(DEBUG_MERGED_CELLS);
}

if (IS_DEV_MODE) {
  if (!import.meta.env.SSR) {
    window['getVM'] = () => ({
      relatedTags,
      tagsToRevalidate,
      opsForTag,
    });
  }
}

function keysFor(obj: object): Map<string | number | symbol, Cell<unknown>> {
  let map = cellsMap.get(obj);
  if (map === undefined) {
    map = new Map();
    cellsMap.set(obj, map);
  }
  return map!;
}

export function tracked(
  klass: any,
  key: string,
  descriptor?: PropertyDescriptor & { initializer?: () => any },
): void {
  let hasInitializer = typeof descriptor?.initializer === 'function';
  return {
    get() {
      const keys = keysFor(this);
      if (!keys.has(key)) {
        const value: any = cell(
          hasInitializer
            ? descriptor!.initializer?.call(this)
            : descriptor?.value,
          `${klass.constructor.name}.${key}.@tracked`,
        );
        keys.set(key, value);
        return value.value;
      } else {
        return keys.get(key)!.value;
      }
    },
    set(newValue: any) {
      const keys = keysFor(this);
      if (!keys.has(key)) {
        keys.set(
          key,
          cell(newValue, `${klass.constructor.name}.${key}.@tracked`),
        );
        return;
      }
      const _cell = keys.get(key)!;
      if (_cell.value === newValue) {
        return;
      }
      _cell.update(newValue);
    },
    enumerable: descriptor?.enumerable ?? true,
    configurable: descriptor?.configurable ?? true,
  } as unknown as void;
}
// we have only 2 types of cells
export type AnyCell = Cell | MergedCell;

export function isRendering() {
  return _isRendering;
}
export function setIsRendering(value: boolean) {
  _isRendering = value;
}

function tracker() {
  return new Set<Cell>();
}
// "data" cell, it's value can be updated, and it's used to create derived cells
export class Cell<T extends unknown = unknown> {
  private __value!: T;
  id = tagId++;
  // per-cell revision; bumped each time update() is called.
  // cached() uses this to decide whether a dependency has changed.
  _revision = 0;
  declare toHTML: () => string;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  [isTag] = true;
  constructor(value: T, debugName?: string) {
    this.__value = value;
    if (IS_DEV_MODE) {
      this._debugName = debugContext(debugName);
      DEBUG_CELLS.add(this);
    }
  }
  // Use accessor so LazyCell can override
  get _value(): T {
    return this.__value;
  }
  set _value(v: T) {
    this.__value = v;
  }
  get value() {
    if (currentTracker !== null) {
      currentTracker.add(this);
    }
    return this._value;
  }
  set value(value: T) {
    this.update(value);
  }
  update(value: T) {
    // Value-equality guard for revision bumps. Downstream `cached()` uses
    // `_revision` to detect dep invalidation; bumping it on a no-op write
    // (e.g., Ember's sync layer reapplying the same arg) would cause
    // spurious recomputes within a single render pass. We still schedule
    // revalidation to preserve observable side-effect semantics — callers
    // that update() a cell explicitly expect the opcode queue to flush.
    const changed = this._value !== value;
    this._value = value;
    if (changed) {
      this._revision = bumpGlobalRevision();
    }
    tagsToRevalidate.add(this);
    scheduleRevalidate();
  }
}

export class LazyCell<T extends unknown = unknown> extends Cell<T> {
  private __isResolved = false;
  private __lazyValue!: T;
  private __fn: () => T;

  constructor(fn: () => T, debugName?: string) {
    // @ts-expect-error - we initialize lazily
    super(undefined, debugName);
    this.__fn = fn;
  }

  override get _value(): T {
    if (!this.__isResolved) {
      this.__lazyValue = this.__fn();
      this.__isResolved = true;
    }
    return this.__lazyValue;
  }

  override set _value(v: T) {
    this.__lazyValue = v;
    this.__isResolved = true;
  }
}
export function listDependentCells(cells: Array<AnyCell>, cell: MergedCell) {
  const msg = [cell._debugName, 'depends on:'];
  cells.forEach((cell) => {
    msg.push(cell._debugName);
  });
  return msg.join(' ');
}

export function opsFor(cell: AnyCell) {
  let ops = opsForTag.get(cell.id);
  if (ops === undefined) {
    ops = getOpArray();
    opsForTag.set(cell.id, ops);
  }
  return ops;
}

export function relatedTagsForCell(cell: Cell) {
  let tags = relatedTags.get(cell.id);
  if (tags === undefined) {
    tags = new Set<MergedCell>();
    relatedTags.set(cell.id, tags);
  }
  return tags;
}

function bindAllCellsToTag(cells: Set<Cell>, tag: MergedCell) {
  cells.forEach((cell) => {
    const tags = relatedTagsForCell(cell);
    tags.add(tag);
    if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync && tag._debugName?.includes('if-condition')) {
      console.log('[BIND] cell.id=' + cell.id + ' → formula=' + tag._debugName + ' (id=' + tag.id + ')');
    }
  });
}

// "derived" cell, it's value is calculated from other cells, and it's value can't be updated
let tagId = 0;

export function getTagId() {
  return tagId;
}

export function tagsFromRange(start: number, end: number = getTagId()) {
  const tags: Array<Cell> = [];
  DEBUG_CELLS.forEach((cell) => {
    if (cell.id >= start && cell.id <= end) {
      tags.push(cell);
    }
  });
  return tags;
}
export class MergedCell {
  fn: Fn | Function;
  declare toHTML: () => string;
  isConst: boolean = false;
  isDestroyed = false;
  id = tagId++;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  relatedCells: Set<Cell> | null = null;
  [isTag] = true;
  constructor(fn: Fn | Function, debugName?: string) {
    this.fn = fn;
    if (IS_DEV_MODE) {
      this._debugName = debugContext(debugName);
      DEBUG_MERGED_CELLS.add(this);
    }
  }
  destroy() {
    this.isDestroyed = true;
    opsForTag.delete(this.id);
    if (this.relatedCells !== null) {
      this.relatedCells.forEach((cell) => {
        const related = relatedTags.get(cell.id);
        if (related !== undefined) {
          related.delete(this);
          if (related.size === 0) {
            relatedTags.delete(cell.id);
          }
        }
      });
      this.relatedCells.clear();
    }
    if (IS_DEV_MODE) {
      DEBUG_MERGED_CELLS.delete(this);
    }
  }
  get value() {
    if (this.isDestroyed) {
      return;
    }

    if (this.isConst || !_isRendering || currentTracker !== null) {
      // @ts-ignore debug
      if (IS_DEV_MODE && this._debugName?.includes('if-condition') && currentTracker !== null) {
        console.warn('[GXT-TRACK] if-condition formula short-circuited: currentTracker is SET, isRendering=' + _isRendering);
      }
      return this.fn();
    }

    let $tracker!: Set<Cell>;
    try {
      $tracker = tracker();
      setTracker($tracker);
      return this.fn();
    } finally {
      bindAllCellsToTag($tracker, this);
      this.isConst = $tracker.size === 0;
      this.relatedCells = $tracker;
      setTracker(null);
      // @ts-ignore debug
      if (IS_DEV_MODE && this._debugName?.includes('if-condition')) {
        console.log('[GXT-TRACK] if-condition formula tracked ' + $tracker.size + ' cells');
      }
    }
  }
}

// this function is called when we need to update DOM, values represented by tags are changed
export type tagOp = (...values: unknown[]) => Promise<void> | void;

// Shared error handler for executeTag variants — avoids code duplication
function handleOpcodeError(e: any, tag: Cell | MergedCell, opcode: tagOp | null, ops: tagOp[]) {
  if (IS_DEV_MODE) {
    console.error({
      message: 'Error executing tag',
      error: e,
      tag,
      opcode: opcode?.toString(),
    });
  }
  if (opcode) {
    const index = ops.indexOf(opcode);
    if (index > -1) {
      ops.splice(index, 1);
    }
  }
}

function executeTagSyncOps(tag: Cell | MergedCell, ops: tagOp[], value: unknown) {
  if (TRY_CATCH_ERROR_HANDLING) {
    let opcode: tagOp | null = null;
    try {
      for (let i = 0; i < ops.length; i++) {
        opcode = ops[i];
        opcode(value);
      }
    } catch (e: any) {
      handleOpcodeError(e, tag, opcode, ops);
    }
  } else {
    for (let i = 0; i < ops.length; i++) {
      ops[i](value);
    }
  }
}

async function executeTagAsyncOps(tag: Cell | MergedCell, ops: tagOp[], value: unknown) {
  if (TRY_CATCH_ERROR_HANDLING) {
    let opcode: tagOp | null = null;
    try {
      for (let i = 0; i < ops.length; i++) {
        opcode = ops[i];
        if (asyncOpcodes.has(opcode)) {
          await opcode(value);
        } else {
          opcode(value);
        }
      }
    } catch (e: any) {
      handleOpcodeError(e, tag, opcode, ops);
    }
  } else {
    let opcode: tagOp | null = null;
    for (let i = 0; i < ops.length; i++) {
      opcode = ops[i];
      if (asyncOpcodes.has(opcode)) {
        await opcode(value);
      } else {
        opcode(value);
      }
    }
  }
}

/**
 * Executes all opcodes for a tag.
 *
 * `awaitAsync = false` is the synchronous fast path with no Promise allocation.
 * `awaitAsync = true` preserves async opcode semantics and awaits marked async ops.
 */
export function executeTag(tag: Cell | MergedCell, awaitAsync: true): Promise<void>;
export function executeTag(tag: Cell | MergedCell, awaitAsync: false): void;
export function executeTag(tag: Cell | MergedCell, awaitAsync?: boolean): Promise<void> | void;
export function executeTag(tag: Cell | MergedCell, awaitAsync = true): Promise<void> | void {
  const ops = opsFor(tag);
  const value = tag.value;
  if (awaitAsync) {
    return executeTagAsyncOps(tag, ops, value);
  }
  executeTagSyncOps(tag, ops, value);
}

// Backward-compatible alias. Kept so existing imports continue to work.
export function executeTagSync(tag: Cell | MergedCell) {
  executeTag(tag, false);
}
export function lazyRawCellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  init?: () => T[K],
): Cell<T[K]> {
  const refs = cellsMap.get(obj) || new Map<string | number | symbol, Cell>();
  if (refs.has(key)) {
    return refs.get(key) as Cell<T[K]>;
  }
  // make value lazy
  const cellValue = new LazyCell<T[K]>(
    () => (typeof init === 'function' ? init() : obj[key]),
    `${obj.constructor.name}.${String(key)}`,
  );
  refs.set(key, cellValue);
  cellsMap.set(obj, refs);
  return cellValue as unknown as Cell<T[K]>;
}
export function rawCellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Cell<T[K]> {
  let refs = cellsMap.get(obj);
  if (refs === undefined) {
    refs = new Map<string | number | symbol, Cell>();
    cellsMap.set(obj, refs);
  }
  if (refs.has(key)) {
    return refs.get(key) as Cell<T[K]>;
  }
  const cellValue = new Cell<T[K]>(
    obj[key],
    `${obj.constructor.name}.${String(key)}`,
  );
  refs.set(key, cellValue);
  return cellValue;
}

// this is function to create a reactive cell from an object property
export function cellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  skipDefine = false,
): Cell<T[K]> {
  // make value lazy
  const cellValue = rawCellFor(obj, key);
  if (skipDefine) {
    return cellValue;
  }
  try {
    Object.defineProperty(obj, key, {
      get() {
        return cellValue.value;
      },
      set(val) {
        cellValue.update(val);
      },
      enumerable: true,
      configurable: true,
    });
  } catch (e) {
    if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
      console.error('[CELLFOR] defineProperty failed for ' + String(key) + ':', (e as Error).message);
    }
  }
  return cellValue;
}

type Fn = () => unknown;

export function formula(fn: Function | Fn, debugName?: string) {
  return new MergedCell(fn, IS_DEV_MODE ? `formula:${debugName ?? 'unknown'}` : undefined);
}

/**
 * `cached(fn)` — memoizing derivation.
 *
 * Like `formula(fn)` but records the last computed value and the set of tracked
 * cells observed during that computation. A subsequent `value` read returns the
 * cached value as long as none of those cells has bumped its `_revision` since
 * the last compute. When the observed deps are dirty, the underlying fn() is
 * re-executed exactly once, freshly collecting deps.
 *
 * The returned object is tag-like: it participates in GXT's tracker frames, so
 * a parent formula that reads `cached.value` still records a dependency on the
 * underlying cells (we re-add them to the ambient tracker on every read).
 */
export interface CachedCell<T = unknown> {
  readonly value: T;
  readonly tag: MergedCell;
  invalidate(): void;
  [isTag]: true;
}
export function cached<T>(fn: () => T, debugName?: string): CachedCell<T> {
  const tag = new MergedCell(fn as Fn, IS_DEV_MODE ? `cached:${debugName ?? 'unknown'}` : undefined);
  let hasValue = false;
  let lastValue: T;
  let lastDeps: Set<Cell> | null = null;
  // Per-dep revision snapshot taken when we last ran fn().
  let lastDepRevisions: Map<number, number> | null = null;
  // Global revision at time of last compute. If the global has advanced,
  // SOMETHING has changed (not necessarily a dep we captured). For pure
  // getters that read through non-tracked paths (arrays, plain objects),
  // dep-only invalidation can miss mutations. Treating any global advance
  // as potentially-stale keeps semantics correct while still suppressing
  // same-epoch (no-update) repeats — exactly what fixes VM priming spikes.
  let lastGlobalRevisionAtCompute = -1;

  function isClean(): boolean {
    if (!hasValue || lastDeps === null || lastDepRevisions === null) return false;
    // Fast path: nothing in the whole system has updated since compute.
    if (_globalRevision === lastGlobalRevisionAtCompute) return true;
    // Some cell updated — be conservative unless we can prove our deps
    // are all unchanged. When the tracker captured nothing (lastDeps empty)
    // we cannot prove correctness for getters reading raw (non-tracked)
    // state; recompute.
    if (lastDeps.size === 0) return false;
    for (const cell of lastDeps) {
      const prev = lastDepRevisions.get(cell.id);
      if (prev === undefined || cell._revision !== prev) return false;
    }
    return true;
  }

  function recompute(): T {
    // Re-run fn() with a fresh tracker so we can snapshot the real deps.
    // We also forward all collected deps into the ambient tracker so any
    // parent formula that triggered us still records them — otherwise a
    // parent formula whose only dep flows through this cached() would
    // become const and never re-run.
    const priorTracker = currentTracker;
    const localTracker: Set<Cell> = new Set();
    setTracker(localTracker);
    let value: T;
    try {
      value = (tag.fn as () => T)();
    } finally {
      setTracker(priorTracker);
      if (priorTracker !== null) {
        localTracker.forEach((cell) => priorTracker.add(cell));
      }
    }
    // Bind to MergedCell so opcode invalidation paths stay consistent with
    // a plain formula (downstream relatedTags machinery keeps working).
    if (localTracker.size > 0) {
      bindAllCellsToTag(localTracker, tag);
    }
    tag.isConst = localTracker.size === 0;
    tag.relatedCells = localTracker;
    // Snapshot revisions so we can detect staleness cheaply on next read.
    const snapshot = new Map<number, number>();
    localTracker.forEach((cell) => snapshot.set(cell.id, cell._revision));
    lastDeps = localTracker;
    lastDepRevisions = snapshot;
    lastGlobalRevisionAtCompute = _globalRevision;
    lastValue = value;
    hasValue = true;
    return value;
  }

  const self: CachedCell<T> = {
    // marker so isTagLike() treats this like a cell-ish thing if needed
    [isTag]: true,
    get tag() {
      return tag;
    },
    invalidate() {
      hasValue = false;
      lastDeps = null;
      lastDepRevisions = null;
    },
    get value(): T {
      // Replay known deps into the ambient tracker so outer formulas still
      // depend on the underlying cells even when we short-circuit with the
      // cache. This preserves invalidation semantics for parents.
      if (currentTracker !== null && lastDeps !== null && lastDeps.size > 0) {
        lastDeps.forEach((cell) => currentTracker!.add(cell));
      }
      if (isClean()) {
        return lastValue;
      }
      return recompute();
    },
  };
  return self;
}

export function deepFnValue(fn: Function | Fn) {
  const cell = fn();
  if (isFn(cell)) {
    return deepFnValue(cell);
  } else if (typeof cell === 'object' && cell !== null && isTagLike(cell)) {
    return cell.value;
  } else {
    return cell;
  }
}

export function cell<T>(value: T, debugName?: string) {
  return new Cell(value, debugName);
}

export function inNewTrackingFrame(callback: () => void) {
  const existingTracker = currentTracker;
  setTracker(null);
  try {
    callback();
  } finally {
    setTracker(existingTracker);
  }
}

export function getTracker() {
  return currentTracker;
}
export function setTracker(tracker: Set<Cell> | null) {
  currentTracker = tracker;
}

// Side-effect: patch Map/Set prototypes so iteration and mutation
// participate in reactive tracking. Imported here (rather than from a
// top-level entry file) so that *any* module which reaches reactive.ts
// automatically gets Map/Set reactivity. Idempotent — safe under HMR
// and multiple realm entry points.
// Placed at the bottom to avoid temporal-dead-zone issues with
// `cell` / `getTracker`, which reactive-collections.ts depends on.
import '@/core/reactive-collections';
