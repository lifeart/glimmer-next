import {
  setIsRendering,
  type MergedCell,
  tagsToRevalidate,
  executeTag,
  relatedTags,
  relatedTagsForCell,
} from '@/utils/reactive';

let revalidateScheduled = false;
type voidFn = () => void;
let resolveRender: undefined | voidFn = undefined;

export function setResolveRender(value: () => void) {
  resolveRender = value;
}

export function scheduleRevalidate() {
  if (!revalidateScheduled) {
    revalidateScheduled = true;
    Promise.resolve().then(async () => {
      await syncDom();
      if (resolveRender !== undefined) {
        resolveRender();
        resolveRender = undefined;
      }
      revalidateScheduled = false;
    });
  }
}
export async function syncDom() {
  const sharedTags = new Set<MergedCell>();
  setIsRendering(true);
  for (const cell of tagsToRevalidate) {
    await executeTag(cell);
    // we always have related tags
    const subTags = relatedTagsForCell(cell);
    subTags.forEach((tag) => {
      sharedTags.add(tag);
    });
    relatedTags.delete(cell);
  }
  tagsToRevalidate.clear();
  for (const tag of sharedTags) {
    await executeTag(tag);
  }
  sharedTags.clear();
  setIsRendering(false);
}
