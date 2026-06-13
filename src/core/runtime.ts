import {
  setIsRendering,
  type Cell,
  type MergedCell,
  executeTag,
  hasAsyncOpcodes,
  tagsToRevalidate,
} from '@/core/reactive';
import { isRehydrationScheduled } from './ssr/rehydration-state';
import { HOST_HOOKS } from '@/core/host-hooks';

let revalidateScheduled = false;
let hasExternalUpdate = false;
type voidFn = () => void;
let resolveRender: undefined | voidFn = undefined;

export function setResolveRender(value: () => void) {
  resolveRender = value;
}
export function takeRenderingControl() {
  hasExternalUpdate = true;
  return () => {
    hasExternalUpdate = false;
  };
}

export function scheduleRevalidate() {
  // External sync hook: allows Ember integration to bypass async scheduling
  // When set, the hook is responsible for calling syncDom() at the right time
  const externalSchedule =
    HOST_HOOKS.scheduleRevalidate ??
    (globalThis as any).__gxtExternalSchedule;
  if (externalSchedule) {
    externalSchedule();
    return;
  }
  if (hasExternalUpdate) {
    return;
  }
  if (!revalidateScheduled) {
    if (IS_DEV_MODE) {
      if (isRehydrationScheduled()) {
        throw new Error('You can not schedule revalidation during rehydration');
      }
    }
    revalidateScheduled = true;
    if (ASYNC_COMPILE_TRANSFORMS && hasAsyncOpcodes()) {
      queueMicrotask(async () => {
        try {
          await syncDomAsync();
          if (resolveRender !== undefined) {
            resolveRender();
            resolveRender = undefined;
          }
        } finally {
          revalidateScheduled = false;
        }
      });
    } else {
      queueMicrotask(() => {
        try {
          syncDomSync();
          if (resolveRender !== undefined) {
            resolveRender();
            resolveRender = undefined;
          }
        } finally {
          revalidateScheduled = false;
        }
      });
    }
  }
}

/**
 * Establish creation (id) order for the shared-tag fan-out.
 *
 * D1: skip-sort fast path — the buffer is filled by walking dirty cells in
 * ascending id order, and each cell's subscriber set iterates in insertion
 * order (subscription order tracks formula creation order), so the combined
 * buffer is very commonly already sorted. An O(n) sortedness scan is far
 * cheaper than the O(n log n) comparator-driven sort it replaces.
 *
 * POST-CONDITION (relied on by the duplicate-skip in the drains): the buffer
 * is non-decreasing by id, so duplicate entries (the same formula reached via
 * several dirty dep cells) are ADJACENT. Ids are unique per tag (shared
 * monotonic `tagId++`), so `a.id === b.id` implies `a === b`.
 */
function sortSharedTags(sharedTags: MergedCell[]) {
  const len = sharedTags.length;
  if (len < 2) {
    return;
  }
  let prevId = sharedTags[0].id;
  for (let i = 1; i < len; i++) {
    const id = sharedTags[i].id;
    if (id < prevId) {
      sharedTags.sort((a, b) => a.id - b.id);
      return;
    }
    prevId = id;
  }
}

// P8: instance-of-the-module scratch buffer for the derived-tag fan-out, reused
// across flushes (like the LIS buffers in list.ts) instead of allocating a
// fresh array per flush. syncDomSync is non-reentrant (executeTag never calls
// back into syncDomSync synchronously — cell writes during a flush only set the
// external-schedule pending flag), so a single shared buffer is safe. Cleared
// (length = 0) before use; the entries are released at the end of the flush so
// the buffer doesn't retain MergedCell references between ticks.
const _sharedTagsScratch: MergedCell[] = [];

// D1: scratch buffer for the primary dirty-cell snapshot, reused across
// flushes instead of `Array.from(tagsToRevalidate)` allocating per drain.
// Same non-reentrancy argument as `_sharedTagsScratch` above; only used by
// the SYNC drain (the async drain keeps fresh allocations because it yields
// between executions).
const _primaryCellsScratch: Cell[] = [];

/**
 * Snapshot the dirty-cell set into the given buffer in creation (id) order.
 *
 * Parent-first rationale: parent opcodes must run before child opcodes. When
 * two cells are dirtied in the same batch (e.g., outer each source + inner
 * each source), Set iteration follows insertion order, which can cause a
 * child effect (e.g., a nested {{#each}}'s syncList) to create items just
 * before its parent tears it down. Id-ascending order gives parent-first
 * because parent cells are allocated first during render.
 *
 * D1: cells are commonly dirtied in creation order, so the snapshot is
 * usually already sorted — detect that with an O(n) scan during the copy and
 * only fall back to the O(n log n) sort when out of order.
 */
function snapshotPrimaryCells(buffer: Cell[]): Cell[] {
  buffer.length = 0;
  let sorted = true;
  let prevId = -1;
  for (const cell of tagsToRevalidate) {
    const id = cell.id;
    if (id < prevId) {
      sorted = false;
    }
    prevId = id;
    buffer.push(cell);
  }
  if (!sorted) {
    buffer.sort((a, b) => a.id - b.id);
  }
  return buffer;
}

/**
 * Fully synchronous DOM sync — no Promise allocation, no async/await overhead.
 */
function syncDomSync() {
  let sharedTags: MergedCell[] | null = null;
  setIsRendering(true);
  // Process primary cells in creation (id) order (parent-first — see
  // snapshotPrimaryCells). Size <= 1 keeps the live-set iteration: a single
  // dirty cell needs no ordering, and live iteration preserves the existing
  // semantics where a cell dirtied DURING that execution is still visited.
  const primaryCells =
    tagsToRevalidate.size > 1
      ? snapshotPrimaryCells(_primaryCellsScratch)
      : tagsToRevalidate;
  for (const cell of primaryCells) {
    executeTag(cell, false);
    const subTags = cell.relatedTags;
    if (subTags !== null && subTags.size > 0) {
      if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
        const names: string[] = [];
        subTags.forEach(t => names.push(t._debugName || '?'));
        console.log('[SYNC] cell.id=' + cell.id + ' CONSUME relatedTags, had: [' + names.join(',') + ']');
      }
      // P8: reuse the module-level scratch buffer instead of allocating.
      if (sharedTags === null) { sharedTags = _sharedTagsScratch; sharedTags.length = 0; }
      for (const tag of subTags) sharedTags.push(tag);
      // Consume the subscriber set: formulas that still depend on this cell
      // re-add themselves when they re-execute below (dynamic dep pruning).
      // The Set OBJECT stays attached to the cell for reuse (D1 — no fresh
      // Set allocation per consumed cell per drain).
      subTags.clear();
    } else if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
      console.log('[SYNC] cell.id=' + cell.id + ' no relatedTags');
    }
  }
  if (sharedTags !== null) {
    sortSharedTags(sharedTags);
    // D1: duplicate-skip replaces the epoch WeakMap. sortSharedTags
    // guarantees non-decreasing id order, so duplicates of the same formula
    // (collected via several dirty dep cells) are adjacent — one pointer
    // compare dedupes with zero per-tag state and no wraparound concerns.
    let prevTag: MergedCell | null = null;
    for (const tag of sharedTags) {
      if (tag === prevTag) {
        continue;
      }
      prevTag = tag;
      if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
        console.log('[SYNC] executeTag formula.id=' + tag.id + ' name=' + tag._debugName);
      }
      executeTag(tag, false);
    }
    // Release MergedCell refs so the scratch doesn't retain them across ticks.
    sharedTags.length = 0;
  }
  // Release Cell refs from the primary snapshot for the same reason.
  _primaryCellsScratch.length = 0;
  tagsToRevalidate.clear();
  setIsRendering(false);
}

/**
 * Async DOM sync — tree-shaken when ASYNC_COMPILE_TRANSFORMS is false
 * because the only call site is gated by the flag.
 */
async function syncDomAsync() {
  let sharedTags: MergedCell[] | null = null;
  setIsRendering(true);
  // See snapshotPrimaryCells for rationale: parent-first ordering by tag.id.
  // Fresh array here (not the module scratch): the async drain yields between
  // executions, so a shared buffer could be observed mid-flush.
  const primaryCells =
    tagsToRevalidate.size > 1
      ? snapshotPrimaryCells([])
      : tagsToRevalidate;
  for (const cell of primaryCells) {
    await executeTag(cell, true);
    const subTags = cell.relatedTags;
    if (subTags !== null && subTags.size > 0) {
      if (sharedTags === null) sharedTags = [];
      for (const tag of subTags) sharedTags.push(tag);
      // Consume in place — see syncDomSync.
      subTags.clear();
    }
  }
  if (sharedTags !== null) {
    sortSharedTags(sharedTags);
    // Duplicate-skip: see syncDomSync (sorted order makes duplicates adjacent).
    let prevTag: MergedCell | null = null;
    for (const tag of sharedTags) {
      if (tag === prevTag) {
        continue;
      }
      prevTag = tag;
      await executeTag(tag, true);
    }
  }
  tagsToRevalidate.clear();
  setIsRendering(false);
}

/**
 * Public API — dispatches to sync or async path.
 * When ASYNC_COMPILE_TRANSFORMS is false, the async branch and syncDomAsync
 * are dead code and tree-shaken by the bundler.
 */
export function syncDom(): Promise<void> | void {
  if (ASYNC_COMPILE_TRANSFORMS && hasAsyncOpcodes()) {
    return syncDomAsync();
  }
  syncDomSync();
}
