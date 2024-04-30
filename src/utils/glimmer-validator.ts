import {
  type Cell,
  cellFor,
  cellsMap,
  getTracker,
  isRendering,
  setIsRendering,
  cell,
} from './reactive';

export { cellFor as tagFor } from '@lifeart/gxt';

export function dirtyTagFor(obj: object, key: string | number | symbol): void {
  // @ts-expect-error
  const cell = cellFor(obj, key);
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
  let values = new WeakMap<T, T[K]>();
  let hasInitializer = typeof initializer === 'function';

  function getter(self: T) {
    // @ts-expect-error
    consumeTag(cellFor(self, key));

    let value;

    // If the field has never been initialized, we should initialize it
    if (hasInitializer && !values.has(self)) {
      value = initializer!.call(self);
      values.set(self, value);
    } else {
      value = values.get(self);
    }

    return value;
  }

  function setter(self: T, value: T[K]): void {
    dirtyTagFor(self, key);
    values.set(self, value);
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
