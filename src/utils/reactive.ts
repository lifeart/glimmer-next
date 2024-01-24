/*
  This is a proof of concept for a new approach to reactive programming.
  It's related to Glimmer-VM's `@tracked` system, but without invalidation step.
  We explicitly update DOM only when it's needed and only if tags are changed.
*/
import { scheduleRevalidate } from '@/utils/runtime';
import { isFn, isTag, isTagLike, debugContext } from '@/utils/shared';
import { supportChromeExtension } from './redux-devtools';

export const asyncOpcodes = new WeakSet<tagOp>();
// List of DOM operations for each tag
export const opsForTag: Map<
  number,
  Array<tagOp>
> = new Map();
// REVISION replacement, we use a set of tags to revalidate
export const tagsToRevalidate: Set<Cell> = new Set();
// List of derived tags for each cell
export const relatedTags: Map<number, Set<MergedCell>> = new Map();

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
  let map = cellsMap.get(obj);
  if (map === undefined) {
    map = new Map();
    cellsMap.set(obj, map);
  }
  return map!;
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

function tracker() {
  return new Set<Cell>();
}
// "data" cell, it's value can be updated, and it's used to create derived cells
export class Cell<T extends unknown = unknown> {
  _value!: T;
  id = tagId++;
  declare toHTML: () => string;
  [Symbol.toPrimitive]() {
    return this.value;
  }
  _debugName?: string | undefined;
  [isTag] = true;
  constructor(value: T, debugName?: string) {
    this._value = value;
    if (IS_DEV_MODE) {
      this._debugName = debugContext(debugName);
      DEBUG_CELLS.add(this);
    }
  }
  get value() {
    if (currentTracker !== null) {
      currentTracker.add(this);
    }
    return this._value;
  }
  set value(value: T) {
    this.update(value);
  }
  update(value: T) {
    this._value = value;
    tagsToRevalidate.add(this);
    scheduleRevalidate();
  }
}

export class LazyCell<T extends unknown = unknown> extends Cell<() => T> {
  __value!: T;
  constructor(v: () => T, debugName?: string) {
    // @ts-expect-error
    super(null, debugName);
    let isResolved = false;
    Object.defineProperty(this, '_value', {
      get() {
        if (!isResolved) {
          let val: unknown = undefined;
          try {
            val = v();
            isResolved = true;
          } catch (e) {
            throw e;
          }
          this.__value = val;
        }
        return this.__value;
      },
      set(v) {
        if (!isResolved) {
          isResolved = true;
        }
        this.__value = v;
      },
    });
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
  let ops = opsForTag.get(cell.id);
  if (ops === undefined) {
    ops = [];
    opsForTag.set(cell.id, ops);
  }
  return ops;
}

export function relatedTagsForCell(cell: Cell) {
  let tags = relatedTags.get(cell.id);
  if (tags === undefined) {
    tags = new Set<MergedCell>();
    relatedTags.set(cell.id, tags);
  }
  return tags;
}

function bindAllCellsToTag(cells: Set<Cell>, tag: MergedCell) {
  cells.forEach((cell) => {
    const tags = relatedTagsForCell(cell);
    tags.add(tag);
  });
}

// "derived" cell, it's value is calculated from other cells, and it's value can't be updated
let tagId = 0;

export function getTagId() {
  return tagId;
}

export function tagsFromRange(start: number, end: number = getTagId()) {
  const tags: Array<Cell> = [];
  DEBUG_CELLS.forEach((cell) => {
    if (cell.id >= start && cell.id <= end) {
      tags.push(cell);
    }
  });
  return tags;
}
export class MergedCell {
  fn: Fn | Function;
  declare toHTML: () => string;
  isConst: boolean = false;
  isDestroyed = false;
  id = tagId++;
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
    opsForTag.delete(this.id);
    if (this.relatedCells !== null) {
      this.relatedCells.forEach((cell) => {
        const related = relatedTags.get(cell.id);
        if (related !== undefined) {
          related.delete(this);
          if (related.size === 0) {
            relatedTags.delete(cell.id);
          }
        }
      });
      this.relatedCells.clear();
    }
    if (IS_DEV_MODE) {
      DEBUG_MERGED_CELLS.delete(this);
    }
  }
  get value() {
    if (this.isDestroyed) {
      return;
    }

    if (this.isConst || !_isRendering || currentTracker !== null) {
      return this.fn();
    }

    let $tracker!: Set<Cell>;
    try {
      $tracker = tracker();
      setTracker($tracker);
      return this.fn();
    } finally {
      bindAllCellsToTag($tracker, this);
      this.isConst = $tracker.size === 0;
      this.relatedCells = $tracker;
      setTracker(null);
    }
  }
}

// this function is called when we need to update DOM, values represented by tags are changed
export type tagOp = (...values: unknown[]) => Promise<void> | void;

// this is runtime function, it's called when we need to update DOM for a specific tag
export async function executeTag(tag: Cell | MergedCell) {
  let opcode: null | tagOp = null;
  const ops = opsFor(tag);
  if (TRY_CATCH_ERROR_HANDLING) {
    try {
      const value = tag.value;
      for (const op of ops) {
        opcode = op;
        if (asyncOpcodes.has(op)) {
          await op(value);
        } else {
          op(value);
        }
      }
    } catch (e: any) {
      if (IS_DEV_MODE) {
        console.error({
          message: 'Error executing tag',
          error: e,
          tag,
          opcode: opcode?.toString(),
        });
      }
      if (opcode) {
        let index = ops.indexOf(opcode);
        if (index > -1) {
          ops.splice(index, 1);
        }
      }
    }
  } else {
    const value = tag.value;
    for (const op of ops) {
      opcode = op;
      if (asyncOpcodes.has(op)) {
        await op(value);
      } else {
        op(value);
      }
    }
  }
}
export function lazyRawCellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  init?: () => T[K],
): Cell<T[K]> {
  const refs = cellsMap.get(obj) || new Map<string | number | symbol, Cell>();
  if (refs.has(key)) {
    return refs.get(key) as Cell<T[K]>;
  }
  // make value lazy
  const cellValue = new LazyCell<T[K]>(
    () => (typeof init === 'function' ? init() : obj[key]),
    `${obj.constructor.name}.${String(key)}`,
  );
  refs.set(key, cellValue);
  cellsMap.set(obj, refs);
  return cellValue as unknown as Cell<T[K]>;
}
export function rawCellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Cell<T[K]> {
  let refs = cellsMap.get(obj);
  if (refs === undefined) {
    refs = new Map<string | number | symbol, Cell>();
    cellsMap.set(obj, refs);
  }
  if (refs.has(key)) {
    return refs.get(key) as Cell<T[K]>;
  }
  const cellValue = new Cell<T[K]>(
    obj[key],
    `${obj.constructor.name}.${String(key)}`,
  );
  refs.set(key, cellValue);
  return cellValue;
}

// this is function to create a reactive cell from an object property
export function cellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  skipDefine = false,
): Cell<T[K]> {
  // make value lazy
  const cellValue = rawCellFor(obj, key);
  if (skipDefine) {
    return cellValue;
  }
  // remove below for ember
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
  const existingTracker = currentTracker;
  setTracker(null);
  callback();
  setTracker(existingTracker);
}

export function getTracker() {
  return currentTracker;
}
export function setTracker(tracker: Set<Cell> | null) {
  currentTracker = tracker;
}

supportChromeExtension({
  get() {
    const cells = {};
    DEBUG_CELLS.forEach((cell, index) => {
      cells[`${cell._debugName}:${index}`] = cell._value;
    });
    return cells;
  },
  skipDispatch: 0,
  set() {
    console.log('set', ...arguments);
  },
  on(timeLine: string, fn: () => any) {
    console.log('on', timeLine, fn);
    setTimeout(() => {
      // debugger;
      fn.call(this, 'updates', {})
    
    }, 2000);
  },
  trigger() {
    console.log('trigger', ...arguments);
  }
});