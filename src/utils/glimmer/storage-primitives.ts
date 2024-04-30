import { cell, type Cell } from '@lifeart/gxt';
import { isFn } from '../shared';
interface Storage<T> {
  cell: Cell<T>;
  update(value: T): void;
}

export function createStorage<T>(
  initialValue?: T,
  isEqual?: (oldValue: T, newValue: T) => boolean,
): Storage<T> {
  return {
    cell: cell<T>(initialValue as T, 'storage-primitive'),
    update(value: T) {
      if (isFn(isEqual) && isEqual(this.cell.value as T, value)) {
        return;
      }
      this.cell.update(value);
    },
  };
}
export function getValue<T>(storage: Storage<T>): T {
  return storage.cell.value;
}
export function setValue<T>(storage: Storage<T>, value: T) {
  storage.update(value);
}
