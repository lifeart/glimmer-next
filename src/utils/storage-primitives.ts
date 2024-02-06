import { cell, type Cell } from '@lifeart/gxt';

const CELL_SYMBOL = Symbol('cell');
const CELL_VALUE = Symbol('cell-value');

interface Storage<T> {
  [CELL_SYMBOL]: true;
  [CELL_VALUE]: Cell<T>;
  update(value: T): void;
}

export function createStorage<T>(
  initialValue?: T,
  isEqual?: (oldValue: T, newValue: T) => boolean,
): Storage<T> {
  return {
    [CELL_SYMBOL]: true,
    [CELL_VALUE]: cell<T>(initialValue as T, 'storage-primitive'),
    update(value: T) {
      if (isEqual && isEqual(this[CELL_VALUE]?.value as T, value)) {
        return;
      }
      this[CELL_VALUE].update(value);
    },
  };
}
export function getValue<T>(storage: Storage<T>): T {
  return (storage[CELL_VALUE]?.value ?? undefined) as unknown as T;
}
export function setValue<T>(storage: Storage<T>, value: T) {
  storage.update(value);
}
