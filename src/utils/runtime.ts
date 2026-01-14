import {
  setIsRendering,
  type MergedCell,
  tagsToRevalidate,
  executeTag,
  relatedTags,
} from '@/utils/reactive';
import { isRehydrationScheduled } from './ssr/rehydration';

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
    queueMicrotask(async () => {
      try {
        await syncDom();
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
export async function syncDom() {
  // Lazily create sharedTags only if needed - avoids allocation when no related tags exist
  let sharedTags: MergedCell[] | null = null;
  setIsRendering(true);
  for (const cell of tagsToRevalidate) {
    await executeTag(cell);

    const subTags = relatedTags.get(cell.id);
    if (subTags !== undefined) {
      relatedTags.delete(cell.id);
      if (sharedTags === null) {
        sharedTags = [];
      }
      // Direct iteration is faster than spread operator on Set.values()
      for (const tag of subTags) {
        sharedTags.push(tag);
      }
      subTags.clear();
    }
  }
  // Only process sharedTags if we have any
  if (sharedTags !== null) {
    // Only sort when necessary (more than 1 element)
    if (sharedTags.length > 1) {
      // sort tags in order of creation to avoid stale logic
      sharedTags.sort((a, b) => a.id - b.id);
    }
    // Lazily create WeakSet only when needed
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
