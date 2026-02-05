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
  List manager for rendering and syncing arrays of items.
  Uses per-item comment markers for stable DOM boundaries,
  LIS-based move minimization, and DocumentFragment batching.

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

/**
 * Compute positions in `arr` that form the Longest Increasing Subsequence.
 * Items at these positions are already in correct relative order and don't
 * need to be relocated.  O(n log n) time, O(n) space.
 */
export function longestIncreasingSubsequence(arr: number[], out?: Set<number>): Set<number> {
  const n = arr.length;
  const result = out ?? new Set<number>();
  if (out) out.clear();
  if (n === 0) return result;
  // tails[i] = smallest tail value for an increasing subsequence of length i+1
  const tails: number[] = [];
  // tailIdx[i] = index in arr where tails[i] was found
  const tailIdx: number[] = [];
  // pred[i] = index in arr of the predecessor of arr[i] in the IS
  const pred: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    let lo = 0,
      hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < arr[i]) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = arr[i];
    tailIdx[lo] = i;
    pred[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }

  // Reconstruct: walk predecessors back from the last element of the LIS
  let k = tailIdx[tails.length - 1];
  for (let i = tails.length - 1; i >= 0; i--) {
    result.add(k);
    k = pred[k];
  }
  return result;
}

export class BasicListComponent<T extends { id: number }> {
  keyMap: Map<string, GenericReturnType> = new Map();
  indexMap: Map<string, number> = new Map();
  // Track reactive index formulas for cleanup (dev mode only, lazily initialized)
  indexFormulaMap: Map<string, MergedCell> | null = null;
  // Track per-item markers for stable relocation boundaries
  itemMarkers: Map<string, Comment> = new Map();
  markerSet: Set<Comment> = new Set();
  // Reusable arrays/sets — cleared per update to avoid GC pressure
  private _moveKeys: string[] = [];
  private _moveIndices: number[] = [];
  private _moveIsNew: boolean[] = [];
  private _existKeys: string[] = [];
  private _existNewIdx: number[] = [];
  private _existOldIdx: number[] = [];
  private _order: number[] = [];
  private _lisResult: Set<number> = new Set();
  private _updatingKeys: Set<string> = new Set();
  protected _keysToRemove: string[] = [];
  protected _rowsToRemove: GenericReturnType[] = [];
  protected _indexesToRemove: number[] = [];
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
  isFirstRender = true;
  get ctx() {
    return this;
  }
  protected keysForItems(items: T[], keyForItem: (item: T, index: number) => string): Set<string> {
    const set = this._updatingKeys;
    set.clear();
    for (let i = 0; i < items.length; i++) {
      set.add(keyForItem(items[i], i));
    }
    return set;
  }
  // Cached fragment reused across relocateItem calls to avoid allocating new ones
  private _relocateFragment!: DocumentFragment;
  declare api: DOMApi;
  constructor(
    { tag, ctx, key, ItemComponent }: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    this.api = initDOM(ctx);
    this._relocateFragment = this.api.fragment();
    this.ItemComponent = ItemComponent;
    // Propagate $_eval from parent context for deferred rendering
    if (WITH_DYNAMIC_EVAL) {
      // @ts-expect-error $_eval may exist on ctx
      if (ctx?.$_eval) {
        // @ts-expect-error $_eval may exist
        this.$_eval = ctx.$_eval;
      }
    }
    // @ts-expect-error typings error
    addToTree(ctx, this, 'from list constructor');
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
      this.itemMarkers.clear();
      this.markerSet.clear();
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
      // HMR / inspector bounds: topMarker..bottomMarker defines the full list extent
      this[RENDERED_NODES_PROPERTY] = [topMarker, this.bottomMarker];
    }

    this.api.insert(outlet, this.topMarker);
    this.api.insert(outlet, this.bottomMarker);

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
  private relocateItem(marker: Comment, anchor: Node, parent: Node) {
    const { markerSet, bottomMarker, _relocateFragment: fragment } = this;
    // Find end boundary: next item marker or bottomMarker
    let end: Node = bottomMarker;
    let node: Node | null = marker.nextSibling;
    while (node && node !== bottomMarker) {
      if (markerSet.has(node as Comment)) {
        end = node;
        break;
      }
      node = node.nextSibling;
    }
    // Item already immediately precedes the anchor — nothing to move
    if (end === anchor) return;
    // Collect marker + content into reusable fragment
    node = marker;
    let next: Node | null;
    while (node && node !== end) {
      next = node.nextSibling;
      this.api.insert(fragment, node);
      node = next;
    }
    this.api.insert(parent, fragment, anchor);
  }
  protected removeMarker(key: string) {
    const marker = this.itemMarkers.get(key);
    if (!marker) return;
    this.itemMarkers.delete(key);
    this.markerSet.delete(marker);
    if (marker.isConnected) {
      this.api.destroy(marker);
    }
  }
  private setupKeyForItem() {
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
  private getTargetNode(amountOfKeys: number) {
    if (amountOfKeys > 0) {
      return this.bottomMarker;
    } else {
      let fragment!: DocumentFragment;
      // list fragment marker
      const marker = IS_DEV_MODE
        ? this.api.comment('list fragment target marker')
        : this.api.comment();
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
      itemMarkers,
      markerSet,
      _moveKeys: moveKeys,
      _moveIndices: moveIndices,
      _moveIsNew: moveIsNew,
      _existKeys: existKeys,
      _existNewIdx: existNewIdx,
      _existOldIdx: existOldIdx,
      _lisResult: lisResult,
      _order: order,
    } = this;
    moveKeys.length = 0;
    moveIndices.length = 0;
    moveIsNew.length = 0;
    existKeys.length = 0;
    existNewIdx.length = 0;
    existOldIdx.length = 0;

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

    const self = this as unknown as ComponentLike;
    let targetNode = items.length
      ? this.getTargetNode(amountOfExistingKeys)
      : bottomMarker;
    let seenKeys = 0;
    let isAppendOnly = isFirstRender;
    setParentContext(self);
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (seenKeys === amountOfExistingKeys) {
        isAppendOnly = true;
        if (targetNode === bottomMarker) {
          // optimization for appending items case
          targetNode = this.getTargetNode(0);
        }
      }

      const key = keyForItem(item, index);
      if (!keyMap.has(key)) {
        let marker = itemMarkers.get(key);
        if (!marker) {
          marker = IS_DEV_MODE
            ? api.comment(`list item ${key}`)
            : api.comment();
          itemMarkers.set(key, marker);
          markerSet.add(marker);
        }
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
          if (!this.indexFormulaMap) this.indexFormulaMap = new Map();
          this.indexFormulaMap.set(key, indexFormula);
        }

        const row = ItemComponent(item, idx, self as unknown as Component<any>);

        keyMap.set(key, row);
        indexMap.set(key, index);
        if (isAppendOnly) {
          // TODO: in ssr parentNode may not exist
          const parent = api.parent(targetNode)!;
          api.insert(parent, marker, targetNode);
          renderElement(
            api,
            self,
            parent,
            row,
            targetNode,
          );
        } else {
          moveKeys.push(key);
          moveIndices.push(index);
          moveIsNew.push(true);
        }
      } else {
        seenKeys++;
        const oldIndex = indexMap.get(key)!;
        existKeys.push(key);
        existNewIdx.push(index);
        existOldIdx.push(oldIndex);
        if (oldIndex !== index) {
          indexMap.set(key, index);
        }
      }
    }

    // Use LIS on existing items' old indices (in new-list order) to find
    // the largest subset already in correct relative order.  Only items
    // outside the LIS need actual DOM relocation.
    if (existKeys.length > 1) {
      const stable = longestIncreasingSubsequence(existOldIdx, lisResult);
      for (let i = 0; i < existKeys.length; i++) {
        if (!stable.has(i)) {
          moveKeys.push(existKeys[i]);
          moveIndices.push(existNewIdx[i]);
          moveIsNew.push(false);
        }
      }
    } else if (existKeys.length === 1 && existOldIdx[0] !== existNewIdx[0]) {
      // Single existing item that changed position
      moveKeys.push(existKeys[0]);
      moveIndices.push(existNewIdx[0]);
      moveIsNew.push(false);
    }

    setParentContext(null);

    const moveLen = moveKeys.length;
    if (moveLen > 0) {
      const moveParent = api.parent(bottomMarker)!;
      // Sort descending by index when multiple moves; skip for single move
      if (moveLen > 1) {
        order.length = moveLen;
        for (let i = 0; i < moveLen; i++) order[i] = i;
        order.sort((a, b) => moveIndices[b] - moveIndices[a]);
      }

      for (let oi = 0; oi < moveLen; oi++) {
        const i = moveLen === 1 ? 0 : order[oi];
        const key = moveKeys[i];
        const marker = itemMarkers.get(key);
        if (!marker) continue;

        const idx = moveIndices[i];
        const nextItem = items[idx + 1];
        const insertBeforeNode = nextItem
          ? itemMarkers.get(keyForItem(nextItem, idx + 1)) ?? bottomMarker
          : bottomMarker;

        if (moveIsNew[i]) {
          api.insert(moveParent, marker, insertBeforeNode);
          renderElement(api, self, moveParent, keyMap.get(key)!, insertBeforeNode);
        } else {
          this.relocateItem(marker, insertBeforeNode, moveParent);
        }
      }
    }
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
    const {
      keyMap,
      bottomMarker,
      topMarker,
      indexMap,
      indexFormulaMap,
      api,
    } = this;
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
      if (indexFormulaMap) {
        for (const formula of indexFormulaMap.values()) {
          formula.destroy();
        }
        indexFormulaMap.clear();
      }
      this.api.clearChildren(parent);
      this.api.insert(parent, topMarker);
      this.api.insert(parent, bottomMarker);
      keyMap.clear();
      indexMap.clear();
      this.itemMarkers.clear();
      this.markerSet.clear();
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

    const indexesToRemove = this._indexesToRemove;
    indexesToRemove.length = 0;

    if (amountOfKeys > 0) {
      const updatingKeys = this.keysForItems(items, keyForItem);
      const keysToRemove = this._keysToRemove;
      const rowsToRemove = this._rowsToRemove;
      keysToRemove.length = 0;
      rowsToRemove.length = 0;

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
      // Release references to destroyed rows
      rowsToRemove.length = 0;
    }
    this.updateItems(items, amountOfKeys, indexesToRemove);
  }
  destroyItem(row: GenericReturnType, key: string) {
    const { keyMap, indexMap, indexFormulaMap } = this;
    keyMap.delete(key);
    indexMap.delete(key);
    // Clean up reactive index formula if it exists
    if (indexFormulaMap) {
      const formula = indexFormulaMap.get(key);
      if (formula) {
        formula.destroy();
        indexFormulaMap.delete(key);
      }
    }
    destroyElementSync(row as ComponentLike, false, this.api);
    this.removeMarker(key);
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
    const {
      bottomMarker,
      topMarker,
      keyMap,
      indexMap,
      indexFormulaMap,
      api,
    } = this;
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
      if (indexFormulaMap) {
        for (const formula of indexFormulaMap.values()) {
          formula.destroy();
        }
        indexFormulaMap.clear();
      }
      this.api.clearChildren(parent);
      this.api.insert(parent, topMarker);
      this.api.insert(parent, bottomMarker);
      keyMap.clear();
      indexMap.clear();
      this.itemMarkers.clear();
      this.markerSet.clear();
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
    const indexesToRemove = this._indexesToRemove;
    indexesToRemove.length = 0;

    if (amountOfKeys > 0) {
      const keysToRemove = this._keysToRemove;
      const rowsToRemove = this._rowsToRemove;
      keysToRemove.length = 0;
      rowsToRemove.length = 0;
      const removeQueue: Array<Promise<void>> = [];

      const updatingKeys = this.keysForItems(items, keyForItem);
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
      // Release references to destroyed rows
      rowsToRemove.length = 0;

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
    const { keyMap, indexMap, indexFormulaMap } = this;
    keyMap.delete(key);
    indexMap.delete(key);
    // Clean up reactive index formula if it exists
    if (indexFormulaMap) {
      const formula = indexFormulaMap.get(key);
      if (formula) {
        formula.destroy();
        indexFormulaMap.delete(key);
      }
    }
    await destroyElement(row as ComponentLike, false, this.api);
    this.removeMarker(key);
  }
}
