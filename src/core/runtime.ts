import {
  setIsRendering,
  isRendering,
  type MergedCell,
  executeTag,
  hasAsyncOpcodes,
  tagsToRevalidate,
  relatedTags,
  relatedTagsForCell,
} from '@/core/reactive';
import { isRehydrationScheduled } from './ssr/rehydration-state';
import { HOST_HOOKS } from '@/core/host-hooks';

let revalidateScheduled = false;
let hasExternalUpdate = false;
type voidFn = () => void;
let resolveRender: undefined | voidFn = undefined;
let executionEpoch = 0;
let executedTagEpoch: WeakMap<MergedCell, number> = new WeakMap();

function nextExecutionEpoch() {
  executionEpoch++;
  if (executionEpoch === Number.MAX_SAFE_INTEGER) {
    executionEpoch = 1;
    executedTagEpoch = new WeakMap();
  }
  return executionEpoch;
}

function shouldExecuteSharedTag(tag: MergedCell, epoch: number) {
  if (executedTagEpoch.get(tag) === epoch) {
    return false;
  }
  executedTagEpoch.set(tag, epoch);
  return true;
}

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
 * Sort shared tags by creation order for deterministic evaluation.
 */
function sortSharedTags(sharedTags: MergedCell[]) {
  if (sharedTags.length > 1) {
    sharedTags.sort((a, b) => a.id - b.id);
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

/**
 * A pass takes a changed cell's dependent formulas out of `relatedTags`; a
 * formula subscribes again when it re-evaluates. When a binding aborts the
 * pass, the formulas it took but did not reach would stay unsubscribed for
 * good: subscribe them to the cells they last read, so their next change
 * renders them.
 */
function resubscribeUnreachedTags(sharedTags: MergedCell[], from: number) {
  for (let i = from; i < sharedTags.length; i++) {
    const tag = sharedTags[i];
    if (tag.isDestroyed || tag.relatedCells === null) {
      continue;
    }
    for (const cell of tag.relatedCells) {
      relatedTagsForCell(cell).add(tag);
    }
  }
}

/**
 * Fully synchronous DOM sync — no Promise allocation, no async/await overhead.
 *
 * The pass ends in a `finally`: a binding that throws aborts it, and the
 * aborted pass still empties the queue of changed cells and leaves rendering
 * state. Otherwise the failing binding would stay queued and run again in
 * every later sync. Like a failed Glimmer revalidation, the bindings the pass
 * did not reach render again only after a new change.
 */
function syncDomSync() {
  let sharedTags: MergedCell[] | null = null;
  // Shared tags this pass took from `relatedTags` and executed (or started).
  let sharedDone = 0;
  let completed = false;
  setIsRendering(true);
  try {
    // Process primary cells in creation (id) order so that parent opcodes
    // run before child opcodes. Without this, when two cells are dirtied
    // in the same batch (e.g., outer each source + inner each source),
    // iteration order follows insertion order, which can cause a child
    // effect (e.g., a nested {{#each}}'s syncList) to create items just
    // before its parent tears it down. Sorting by tag.id gives parent-first
    // ordering because parent cells are allocated first during render.
    const primaryCells =
      tagsToRevalidate.size > 1
        ? Array.from(tagsToRevalidate).sort((a, b) => a.id - b.id)
        : tagsToRevalidate;
    for (const cell of primaryCells) {
      executeTag(cell, false);
      const subTags = relatedTags.get(cell.id);
      if (subTags !== undefined) {
        if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
          const names: string[] = [];
          subTags.forEach(t => names.push(t._debugName || '?'));
          console.log('[SYNC] cell.id=' + cell.id + ' DELETE relatedTags, had: [' + names.join(',') + ']');
        }
        relatedTags.delete(cell.id);
        // P8: reuse the module-level scratch buffer instead of allocating.
        if (sharedTags === null) { sharedTags = _sharedTagsScratch; sharedTags.length = 0; }
        for (const tag of subTags) sharedTags.push(tag);
        subTags.clear();
      } else if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
        console.log('[SYNC] cell.id=' + cell.id + ' no relatedTags');
      }
    }
    if (sharedTags !== null) {
      sortSharedTags(sharedTags);
      const epoch = nextExecutionEpoch();
      for (; sharedDone < sharedTags.length; ) {
        const tag = sharedTags[sharedDone++];
        // A formula destroyed earlier in this pass (a list that removed its
        // rows) has nothing left to run.
        if (tag.isDestroyed) continue;
        if (shouldExecuteSharedTag(tag, epoch)) {
          if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
            console.log('[SYNC] executeTag formula.id=' + tag.id + ' name=' + tag._debugName);
          }
          executeTag(tag, false);
        }
      }
    }
    completed = true;
  } finally {
    if (!completed && sharedTags !== null) {
      resubscribeUnreachedTags(sharedTags, sharedDone);
    }
    // Release MergedCell refs so the scratch doesn't retain them across ticks.
    if (sharedTags !== null) sharedTags.length = 0;
    tagsToRevalidate.clear();
    setIsRendering(false);
  }
}

/**
 * Host-driven revalidation pass — for hosts that own scheduling through the
 * `scheduleRevalidate` host hook and re-run passes until the UI is valid
 * (Ember's native layer: backburner render queue + `_RERENDER_LOOP_LIMIT`).
 *
 * Same work as the synchronous `syncDom()`, with one difference: the queued
 * cells are taken (snapshot + clear) at the START of the pass, so a cell
 * dirtied DURING the pass — a re-executing formula, or a component created by
 * an `{{#if}}` swap, writing state another binding consumed in an earlier pass
 * — stays queued for the host's next pass. `syncDom()` clears the queue at the
 * END of the pass and silently drops such writes (its own microtask scheduler
 * never re-runs within a pass); hosts that loop must not lose them.
 *
 * The rendering flag is restored even when an opcode throws (e.g. a host
 * backtracking assertion), so the host can recover and re-throw; the formulas
 * the aborted pass took but did not reach stay subscribed to their cells.
 *
 * Synchronous only: hosts using it compile with ASYNC_COMPILE_TRANSFORMS off.
 *
 * @returns true when cells were dirtied during the pass (another pass needed).
 */
export function flushRevalidation(): boolean {
  if (tagsToRevalidate.size === 0) {
    return false;
  }
  const primaryCells = Array.from(tagsToRevalidate);
  tagsToRevalidate.clear();
  if (primaryCells.length > 1) {
    primaryCells.sort((a, b) => a.id - b.id);
  }
  let sharedTags: MergedCell[] | null = null;
  let sharedDone = 0;
  let completed = false;
  const wasRendering = isRendering();
  setIsRendering(true);
  try {
    for (const cell of primaryCells) {
      executeTag(cell, false);
      const subTags = relatedTags.get(cell.id);
      if (subTags !== undefined) {
        relatedTags.delete(cell.id);
        if (sharedTags === null) sharedTags = [];
        for (const tag of subTags) sharedTags.push(tag);
        subTags.clear();
      }
    }
    if (sharedTags !== null) {
      sortSharedTags(sharedTags);
      const epoch = nextExecutionEpoch();
      for (; sharedDone < sharedTags.length; ) {
        const tag = sharedTags[sharedDone++];
        if (tag.isDestroyed) continue;
        if (shouldExecuteSharedTag(tag, epoch)) {
          executeTag(tag, false);
        }
      }
    }
    completed = true;
  } finally {
    if (!completed && sharedTags !== null) {
      resubscribeUnreachedTags(sharedTags, sharedDone);
    }
    setIsRendering(wasRendering);
  }
  return tagsToRevalidate.size > 0;
}

/**
 * Async DOM sync — tree-shaken when ASYNC_COMPILE_TRANSFORMS is false
 * because the only call site is gated by the flag.
 *
 * Ends in a `finally` like `syncDomSync`, so a binding that throws does not
 * leave its cell queued or the rendering flag set.
 */
async function syncDomAsync() {
  let sharedTags: MergedCell[] | null = null;
  let sharedDone = 0;
  let completed = false;
  setIsRendering(true);
  try {
    // See syncDomSync for rationale: parent-first ordering by tag.id.
    const primaryCells =
      tagsToRevalidate.size > 1
        ? Array.from(tagsToRevalidate).sort((a, b) => a.id - b.id)
        : tagsToRevalidate;
    for (const cell of primaryCells) {
      await executeTag(cell, true);
      const subTags = relatedTags.get(cell.id);
      if (subTags !== undefined) {
        relatedTags.delete(cell.id);
        if (sharedTags === null) sharedTags = [];
        for (const tag of subTags) sharedTags.push(tag);
        subTags.clear();
      }
    }
    if (sharedTags !== null) {
      sortSharedTags(sharedTags);
      const epoch = nextExecutionEpoch();
      for (; sharedDone < sharedTags.length; ) {
        const tag = sharedTags[sharedDone++];
        if (tag.isDestroyed) continue;
        if (shouldExecuteSharedTag(tag, epoch)) {
          await executeTag(tag, true);
        }
      }
    }
    completed = true;
  } finally {
    if (!completed && sharedTags !== null) {
      resubscribeUnreachedTags(sharedTags, sharedDone);
    }
    tagsToRevalidate.clear();
    setIsRendering(false);
  }
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
