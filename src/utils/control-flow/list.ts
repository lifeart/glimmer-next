import {
  ComponentReturnType,
  associateDestroyable,
  destroyElement,
  destroyElementSync,
  removeDestructor,
  renderElement,
  type Component,
} from '@/utils/component';
import { api } from '@/utils/dom-api';
import { Cell, MergedCell, formula, deepFnValue } from '@/utils/reactive';
import { opcodeFor } from '@/utils/vm';
import {
  $_debug_args,
  $nodes,
  IN_SSR_ENV,
  isArray,
  isFn,
  isPrimitive,
  isTagLike,
  LISTS_FOR_HMR,
} from '@/utils/shared';
import { isRehydrationScheduled } from '@/utils/ssr/rehydration';

export function getFirstNode(
  rawItem:
    | Node
    | ComponentReturnType
    | GenericReturnType
    | Array<Node | ComponentReturnType | GenericReturnType>,
): Node {
  if (isArray(rawItem)) {
    return getFirstNode(rawItem[0]);
  } else if ('nodeType' in rawItem) {
    return rawItem;
  } else {
    return getFirstNode(rawItem[$nodes][0]);
  }
}

/*
  This is a list manager, it's used to render and sync a list of items.
  It's a proof of concept, it's not optimized, it's not a final API.

  Based on Glimmer-VM list update logic.
*/
type GenericReturnType = Array<ComponentReturnType | Node>;

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
  nodes: Node[] = [];
  parentCtx!: Component<any>;
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
  constructor(
    { tag, ctx, key, ItemComponent }: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    this.ItemComponent = ItemComponent;
    this.parentCtx = ctx;
    const mainNode = outlet;
    this[$nodes] = [];
    if (key) {
      this.key = key;
    }
    this.setupKeyForItem();
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
      associateDestroyable(ctx, [
        () => {
          LISTS_FOR_HMR.delete(this);
        },
      ]);
    }
    // "list bottom marker"
    if (IS_DEV_MODE) {
      this.bottomMarker = api.comment('list bottom marker');
    } else {
      this.bottomMarker = api.comment();
    }
    this.topMarker = topMarker;

    api.append(mainNode, this.topMarker);
    api.append(mainNode, this.bottomMarker);

    const originalTag = tag;

    if (!isTagLike(tag)) {
      if (isArray(tag)) {
        console.warn('iterator for @each should be a cell');
        tag = new Cell(tag, 'list tag');
      } else if (isFn(originalTag)) {
        tag = formula(() => deepFnValue(originalTag), 'list tag');
        associateDestroyable(ctx, [
          () => {
            (tag as MergedCell).destroy();
          },
        ]);
      }
    }
    this.tag = tag;
  }
  setupKeyForItem() {
    if (this.key === '@identity') {
      let cnt = 0;
      const map: WeakMap<T, string> = new WeakMap();
      this.keyForItem = (item: T, i: number) => {
        if (IS_DEV_MODE) {
          if (typeof item === 'undefined' || item === null) {
            console.warn(`Iteration over null, undefined is not supported yet`);
            return `${String(item)}:${i}`;
          }
          if (isPrimitive(item)) {
            console.warn(`Iteration over primitives is not supported yet`);
            return `${String(item)}:${i}`;
          }
        }
        if (!map.has(item)) {
          map.set(item, String(++cnt));
        }
        return map.get(item)!;
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
        return String(item[this.key]);
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
        ? api.comment('list fragment target marker')
        : api.comment('');
      if (isRehydrationScheduled()) {
        fragment = marker.parentElement as unknown as DocumentFragment;
      } else {
        fragment = api.fragment();
        api.append(fragment, marker);
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
    const appendedIndexes = new Set<number>();
    let isAppendOnly = isFirstRender;
    items.forEach((item, index) => {
      // @todo - fix here
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
        if (!isAppendOnly) {
          appendedIndexes.add(index);
        }
        let idx: number | MergedCell = index;
        if (IS_DEV_MODE) {
          // @todo - add `hasIndex` argument to compiler to tree-shake this
          // for now reactive indexes works only in dev mode
          idx = formula(() => {
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
        }
        const row = ItemComponent(item, idx, this as unknown as Component<any>);
        keyMap.set(key, row);
        indexMap.set(key, index);
        if (isAppendOnly) {
          renderElement(targetNode.parentNode!, row, targetNode);
        } else {
          rowsToMove.push([row, index]);
          // TODO: optimize
          for (let [mapKey, value] of indexMap) {
            if (value === index && key !== mapKey) {
              indexMap.set(mapKey, index + 1);
            }
          }
        }
      } else {
        seenKeys++;
        const expectedIndex = indexMap.get(key)!;
        if (expectedIndex !== index && !appendedIndexes.has(expectedIndex)) {
          indexMap.set(key, index);
          rowsToMove.push([maybeRow, index]);
        }
      }
    });

    rowsToMove
      .sort((r1, r2) => {
        return r2[1] - r1[1];
      })
      .forEach(([row, index]) => {
        const nextItem = items[index + 1];
        const insertBeforeNode = nextItem
          ? getFirstNode(keyMap.get(keyForItem(nextItem, index + 1))!)
          : bottomMarker;
        renderElement(insertBeforeNode.parentNode!, row, insertBeforeNode);
      });
    if (targetNode !== bottomMarker) {
      const parent = targetNode.parentNode!;
      const trueParent = bottomMarker.parentNode!;
      // parent may not exist in rehydration
      if (!IN_SSR_ENV) {
        parent && parent.removeChild(targetNode);
      }
      if (trueParent !== parent) {
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
    associateDestroyable(params.ctx, [
      opcodeFor(this.tag, (value) => {
        this.syncList(value as T[]);
      }),
    ]);
  }
  fastCleanup() {
    const { keyMap, indexMap, bottomMarker, topMarker } = this;
    const parent = bottomMarker.parentElement;
    if (
      parent &&
      parent.lastChild === bottomMarker &&
      parent.firstChild === topMarker
    ) {
      for (const value of keyMap.values()) {
        destroyElementSync(value, true);
      }
      parent.innerHTML = '';
      parent.append(topMarker);
      parent.append(bottomMarker);
      keyMap.clear();
      indexMap.clear();
      return true;
    } else {
      return false;
    }
  }
  syncList(items: T[]) {
    const { keyMap, keyForItem, indexMap } = this;
    if (items.length === 0) {
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
    destroyElementSync(row);
  }
}
export class AsyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  constructor(
    params: ListComponentArgs<any>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    super(params, outlet, topMarker);
    associateDestroyable(params.ctx, [
      opcodeFor(this.tag, async (value) => {
        await this.syncList(value as T[]);
      }),
    ]);
  }
  async fastCleanup() {
    const { bottomMarker, topMarker, keyMap, indexMap } = this;
    const parent = bottomMarker.parentElement;
    if (
      parent &&
      parent.lastChild === bottomMarker &&
      parent.firstChild === topMarker
    ) {
      const promises = new Array(keyMap.size);
      let i = 0;
      for (const value of keyMap.values()) {
        promises[i] = destroyElement(value, true);
        i++;
      }
      await Promise.all(promises);
      promises.length = 0;
      parent.innerHTML = '';
      parent.append(topMarker);
      parent.append(bottomMarker);
      keyMap.clear();
      indexMap.clear();
      return true;
    } else {
      return false;
    }
  }
  async syncList(items: T[]) {
    if (items.length === 0) {
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
        const destroyFn = async () => {
          await removePromise;
        };
        associateDestroyable(this.parentCtx, [destroyFn]);
        removePromise.then(() => {
          removeDestructor(this.parentCtx, destroyFn);
        });
      }
    }
    this.updateItems(items, amountOfKeys, indexesToRemove);
  }
  async destroyItem(row: GenericReturnType, key: string) {
    this.keyMap.delete(key);
    this.indexMap.delete(key);
    await destroyElement(row);
  }
}
