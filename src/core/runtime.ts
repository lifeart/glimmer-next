import {
  setIsRendering,
  type MergedCell,
  executeTag,
  hasAsyncOpcodes,
  tagsToRevalidate,
  relatedTags,
} from '@/core/reactive';
import { isRehydrationScheduled } from './ssr/rehydration-state';

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
  if ((globalThis as any).__gxtExternalSchedule) {
    (globalThis as any).__gxtExternalSchedule();
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

/**
 * Fully synchronous DOM sync — no Promise allocation, no async/await overhead.
 */
function syncDomSync() {
  let sharedTags: MergedCell[] | null = null;
  setIsRendering(true);
  for (const cell of tagsToRevalidate) {
    executeTag(cell, false);
    const subTags = relatedTags.get(cell.id);
    if (subTags !== undefined) {
      if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
        const names: string[] = [];
        subTags.forEach(t => names.push(t._debugName || '?'));
        console.log('[SYNC] cell.id=' + cell.id + ' DELETE relatedTags, had: [' + names.join(',') + ']');
      }
      relatedTags.delete(cell.id);
      if (sharedTags === null) sharedTags = [];
      for (const tag of subTags) sharedTags.push(tag);
      subTags.clear();
    } else if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
      console.log('[SYNC] cell.id=' + cell.id + ' no relatedTags');
    }
  }
  if (sharedTags !== null) {
    sortSharedTags(sharedTags);
    const epoch = nextExecutionEpoch();
    for (const tag of sharedTags) {
      if (shouldExecuteSharedTag(tag, epoch)) {
        if (IS_DEV_MODE && (globalThis as any).__gxtDebugSync) {
          console.log('[SYNC] executeTag formula.id=' + tag.id + ' name=' + tag._debugName);
        }
        executeTag(tag, false);
      }
    }
  }
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
  for (const cell of tagsToRevalidate) {
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
    for (const tag of sharedTags) {
      if (shouldExecuteSharedTag(tag, epoch)) {
        await executeTag(tag, true);
      }
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
