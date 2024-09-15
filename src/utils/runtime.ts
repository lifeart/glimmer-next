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
  const sharedTags = new Set<MergedCell>();
  setIsRendering(true);
  for (const cell of tagsToRevalidate) {
    await executeTag(cell);

    const subTags = relatedTags.get(cell);
    if (subTags !== undefined) {
      relatedTags.delete(cell);
      subTags.forEach((tag) => {
        sharedTags.add(tag);
      });
      subTags.clear();
    }
  }
  tagsToRevalidate.clear();
  // sort shared tags by id
  const sharedTagsArray = Array.from(sharedTags);
  // sort tags in order of creation to avoid stale logic
  sharedTagsArray.sort((a, b) => a.id - b.id);
  for (const tag of sharedTagsArray) {
    await executeTag(tag);
  }
  setIsRendering(false);
}
