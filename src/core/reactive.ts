/*
  This is a proof of concept for a new approach to reactive programming.
  It's related to Glimmer-VM's `@tracked` system, but without invalidation step.
  We explicitly update DOM only when it's needed and only if tags are changed.
*/
import { scheduleRevalidate } from '@/core/runtime';
import { isFn, isTag, isTagLike, debugContext } from '@/core/shared';
import { AdaptivePool, config } from '@/core/config';
import { HOST_HOOKS } from '@/core/host-hooks';

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
  // Optional back-reference to the (object, key) this cell was created for via
  // `rawCellFor`. Lets a host (Ember's fine-grained capture path) reverse a
  // captured cell to its owner so it can register value→owner mappings for
  // nested-object subscription. Purely metadata — never read by update().
  _relatedObj?: object;
  _relatedKey?: string | number | symbol;
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
    // Optional host-registered defer hook.
    // The hook lets an integration (e.g. Ember) take ownership of Cell.update
    // work and queue it for later application from inside the host's drain
    // phase (e.g. runloop end). When no hook is registered, behavior is
    // identical to the pre-hook code path. The hook MUST return `true` if it
    // accepted ownership (in which case it is responsible for eventually
    // calling `applyDeferredCellUpdate(this, value)` to actually mutate the
    // cell), or `false` to fall through to the synchronous path below.
    // The hook MUST NOT throw — throws are caught and logged in DEV.
    if (_cellUpdateDeferralHook !== null) {
      let accepted = false;
      try {
        accepted = _cellUpdateDeferralHook(
          this as unknown as Cell<unknown>,
          value as unknown,
        );
      } catch (hookErr) {
        if (IS_DEV_MODE) {
          console.error('CellUpdateDeferralHook threw:', hookErr);
        }
      }
      if (accepted) {
        return;
      }
    }
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

/**
 * Synchronously run a cell's own opcodes and the opcodes of every formula that
 * depends on it. Intended for hosts (Ember's fine-grained sync) that update a
 * cell from INSIDE the current `syncDomSync` drain — at that point the drain
 * has already snapshotted its work list and its terminal `tagsToRevalidate`
 * clear would otherwise discard the just-dirtied cell, so its bound DOM (e.g. a
 * `{{this.salutation}}` text node) would never re-render this tick. This flushes
 * those opcodes immediately. The related-tag set for the cell is consumed
 * (deleted) the same way the normal drain consumes it, so a subsequent drain
 * does not double-execute. A single bad binding can't abort the flush, but its
 * error is surfaced to the host via the opcode-error reporter (NOT swallowed).
 */
export function flushCellOpcodes(cell: Cell | MergedCell): void {
  // Only execute the cell's own opcodes when it actually has some — for cells
  // that exist purely as subscription targets (selector key cells, recycle
  // holder cells) an unguarded executeTagSync would MATERIALIZE an empty
  // pooled ops array into the global opsForTag map per flush.
  const ownOps = opsForTag.get((cell as Cell).id);
  if (ownOps !== undefined && ownOps.length > 0) {
    try {
      executeTagSync(cell);
    } catch (e) {
      // Don't abort the flush, but report to the host (mirrors the normal
      // drain's handleOpcodeError reporter path) rather than silently
      // swallowing.
      reportOpcodeError(e, cell);
    }
  }
  const subTags = relatedTags.get((cell as Cell).id);
  if (subTags === undefined) {
    return;
  }
  relatedTags.delete((cell as Cell).id);
  const ordered = [...subTags];
  subTags.clear();
  if (ordered.length > 1) {
    ordered.sort((a, b) => a.id - b.id);
  }
  for (const tag of ordered) {
    try {
      executeTagSync(tag);
    } catch (e) {
      reportOpcodeError(e, tag);
    }
  }
}

/**
 * Apply a cell update synchronously and deliver it to subscribers NOW.
 *
 * The drain-safe sibling of `Cell.update()`: a plain `update()` issued from
 * inside an active `syncDomSync` lands in `tagsToRevalidate` after the drain
 * snapshotted its work list, so the terminal clear silently drops it. This
 * helper instead:
 *   - mutates `_value`/`_revision` directly, BYPASSING the host
 *     `_cellUpdateDeferralHook` (a deferred apply would leave `_value` stale
 *     while the caller immediately re-executes subscribers against it);
 *   - removes the cell from `tagsToRevalidate` so an in-flight drain doesn't
 *     double-execute it;
 *   - flushes its opcodes + subscriber formulas via `flushCellOpcodes` under
 *     `_isRendering` — REQUIRED: `MergedCell.value` only re-collects deps on
 *     the tracking path, so flushing while not rendering would permanently
 *     unsubscribe every re-executed formula.
 *
 * Used by `keyedSelector` key-cell flips and the recycle-mode holder swap in
 * the list control flow. No-op when the value is reference-equal.
 */
export function applyCellUpdateSync<T>(cell: Cell<T>, value: T): void {
  if (cell._value === value) {
    return;
  }
  cell._value = value;
  cell._revision = bumpGlobalRevision();
  tagsToRevalidate.delete(cell as Cell<unknown>);
  const wasRendering = _isRendering;
  if (!wasRendering) setIsRendering(true);
  try {
    flushCellOpcodes(cell);
  } finally {
    if (!wasRendering) setIsRendering(false);
  }
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

    // Reuse this formula's existing `relatedCells` Set as the tracker buffer
    // when one is already present. A reactive binding's formula has its
    // `.value` read TWICE on create while `_isRendering` is true (once for the
    // const-check in `resolveBindingValue`/`resolveRenderable`, then again by
    // the binding opcode's own render-time read in `evaluateOpcode`). The first
    // read allocated `relatedCells`; the second read would otherwise allocate a
    // fresh Set and replace it, making the first Set transient garbage. Clearing
    // and refilling the SAME Set recycles it across reads (one fewer Set
    // allocation per reactive binding per row). Behavior-preserving: the final
    // `relatedCells` content is identical, and `bindAllCellsToTag` re-adds `this`
    // to each tracked cell's subscriber set idempotently (this path never
    // unbound dropped deps before either — a re-read with stable deps re-adds
    // the same cells).
    let $tracker = this.relatedCells;
    if ($tracker === null) {
      $tracker = tracker();
    } else {
      $tracker.clear();
    }
    try {
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

// Host-registerable error reporter. Hosts (e.g. the Ember integration) call
// `setOpcodeErrorReporter` once at module init to receive opcode errors that
// would otherwise be silently dropped. The reporter MUST NOT throw; if it
// does, the throw is caught and logged in DEV.
export type OpcodeErrorReporter = (
  error: unknown,
  context: { tag: Cell | MergedCell; opcode: tagOp | null },
) => void;

let _opcodeErrorReporter: OpcodeErrorReporter | null = null;

export function setOpcodeErrorReporter(reporter: OpcodeErrorReporter | null): void {
  _opcodeErrorReporter = reporter;
}

// Host-registerable Cell.update deferral hook.
// Hosts (e.g. the Ember integration) call `setCellUpdateDeferralHook` once at
// module init to take ownership of `Cell.update` work and defer it to a host-
// owned drain phase (e.g. runloop end). The hook receives the target cell and
// the proposed new value, and MUST return:
//   * `true` — hook accepted ownership; the synchronous `Cell.update` path is
//     skipped. The hook is responsible for eventually calling
//     `applyDeferredCellUpdate(cell, value)` to actually mutate the cell.
//   * `false` — hook declined; `Cell.update` falls through to the existing
//     synchronous path (mutate + bump revision + schedule revalidation).
// The hook MUST NOT throw; throws are caught and logged in DEV, and the
// synchronous fallback path runs.
// When no hook is registered (default), `Cell.update` behavior is unchanged.
export type CellUpdateDeferralHook = (
  cell: Cell<unknown>,
  newValue: unknown,
) => boolean;

let _cellUpdateDeferralHook: CellUpdateDeferralHook | null = null;

export function setCellUpdateDeferralHook(
  hook: CellUpdateDeferralHook | null,
): void {
  _cellUpdateDeferralHook = hook;
}

/**
 * Apply a deferred cell update from the host's drain phase.
 *
 * Mirrors the synchronous body of `Cell.update` (mutate value + bump revision
 * when changed + enqueue for revalidation + schedule), but bypasses the
 * deferral-hook check so it can be called from inside the hook's queue
 * flusher without re-entering the hook (which would loop).
 *
 * The host owns the queue of `(cell, value)` pairs. This function exposes the
 * primitive that applies a single pair. Typical host pattern:
 *
 *   setCellUpdateDeferralHook((cell, value) => {
 *     hostQueue.push([cell, value]);
 *     scheduleHostDrain();
 *     return true;
 *   });
 *
 *   function drain() {
 *     while (hostQueue.length) {
 *       const [cell, value] = hostQueue.shift()!;
 *       applyDeferredCellUpdate(cell, value);
 *     }
 *   }
 */
export function applyDeferredCellUpdate(
  cell: Cell<unknown>,
  value: unknown,
): void {
  // Same body as Cell.update's synchronous path, intentionally without the
  // deferral-hook check (the hook is the CALLER here — re-entering it would
  // loop forever).
  const changed = cell._value !== value;
  cell._value = value;
  if (changed) {
    cell._revision = bumpGlobalRevision();
  }
  tagsToRevalidate.add(cell);
  scheduleRevalidate();
}

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
  if (_opcodeErrorReporter !== null) {
    try {
      _opcodeErrorReporter(e, { tag, opcode });
    } catch (reporterErr) {
      if (IS_DEV_MODE) {
        console.error('OpcodeErrorReporter threw:', reporterErr);
      }
    }
  }
}

// Surface an opcode error from a context that has no `ops` array to splice
// (e.g. the synchronous `flushCellOpcodes` path). Dev-logs and forwards to the
// host reporter; never throws. Keeps flush errors from being silently dropped.
function reportOpcodeError(e: any, tag: Cell | MergedCell): void {
  if (IS_DEV_MODE) {
    console.error({ message: 'Error executing tag (flush)', error: e, tag });
  }
  if (_opcodeErrorReporter !== null) {
    try {
      _opcodeErrorReporter(e, { tag, opcode: null });
    } catch (reporterErr) {
      if (IS_DEV_MODE) {
        console.error('OpcodeErrorReporter threw:', reporterErr);
      }
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
  let refs = cellsMap.get(obj);
  if (refs === undefined) {
    refs = new Map<string | number | symbol, Cell>();
    cellsMap.set(obj, refs);
  } else {
    const existing = refs.get(key);
    if (existing !== undefined) {
      return existing as Cell<T[K]>;
    }
  }
  // make value lazy
  const cellValue = new LazyCell<T[K]>(
    () => (typeof init === 'function' ? init() : obj[key]),
    `${obj.constructor.name}.${String(key)}`,
  );
  refs.set(key, cellValue);
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
  } else {
    // Single .get() instead of has()+get() — Cell instances are never falsy,
    // and cellFor is on the per-property hot path during template setup.
    const existing = refs.get(key);
    if (existing !== undefined) {
      return existing as Cell<T[K]>;
    }
  }
  const cellValue = new Cell<T[K]>(
    obj[key],
    // `obj.constructor` is undefined for `Object.create(null)` — guard it so
    // null-proto objects (e.g. Ember's `it can read from a null object`
    // dynamic-content case) don't throw during cell creation.
    `${(obj as any).constructor?.name ?? 'NullProto'}.${String(key)}`,
  );
  // Record the owner so hosts can reverse a captured cell back to (obj, key).
  cellValue._relatedObj = obj;
  cellValue._relatedKey = key;
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
 * Both `cached.value` (public) and the inner MergedCell's `value` (invoked by
 * `executeTag` during DOM sync) route through the same memoized path, so the
 * user getter runs at most once per dep-revision epoch even when the sync
 * pipeline re-executes the tag directly.
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
  let hasValue = false;
  let lastValue: T;
  // Per-dep revision snapshot taken when we last ran fn(), keyed by the dep
  // CELL OBJECT (not cell.id): the map doubles as the cache's own dep set for
  // the clean-read resubscription below and the parent-tracker replay in
  // `self.value`. Deliberately a SEPARATE container from `tag.relatedCells` —
  // MergedCell.value reuses/clears `relatedCells` in place as its tracker
  // buffer, so sharing one Set would wipe the cache's dep bookkeeping right
  // before a clean read needs it.
  let lastDepRevisions: Map<Cell, number> | null = null;
  // Global revision at time of last compute. If the global has advanced,
  // SOMETHING has changed (not necessarily a dep we captured). For pure
  // getters that read through non-tracked paths (arrays, plain objects),
  // dep-only invalidation can miss mutations. Treating any global advance
  // as potentially-stale keeps semantics correct while still suppressing
  // same-epoch (no-update) repeats — exactly what fixes VM priming spikes.
  let lastGlobalRevisionAtCompute = -1;
  // The inner MergedCell's fn is a THUNK through readCached() so that if
  // the sync-DOM path invokes tag.value directly (executeTag during
  // scheduleRevalidate), we still go through our cache instead of running
  // the user getter an extra time. The thunk is created after readCached
  // is declared; we use `readThunk` as a late binding.
  let readThunk!: () => T;
  const tag = new MergedCell(() => readThunk(), IS_DEV_MODE ? `cached:${debugName ?? 'unknown'}` : undefined);

  function isClean(): boolean {
    if (!hasValue || lastDepRevisions === null) return false;
    // Fast path: nothing in the whole system has updated since compute.
    if (_globalRevision === lastGlobalRevisionAtCompute) return true;
    // Something moved — if any captured dep's per-cell revision has advanced,
    // the cached value may be stale. Treating zero-dep captures as stale is
    // a safety net for getters that read raw (non-tracked) state.
    if (lastDepRevisions.size === 0) return false;
    for (const [cell, prev] of lastDepRevisions) {
      if (cell._revision !== prev) return false;
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
      value = fn();
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
    const snapshot = new Map<Cell, number>();
    localTracker.forEach((cell) => snapshot.set(cell, cell._revision));
    lastDepRevisions = snapshot;
    lastGlobalRevisionAtCompute = _globalRevision;
    lastValue = value;
    hasValue = true;
    return value;
  }

  // Called both by self.value (cached read) and by the MergedCell's
  // own value getter (via executeTag during syncDom). Routing both through
  // a single cache-first function prevents the user getter from running
  // an extra time when the sync path invokes tag.value directly.
  function readCached(): T {
    if (isClean()) {
      // Re-establish subscriptions before serving the memoized value. The
      // drain and flushCellOpcodes CONSUME (clear) a dirty cell's subscriber
      // set and then re-execute the subscribed tags; a plain formula re-adds
      // itself via its tracking frame, but this clean path used to return
      // without touching the dep cells — leaving the tag PERMANENTLY
      // unsubscribed (a same-value cell.update() triggers exactly that: the
      // set is consumed, yet no revision moved, so the cache stays clean).
      // Mirrors bindAllCellsToTag; Set.add is idempotent, so when the sets
      // were not consumed this is the same hash cost as a membership check.
      if (lastDepRevisions !== null && lastDepRevisions.size > 0) {
        lastDepRevisions.forEach((_revision, cell) => {
          relatedTagsForCell(cell).add(tag);
          // Keep the inner MergedCell's tracking frame consistent when this
          // read came through tag.value (executeTag during a drain): forward
          // the deps so its `finally` re-binds them, keeps isConst false and
          // leaves tag.relatedCells accurate (destroy() unbinds through it).
          if (currentTracker !== null) {
            currentTracker.add(cell);
          }
        });
      }
      return lastValue;
    }
    return recompute();
  }
  readThunk = readCached;

  const self: CachedCell<T> = {
    // marker so isTagLike() treats this like a cell-ish thing if needed
    [isTag]: true,
    get tag() {
      return tag;
    },
    invalidate() {
      hasValue = false;
      lastDepRevisions = null;
    },
    get value(): T {
      // Replay known deps into the ambient tracker so outer formulas still
      // depend on the underlying cells even when we short-circuit with the
      // cache. This preserves invalidation semantics for parents.
      if (
        currentTracker !== null &&
        lastDepRevisions !== null &&
        lastDepRevisions.size > 0
      ) {
        lastDepRevisions.forEach((_revision, cell) =>
          currentTracker!.add(cell),
        );
      }
      return readCached();
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

// For a reactive binding formula, register every LEAF object held by a tracked
// cell as a value-owner of that cell with the Ember host (via the
// `globalThis.__gxtRegisterObjectValueOwner` hook). This lets
// `set(leafObj,'key',...)` reach the cell through Ember's SyncCore reverse
// lookup — the attribute / inside-element analogue of the content-position
// null-object fix. No-op when the hook is absent (standalone glimmer-next) or
// the formula tracked no object-valued cells.
export function registerLeafOwnersForFormula(f: MergedCell): void {
  try {
    const hook =
      HOST_HOOKS.registerObjectValueOwner ??
      (globalThis as any).__gxtRegisterObjectValueOwner;
    if (typeof hook !== 'function') return;
    const cells = (f as any).relatedCells as Set<Cell> | undefined;
    if (!cells || cells.size === 0) return;
    cells.forEach((c) => {
      const v = (c as any)._value;
      const ro = (c as any)._relatedObj;
      const rk = (c as any)._relatedKey;
      if (
        v &&
        typeof v === 'object' &&
        ro &&
        typeof ro === 'object' &&
        typeof rk === 'string'
      ) {
        hook(v, ro, rk);
      }
    });
  } catch {
    /* best-effort */
  }
}

// When a `this.<path>` binding resolves off an ABSENT property the getter
// touches no cell, so its wrapping formula reports `isConst` and the binding is
// set ONCE and never updates (Ember's dynamic-content "undefined dynamic paths"
// cases for attribute / inside-an-element positions). Materialize the leaf cell
// on the current template `this` (exposed by the Ember host as
// `globalThis.__gxtCurrentTemplateThis`) by reading it through `cellFor`, so a
// re-evaluated formula now tracks a real cell that `set(context,'<path>',...)`
// will dirty. Returns true if a cell was materialized (caller should treat the
// binding as reactive). Best-effort: a no-op when the host hasn't exposed the
// current template `this` (standalone glimmer-next).
export function materializeAbsentPathCell(child: Function): boolean {
  try {
    // Prefer an explicit path stamp (set by the Ember host when the getter is
    // wrapped — e.g. the attribute `_attrNormalize` wrapper whose own toString
    // hides the inner `this.<path>`). Fall back to scanning the getter source.
    let path = (child as any).__gxtPath as string | undefined;
    if (!path) {
      const str = String(child);
      const marker = 'this.';
      const idx = str.indexOf(marker);
      if (idx === -1) return false;
      let end = idx + marker.length;
      while (end < str.length) {
        const c = str[end]!;
        if (
          (c >= 'a' && c <= 'z') ||
          (c >= 'A' && c <= 'Z') ||
          (c >= '0' && c <= '9') ||
          c === '_' ||
          c === '$' ||
          c === '.'
        ) {
          end++;
        } else {
          break;
        }
      }
      path = str.slice(idx + marker.length, end);
    }
    if (!path) return false;
    const ctx = HOST_HOOKS.getCurrentTemplateThis
      ? HOST_HOOKS.getCurrentTemplateThis()
      : (globalThis as any).__gxtCurrentTemplateThis;
    if (!ctx || typeof ctx !== 'object') return false;
    let cur: any = ctx;
    let materialized = false;
    for (const seg of path.split('.')) {
      if (!cur || typeof cur !== 'object') break;
      const segCell = (cellFor as any)(cur, seg, /* skipDefine */ false);
      materialized = true;
      cur = segCell ? segCell.value : cur[seg];
    }
    return materialized;
  } catch {
    return false;
  }
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

// Map/Set prototype patching used to be applied here as an import side-
// effect, but that affects every consumer — including vendor code that
// subclasses Map/Set or relies on the identity of unpatched method
// references. The patch is now opt-in via
// `ensureReactiveCollectionsPatched()` from `@/core/reactive-collections`,
// which `setupGlobalScope` (plugins/runtime-compiler.ts) calls.
