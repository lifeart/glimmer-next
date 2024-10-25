/*
  This is a proof of concept for a new approach to reactive programming.
  It's related to Glimmer-VM's `@tracked` system, but without invalidation step.
  We explicitly update DOM only when it's needed and only if tags are changed.
*/
import { isFn, isTag, isTagLike, debugContext } from '@/utils/shared';
import { Signal } from "../signal-polyfill";


export const asyncOpcodes = new WeakSet<tagOp>();
// List of DOM operations for each tag
export const opsForTag: WeakMap<
  Cell | MergedCell,
  Array<tagOp>
> = new WeakMap();
// REVISION replacement, we use a set of tags to revalidate
export const tagsToRevalidate: Set<Cell> = new Set();
// List of derived tags for each cell
export const relatedTags: WeakMap<Cell, Set<MergedCell>> = new WeakMap();

export const DEBUG_MERGED_CELLS = new Set<MergedCell>();
export const DEBUG_CELLS = new Set<Cell>();
var currentTracker: Set<Cell> | null = null;
let _isRendering = false;
export const cellsMap = new WeakMap<
  object,
  Map<string | number | symbol, Cell<unknown>>
>();

export function getCells() {
  return Array.from(DEBUG_CELLS);
}
export function getMergedCells() {
  return Array.from(DEBUG_MERGED_CELLS);
}

if (IS_DEV_MODE) {
  if (!import.meta.env.SSR) {
    window['getVM'] = () => ({
      relatedTags,
      tagsToRevalidate,
      opsForTag,
    });
  }
}

function keysFor(obj: object): Map<string | number | symbol, Cell<unknown>> {
  if (!cellsMap.has(obj)) {
    cellsMap.set(obj, new Map());
  }
  return cellsMap.get(obj)!;
}

export function tracked(
  klass: any,
  key: string,
  descriptor?: PropertyDescriptor & { initializer?: () => any },
): void {
  let hasInitializer = typeof descriptor?.initializer === 'function';
  return {
    get() {
      const keys = keysFor(this);
      if (!keys.has(key)) {
        const value: any = cell(
          hasInitializer
            ? descriptor!.initializer?.call(this)
            : descriptor?.value,
          `${klass.constructor.name}.${key}.@tracked`,
        );
        keys.set(key, value);
        return value.value;
      } else {
        return keys.get(key)!.value;
      }
    },
    set(newValue: any) {
      const keys = keysFor(this);
      if (!keys.has(key)) {
        keys.set(
          key,
          cell(newValue, `${klass.constructor.name}.${key}.@tracked`),
        );
        return;
      }
      const _cell = keys.get(key)!;
      if (_cell.value === newValue) {
        return;
      }
      _cell.update(newValue);
    },
    enumerable: descriptor?.enumerable ?? true,
    configurable: descriptor?.configurable ?? true,
  } as unknown as void;
}
// we have only 2 types of cells
export type AnyCell = Cell | MergedCell;

export function isRendering() {
  return _isRendering;
}
export function setIsRendering(value: boolean) {
  _isRendering = value;
}

// "data" cell, it's value can be updated, and it's used to create derived cells
export class Cell<T extends unknown = unknown> {
  _value!: any;
  declare toHTML: () => string;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  [isTag] = true;
  constructor(value: T, debugName?: string) {
    this._value = new Signal.State(value);
    if (IS_DEV_MODE) {
      this._debugName = debugContext(debugName);
      DEBUG_CELLS.add(this);
    }
  }
  get value() {
    return this._value.get();
  }
  set value(value: T) {
    this.update(value);
  }
  update(value: T) {
    this._value.set(value);
  }
}

export function listDependentCells(cells: Array<AnyCell>, cell: MergedCell) {
  const msg = [cell._debugName, 'depends on:'];
  cells.forEach((cell) => {
    msg.push(cell._debugName);
  });
  return msg.join(' ');
}

export function opsFor(cell: AnyCell) {
  if (!opsForTag.has(cell)) {
    const ops: tagOp[] = [];
    opsForTag.set(cell, ops);
    return ops;
  }
  return opsForTag.get(cell)!;
}

export function relatedTagsForCell(cell: Cell) {
  if (!relatedTags.has(cell)) {
    const tags = new Set<MergedCell>();
    relatedTags.set(cell, tags);
    return tags;
  }
  return relatedTags.get(cell)!;
}

// "derived" cell, it's value is calculated from other cells, and it's value can't be updated
export class MergedCell {
  fn:  Fn | Function;
  declare toHTML: () => string;
  isConst: boolean = false;
  isDestroyed = false;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  relatedCells: Set<Cell> | null = null;
  [isTag] = true;
  constructor(fn: Fn | Function, debugName?: string) {
    this.fn = fn;
    if (IS_DEV_MODE) {
      this._debugName = debugContext(debugName);
      DEBUG_MERGED_CELLS.add(this);
    }
  }
  destroy() {
    this.isDestroyed = true;
    if (IS_DEV_MODE) {
      DEBUG_MERGED_CELLS.delete(this);
    }
  }
  get value() {
    return this.fn();
  }
}

// this function is called when we need to update DOM, values represented by tags are changed
export type tagOp = (...values: unknown[]) => Promise<void> | void;

// this is function to create a reactive cell from an object property
export function cellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Cell<T[K]> {
  const refs = cellsMap.get(obj) || new Map<string | number | symbol, Cell>();
  if (refs.has(key)) {
    return refs.get(key) as Cell<T[K]>;
  }
  const cellValue = new Cell<T[K]>(
    obj[key],
    `${obj.constructor.name}.${String(key)}`,
  );
  refs.set(key, cellValue);
  cellsMap.set(obj, refs);
  Object.defineProperty(obj, key, {
    get() {
      return cellValue.value;
    },
    set(val) {
      cellValue.update(val);
    },
  });
  return cellValue;
}

type Fn = () => unknown;

export function formula(fn: Function | Fn, debugName?: string) {
  return new MergedCell(fn, `formula:${debugName ?? 'unknown'}`);
}

export function deepFnValue(fn: Function | Fn) {
  const cell = fn();
  if (isFn(cell)) {
    return deepFnValue(cell);
  } else if (typeof cell === 'object' && cell !== null && isTagLike(cell)) {
    return cell.value;
  } else {
    return cell;
  }
}

export function cell<T>(value: T, debugName?: string) {
  return new Cell(value, debugName);
}

export function inNewTrackingFrame(callback: () => void) {
  // const existingTracker = currentTracker;
  // currentTracker = null;
  callback();
  // currentTracker = existingTracker;
}

export function getTracker() {
  return currentTracker;
}
export function setTracker(tracker: Set<Cell> | null) {
  currentTracker = tracker;
}
