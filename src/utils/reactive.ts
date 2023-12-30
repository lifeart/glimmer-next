/*
  This is a proof of concept for a new approach to reactive programming.
  It's related to Glimmer-VM's `@tracked` system, but without invalidation step.
  We explicitly update DOM only when it's needed and only if tags are changed.
*/

import { scheduleRevalidate } from "@/utils/runtime";

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

// console.info({
//   opsForTag,
//   tagsToRevalidate,
//   relatedTags,
// });

// we have only 2 types of cells
export type AnyCell = Cell | MergedCell;

let currentTracker: Set<Cell> | null = null;
let _isRendering = false;

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
  _debugName?: string | undefined;
  constructor(value: T, debugName?: string) {
    this._value = value;
    this._debugName = debugName;
    opsForTag.set(this, []);
    relatedTags.set(this, new Set());
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

export function listDependentCells(cells: Array<AnyCell>, cell: MergedCell) {
  const msg = [cell._debugName, "depends on:"];
  cells.forEach((cell) => {
    msg.push(cell._debugName);
  });
  return msg.join(" ");
}

function bindAllCellsToTag(cells: Set<Cell>, tag: MergedCell) {
  cells.forEach((cell) => {
    // we have related tags created in the constructor
    relatedTags.get(cell)!.add(tag);
  });
  // console.info(listDependentCells(Array.from(cells), tag));
}

// "derived" cell, it's value is calculated from other cells, and it's value can't be updated
export class MergedCell {
  fn: () => unknown;
  isConst = false;
  isDestroyed = false;
  _debugName?: string | undefined;
  constructor(fn: () => unknown, debugName?: string) {
    this.fn = fn;
    this._debugName = debugName;
    opsForTag.set(this, []);
  }
  destroy() {
    this.isDestroyed = true;
    opsForTag.set(this, []);
  }
  get value() {
    if (this.isDestroyed) {
      return;
    } else if (this.isConst) {
      return this.fn();
    } else if (null === currentTracker && _isRendering) {
      currentTracker = tracker();
      try {
        return this.fn();
      } finally {
        if (currentTracker.size > 0) {
          bindAllCellsToTag(currentTracker, this);
        } else {
          this.isConst = true;
        }
        currentTracker = null;
      }
    } else {
      return this.fn();
    }
  }
}

// this function is called when we need to update DOM, values represented by tags are changed
export type tagOp = (...values: unknown[]) => Promise<void> | void;

// this is runtime function, it's called when we need to update DOM for a specific tag
export async function executeTag(tag: Cell | MergedCell) {
  let opcode: null | tagOp = null;
  // we always have ops for a tag
  const ops = opsForTag.get(tag)!;
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
    console.error({
      message: "Error executing tag",
      error: e,
      tag,
      opcode: opcode?.toString(),
    });
    if (opcode) {
      let index = ops.indexOf(opcode);
      if (index > -1) {
        ops.splice(index, 1);
      }
    }
  }
}

const cellsMap = new WeakMap<object, Record<string, Cell<unknown>>>();
// this is function to create a reactive cell from an object property
export function cellFor<T extends object, K extends keyof T>(
  obj: T,
  key: K
): Cell<T[K]> {
  const refs = cellsMap.get(obj) || {};
  if (key in refs) {
    return refs[key as unknown as string] as Cell<T[K]>;
  }
  const cellValue = new Cell<T[K]>(
    obj[key],
    `${obj.constructor.name}.${String(key)}`
  );
  refs[key as unknown as string] = cellValue;
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

export function formula(fn: () => unknown, debugName?: string) {
  return new MergedCell(fn, `formula:${debugName ?? "unknown"}`);
}

export function cell<T>(value: T, debugName?: string) {
  return new Cell(value, debugName);
}
