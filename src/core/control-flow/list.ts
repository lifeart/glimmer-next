/**
 * List Control Flow - Level 5
 *
 * Sync and Async list components for rendering arrays.
 */

// Import types from component-class to avoid circular dependency
import type { Component } from '@/core/component-class';
import type { ComponentLike, DOMApi } from '@/core/types';

// Import render/destroy functions directly (no late-binding needed)
import { renderElement, getFirstNode } from '@/core/render-core';
import { destroyElementSync, destroyElement } from '@/core/destroy';

import { Cell, MergedCell, formula, deepFnValue } from '@/core/reactive';
import { opcodeFor } from '@/core/vm';
import {
  $_debug_args,
  IN_SSR_ENV,
  isArray,
  isFn,
  isPrimitive,
  isTagLike,
  LISTS_FOR_HMR,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  isEmpty,
} from '@/core/shared';
import { TREE, CHILD, PARENT, cId, addToTree } from '@/core/tree';
import { isRehydrationScheduled } from '@/core/ssr/rehydration';
import { initDOM } from '@/core/context';
import { registerDestructor } from '../glimmer/destroyable';
import { setParentContext } from '../tracking';

// Re-export getFirstNode for backward compatibility
export { getFirstNode };

/*
  This is a list manager, it's used to render and sync a list of items.
  It's a proof of concept, it's not optimized, it's not a final API.

  Based on Glimmer-VM list update logic.
*/
type GenericReturnType =
  | Array<ComponentLike | Node>
  | ComponentLike
  | Node;

type ListComponentArgs<T> = {
  tag: Cell<T[]> | MergedCell;
  key: string | null;
  ctx: Component<any>;
  ItemComponent: (item: T, index?: number | MergedCell) => GenericReturnType;
};
type RenderTarget = HTMLElement | DocumentFragment;

// Helper function for binary search
function countLessThan(arr: number[], target: number) {
  let low = 0,
    high = arr.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (arr[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export class BasicListComponent<T extends { id: number }> {
  keyMap: Map<string, GenericReturnType> = new Map();
  indexMap: Map<string, number> = new Map();
  // Track reactive index formulas for cleanup (dev mode only)
  indexFormulaMap: Map<string, MergedCell> = new Map();
  nodes: Node[] = [];
  [RENDERED_NODES_PROPERTY]: Array<Node> = [];
  [COMPONENT_ID_PROPERTY] = cId();
  ItemComponent: (
    item: T,
    index: number | MergedCell,
    ctx: Component<any>,
  ) => GenericReturnType;
  bottomMarker!: Comment;
  topMarker!: Comment;
  key: string = '@identity';
  tag!: Cell<T[]> | MergedCell;
  isSync = false;
  isFirstRender = true;
  get ctx() {
    return this;
  }
  *keyGenerator(items: T[], keyForItem: (item: T, index: number) => string) {
    for (let i = 0; i < items.length; i++) {
      yield keyForItem(items[i], i);
    }
  }
  declare api: DOMApi;
  constructor(
    { tag, ctx, key, ItemComponent }: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    this.api = initDOM(ctx);
    this.ItemComponent = ItemComponent;
    // Propagate $_eval from parent context for deferred rendering
    // @ts-expect-error $_eval may exist on ctx
    if (ctx?.$_eval) {
      // @ts-expect-error $_eval may exist
      this.$_eval = ctx.$_eval;
    }
    // @ts-expect-error typings error
    addToTree(ctx, this, 'from list constructor');
    const mainNode = outlet;
    this[RENDERED_NODES_PROPERTY] = [];
    if (key) {
      this.key = key;
    }
    this.setupKeyForItem();
    // Register destructor to clean up the list's own TREE/PARENT/CHILD entries
    const listId = this[COMPONENT_ID_PROPERTY];
    registerDestructor(ctx, () => {
      CHILD.delete(listId);
      TREE.delete(listId);
      PARENT.delete(listId);
    });
    if (IS_DEV_MODE) {
      Object.defineProperty(this, $_debug_args, {
        get() {
          return {
            list: this.tag,
            key: this.key,
          };
        },
      });
      LISTS_FOR_HMR.add(this);
      registerDestructor(ctx, () => {
        LISTS_FOR_HMR.delete(this);
      });
    }
    // "list bottom marker"
    if (IS_DEV_MODE) {
      this.bottomMarker = this.api.comment('list bottom marker');
    } else {
      this.bottomMarker = this.api.comment();
    }
    this.topMarker = topMarker;
    if (IS_DEV_MODE) {
      // HMR logic
      this[RENDERED_NODES_PROPERTY] = [topMarker];
    }

    this.api.insert(mainNode, this.topMarker);
    this.api.insert(mainNode, this.bottomMarker);

    const originalTag = tag;

    if (!isTagLike(tag)) {
      if (isArray(tag)) {
        console.warn('iterator for @each should be a cell');
        tag = new Cell(tag, 'list tag');
      } else if (isFn(originalTag)) {
        tag = formula(() => deepFnValue(originalTag), 'list tag');
        registerDestructor(ctx, () => {
          (tag as MergedCell).destroy();
        });
      }
    }
    this.tag = tag;
  }
  setupKeyForItem() {
    if (this.key === '@identity') {
      let cnt = 0;
      const map: WeakMap<T, string> = new WeakMap();
      this.keyForItem = (item: T, i: number) => {
        if (isPrimitive(item) || isEmpty(item)) {
          return `${String(item)}:${i}`;
        }
        const existing = map.get(item);
        if (existing !== undefined) {
          return existing;
        }
        const key = ++cnt as unknown as string;
        map.set(item, key);
        return key;
      };
    } else {
      this.keyForItem = (item: T) => {
        if (IS_DEV_MODE) {
          if (this.key.split('.').length > 1) {
            console.warn(
              'Nested keys are not supported yet, likely you need to specify custom keyForItem function',
            );
            const resolvedKeyValue = this.key.split('.').reduce((acc, key) => {
              // @ts-expect-error unknown key
              return acc[key];
            }, item);
            console.log({ resolvedKeyValue, key: this.key, item });
            return String(resolvedKeyValue);
          }
          // @ts-expect-error unknown key
          if (typeof item[this.key] === 'undefined') {
            throw new Error(
              `Key for item not found, ${JSON.stringify(item)} ${this.key}`,
            );
          }
        }
        // @ts-expect-error unknown key
        return item[this.key] as unknown as string;
      };
    }
  }
  // @ts-expect-error non-string return type
  keyForItem(item: T, index: number): string {
    if (IS_DEV_MODE) {
      throw new Error(`Key for item not implemented, ${JSON.stringify(item)}`);
    }
  }
  getTargetNode(amountOfKeys: number) {
    if (amountOfKeys > 0) {
      return this.bottomMarker;
    } else {
      let fragment!: DocumentFragment;
      // list fragment marker
      const marker = IS_DEV_MODE
        ? this.api.comment('list fragment target marker')
        : this.api.comment('');
      if (isRehydrationScheduled()) {
        fragment = this.api.parent(marker) as unknown as DocumentFragment;
        // TODO: figure out, likely error here, because we don't append fragment
      } else {
        fragment = this.api.fragment();
        this.api.insert(fragment, marker);
      }
      return marker;
    }
  }
  updateItems(items: T[], amountOfKeys: number, removedIndexes: number[]) {
    const {
      indexMap,
      keyMap,
      bottomMarker,
      keyForItem,
      ItemComponent,
      isFirstRender,
      api,
    } = this;
    const rowsToMove: Array<[GenericReturnType, number]> = [];
    const amountOfExistingKeys = amountOfKeys - removedIndexes.length;
    if (removedIndexes.length > 0 && keyMap.size > 0) {
      removedIndexes.sort((a, b) => a - b);
      for (const key of keyMap.keys()) {
        let keyIndex = indexMap.get(key)!;
        const count = countLessThan(removedIndexes, keyIndex);
        if (count !== 0) {
          indexMap.set(key, keyIndex - count);
        }
      }
    }

    let targetNode = items.length
      ? this.getTargetNode(amountOfExistingKeys)
      : bottomMarker;
    let seenKeys = 0;
    let isAppendOnly = isFirstRender;
    setParentContext(this as unknown as ComponentLike);
    items.forEach((item, index) => {
      if (seenKeys === amountOfExistingKeys) {
        isAppendOnly = true;
        if (targetNode === bottomMarker) {
          // optimization for appending items case
          targetNode = this.getTargetNode(0);
        }
      }

      const key = keyForItem(item, index);
      const maybeRow = keyMap.get(key);
      if (!maybeRow) {
        let idx: number | MergedCell = index;
        if (IS_DEV_MODE) {
          // @todo - add `hasIndex` argument to compiler to tree-shake this
          // for now reactive indexes works only in dev mode
          const indexFormula = formula(() => {
            if (isPrimitive(item)) {
              return index;
            }
            const values = this.tag.value as T[];
            const itemIndex = values.indexOf(item);
            if (itemIndex === -1) {
              return values.findIndex((value: T, i) => {
                return keyForItem(value, i) === key;
              });
            }
            return itemIndex;
          }, `each.index[${index}]`);
          idx = indexFormula;
          // Track formula for cleanup when item is destroyed
          this.indexFormulaMap.set(key, indexFormula);
        }

        const row = ItemComponent(item, idx, this as unknown as Component<any>);

        keyMap.set(key, row);
        indexMap.set(key, index);
        if (isAppendOnly) {
          // TODO: in ssr parentNode may not exist
          renderElement(api, this as unknown as ComponentLike, api.parent(targetNode)!, row, targetNode);
        } else {
          rowsToMove.push([row, index]);
        }
      } else {
        seenKeys++;
        const expectedIndex = indexMap.get(key)!;
        if (expectedIndex !== index) {
          indexMap.set(key, index);
          rowsToMove.push([maybeRow, index]);
        }
      }
    });
    setParentContext(null);
    rowsToMove
      .sort((r1, r2) => {
        return r2[1] - r1[1];
      })
      .forEach(([row, index]) => {
        const nextItem = items[index + 1];
        const insertBeforeNode = nextItem
          ? getFirstNode(api, keyMap.get(keyForItem(nextItem, index + 1))!)
          : bottomMarker;
        renderElement(
          api,
          this as unknown as ComponentLike,
          api.parent(insertBeforeNode)!,
          row,
          insertBeforeNode,
        );
      });
    if (targetNode !== bottomMarker) {
      const parent = api.parent(targetNode)!;
      const trueParent = api.parent(bottomMarker)!;
      // parent may not exist in rehydration
      if (!IN_SSR_ENV) {
        if (parent) {
          api.destroy(targetNode);
        }
      }
      if (parent && trueParent !== parent) {
        api.insert(trueParent, parent, bottomMarker);
      }
    }
    if (isFirstRender) {
      this.isFirstRender = false;
    }
  }
}

export class SyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  constructor(
    params: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    super(params, outlet, topMarker);
    registerDestructor(
      params.ctx,
      () => this.syncList([]),
      opcodeFor(this.tag, (value) => {
        this.syncList(value as T[]);
      }),
    );
  }
  fastCleanup() {
    const { keyMap, bottomMarker, topMarker, indexMap, indexFormulaMap, api } = this;
    const parent = api.parent(bottomMarker);
    if (
      parent &&
      parent.lastChild === bottomMarker &&
      parent.firstChild === topMarker
    ) {
      for (const value of keyMap.values()) {
        destroyElementSync(value as ComponentLike, true, this.api);
      }
      // Clean up all reactive index formulas
      for (const formula of indexFormulaMap.values()) {
        formula.destroy();
      }
      this.api.clearChildren(parent);
      this.api.insert(parent, topMarker);
      this.api.insert(parent, bottomMarker);
      keyMap.clear();
      indexMap.clear();
      indexFormulaMap.clear();
      return true;
    } else {
      return false;
    }
  }
  syncList(items: T[]) {
    const { keyMap, keyForItem, indexMap } = this;
    if (items.length === 0 && !this.isFirstRender) {
      if (this.fastCleanup()) {
        return;
      }
    }
    let amountOfKeys = keyMap.size;

    const indexesToRemove: number[] = [];

    if (amountOfKeys > 0) {
      const updatingKeys = new Set(this.keyGenerator(items, keyForItem));
      const keysToRemove: string[] = [];
      const rowsToRemove: GenericReturnType[] = [];

      for (const [key, row] of keyMap.entries()) {
        if (updatingKeys.has(key)) {
          continue;
        }
        keysToRemove.push(key);
        rowsToRemove.push(row);
        indexesToRemove.push(indexMap.get(key)!);
      }
      if (keysToRemove.length) {
        if (keysToRemove.length === amountOfKeys) {
          if (this.fastCleanup()) {
            amountOfKeys = 0;
            keysToRemove.length = 0;
            indexesToRemove.length = 0;
          }
        }
        for (let i = 0; i < keysToRemove.length; i++) {
          this.destroyItem(rowsToRemove[i], keysToRemove[i]);
        }
      }
    }
    this.updateItems(items, amountOfKeys, indexesToRemove);
  }
  destroyItem(row: GenericReturnType, key: string) {
    this.keyMap.delete(key);
    this.indexMap.delete(key);
    // Clean up reactive index formula if it exists
    const indexFormula = this.indexFormulaMap.get(key);
    if (indexFormula) {
      indexFormula.destroy();
      this.indexFormulaMap.delete(key);
    }
    destroyElementSync(row as ComponentLike, false, this.api);
  }
}

export class AsyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  destroyPromise: Promise<void[]> | null = null;
  constructor(
    params: ListComponentArgs<any>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    super(params, outlet, topMarker);
    registerDestructor(
      params.ctx,
      () => {
        if (this.destroyPromise) {
          return this.destroyPromise;
        }
      },
      async () => {
        await this.syncList([]);
      },
      opcodeFor(this.tag, async (value) => {
        await this.syncList(value as T[]);
      }),
    );
  }
  async fastCleanup() {
    const { bottomMarker, topMarker, keyMap, indexMap, indexFormulaMap, api } = this;
    const parent = api.parent(bottomMarker);
    if (
      parent &&
      parent.lastChild === bottomMarker &&
      parent.firstChild === topMarker
    ) {
      const promises = new Array(keyMap.size);
      let i = 0;
      for (const value of keyMap.values()) {
        promises[i] = destroyElement(value as ComponentLike, true, this.api);
        i++;
      }
      await Promise.all(promises);
      promises.length = 0;
      // Clean up all reactive index formulas
      for (const formula of indexFormulaMap.values()) {
        formula.destroy();
      }
      this.api.clearChildren(parent);
      this.api.insert(parent, topMarker);
      this.api.insert(parent, bottomMarker);
      keyMap.clear();
      indexMap.clear();
      indexFormulaMap.clear();
      return true;
    } else {
      return false;
    }
  }
  async syncList(items: T[]) {
    if (items.length === 0 && !this.isFirstRender) {
      if (await this.fastCleanup()) {
        return;
      }
    }
    const { keyMap, keyForItem, indexMap } = this;
    let amountOfKeys = keyMap.size;
    const indexesToRemove: number[] = [];

    if (amountOfKeys > 0) {
      const keysToRemove: string[] = [];
      const rowsToRemove: GenericReturnType[] = [];
      const removeQueue: Array<Promise<void>> = [];

      const updatingKeys = new Set(this.keyGenerator(items, keyForItem));
      for (const [key, row] of keyMap.entries()) {
        if (updatingKeys.has(key)) {
          continue;
        }
        keysToRemove.push(key);
        rowsToRemove.push(row);
        indexesToRemove.push(indexMap.get(key)!);
      }
      if (keysToRemove.length) {
        if (keysToRemove.length === amountOfKeys) {
          if (await this.fastCleanup()) {
            amountOfKeys = 0;
            keysToRemove.length = 0;
            indexesToRemove.length = 0;
          }
        }

        for (let i = 0; i < keysToRemove.length; i++) {
          removeQueue.push(this.destroyItem(rowsToRemove[i], keysToRemove[i]));
        }
      }

      const removePromise = Promise.all(removeQueue);

      if (removeQueue.length) {
        this.destroyPromise = removePromise;
        removePromise.then(() => {
          this.destroyPromise = null;
        });
      }
    }
    this.updateItems(items, amountOfKeys, indexesToRemove);
  }
  async destroyItem(row: GenericReturnType, key: string) {
    this.keyMap.delete(key);
    this.indexMap.delete(key);
    // Clean up reactive index formula if it exists
    const indexFormula = this.indexFormulaMap.get(key);
    if (indexFormula) {
      indexFormula.destroy();
      this.indexFormulaMap.delete(key);
    }
    await destroyElement(row as ComponentLike, false, this.api);
  }
}
