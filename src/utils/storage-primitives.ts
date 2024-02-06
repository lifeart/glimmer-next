import { cell, type Cell } from '@lifeart/gxt';

const CELL_SYMBOL = Symbol('cell');
const CELL_VALUE = Symbol('cell-value');

type CellWrapper = {
  [CELL_SYMBOL]: true;
  [CELL_VALUE]?: Cell<any>;
};

function cellWrapper(): CellWrapper {
  return {
    [CELL_SYMBOL]: true,
  };
}

export function createStorage() {
  return cellWrapper();
}
export function getValue(wrapper: CellWrapper) {
  return wrapper[CELL_VALUE]?.value ?? undefined;
}
export function setValue(wrapper: CellWrapper, value: any) {
  if (!wrapper[CELL_VALUE]) {
    wrapper[CELL_VALUE] = cell(value, 'storage-primitive');
  } else {
    wrapper[CELL_VALUE].update(value);
  }
}
