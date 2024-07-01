import {
  type Cell,
  cellsMap,
  getTracker,
  isRendering,
  setIsRendering,
  cell,
  lazyRawCellFor as internalLazyCellFor,
} from '../reactive';


export const tagFor = internalLazyCellFor;

export function dirtyTagFor(obj: object, key: string | number | symbol): void {
  // @ts-expect-error
  const cell = internalLazyCellFor(obj, key);
  cell.update(cell.value);
}
export function tagMetaFor(obj: object): any {
  return cellsMap.get(obj);
}

export function isTracking(): boolean {
  return getTracker() !== null;
}

export function consumeTag(tag: Cell): void {
  const TRACKER = getTracker();
  if (TRACKER !== null) {
    TRACKER.add(tag);
  }
}

export type Getter<T, K extends keyof T> = (self: T) => T[K] | undefined;
export type Setter<T, K extends keyof T> = (self: T, value: T[K]) => void;

export function trackedData<T extends object, K extends keyof T>(
  key: K,
  initializer?: (this: T) => T[K],
): { getter: Getter<T, K>; setter: Setter<T, K> } {
  function getter(self: T) {
    const tag = internalLazyCellFor(self, key, initializer);
 
    return tag.value;
  }

  function setter(self: T, value: T[K]): void {
    const tag = internalLazyCellFor(self, key, initializer);
    tag.update(value);
  }

  return { getter, setter };
}

let renderingStateBeforeBegin = isRendering();

export function beginTrackFrame() {
  renderingStateBeforeBegin = isRendering();
  if (!isRendering()) {
    setIsRendering(true);
  }
}

export function endTrackFrame() {
  if (isRendering() !== renderingStateBeforeBegin) {
    setIsRendering(renderingStateBeforeBegin);
  }
}

export function track(cb: () => unknown): unknown {
  beginTrackFrame();
  try {
    return cb();
  } finally {
    endTrackFrame();
  }
}

export function untrack(cb: () => unknown): unknown {
  beginUntrackFrame();
  try {
    return cb();
  } finally {
    endUntrackFrame();
  }
}

export function beginUntrackFrame() {
  renderingStateBeforeBegin = isRendering();
  if (renderingStateBeforeBegin) {
    setIsRendering(false);
  }
}

export function endUntrackFrame() {
  if (isRendering() !== renderingStateBeforeBegin) {
    setIsRendering(renderingStateBeforeBegin);
  }
}

export function valueForTag(tag: Cell) {
  return tag.value;
}

export function validateTag() {
  return false;
}
export const CURRENT_TAG = cell(0, 'CURRENT_TAG');
