import {
  setIsRendering,
  type MergedCell,
  executeTag,
  executeTagSync,
  hasAsyncOpcodes,
  tagsToRevalidate,
  relatedTags,
} from '@/core/reactive';
import { isRehydrationScheduled } from './ssr/rehydration-state';

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
    executeTagSync(cell);
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
    const executedTags: WeakSet<MergedCell> = new WeakSet();
    for (const tag of sharedTags) {
      if (!executedTags.has(tag)) {
        executedTags.add(tag);
        executeTagSync(tag);
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
    await executeTag(cell);
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
    const executedTags: WeakSet<MergedCell> = new WeakSet();
    for (const tag of sharedTags) {
      if (!executedTags.has(tag)) {
        executedTags.add(tag);
        await executeTag(tag);
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
