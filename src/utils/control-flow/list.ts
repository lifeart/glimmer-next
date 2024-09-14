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
            return `${String(item)}:${i}`;
          }
          if (isPrimitive(item)) {
            console.warn(`Iteration over primitives is not supported yet`);
            return `${String(item)}:${i}`;
          }
        }
        const key = map.get(item);
        if (typeof key === 'string') {
          return key;
        } else {
          cnt++;
          let value = String(cnt);
          map.set(item, value);
          return value;
        }
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
  updateItems(
    items: T[],
    amountOfKeys: number,
    keysToRemove: string[],
    removedIndexes: number[],
  ) {
    const rowsToMove: Array<[GenericReturnType, number]> = [];
    const amountOfExistingKeys = amountOfKeys - keysToRemove.length;
    const { indexMap, keyMap, bottomMarker, keyForItem, ItemComponent } = this;
    const isFirstRender = this.isFirstRender;
    if (removedIndexes.length > 0 && keyMap.size > 0) {
      for (const key of keyMap.keys()) {
        let keyIndex = indexMap.get(key)!;
        removedIndexes.forEach((index) => {
          if (keyIndex > index) {
            keyIndex--;
          }
        });
        this.indexMap.set(key, keyIndex);
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
      }
      if (seenKeys === amountOfExistingKeys && targetNode === bottomMarker) {
        // optimization for appending items case
        targetNode = this.getTargetNode(0);
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
          // TODO: optimize this
          for (const key of keyMap.keys()) {
            let keyIndex = indexMap.get(key)!;
            if (keyIndex > index) {
              keyIndex++;
            }
            this.indexMap.set(key, keyIndex);
          }
        }
      } else {
        seenKeys++;
        const expectedIndex = indexMap.get(key)!;
        if (expectedIndex !== index && !appendedIndexes.has(expectedIndex)) {
          rowsToMove.push([maybeRow, index]);
          indexMap.set(key, index);
        }
      }
    });
    // iterate over rows to move and move them

    rowsToMove.forEach(([row, index]) => {
      const nextItem = items[index + 1];
      if (nextItem === undefined) {
        renderElement(bottomMarker.parentNode!, row, bottomMarker);
      } else {
        const nextKey = keyForItem(nextItem, index + 1);
        const nextRow = keyMap.get(nextKey)!;
        const firstNode = getFirstNode(nextRow);
        if (nextRow !== undefined && firstNode !== undefined) {
          const parent = firstNode.parentNode!;
          renderElement(parent, row, firstNode);
        }
      }
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
  constructor(params: ListComponentArgs<T>, outlet: RenderTarget, topMarker: Comment) {
    super(params, outlet, topMarker);
    associateDestroyable(params.ctx, [
      opcodeFor(this.tag, (value) => {
        this.syncList(value as T[]);
      }),
    ]);
  }
  syncList(items: T[]) {
    if (items.length === 0) {
      const parent = this.bottomMarker.parentElement;
      if (parent && parent.lastChild === this.bottomMarker && parent.firstChild === this.topMarker) {
        this.keyMap.forEach((value) => {
          destroyElementSync(value, true);
        });
        parent.innerHTML = '';
        parent.append(this.topMarker);
        parent.append(this.bottomMarker);
        this.keyMap.clear();
        this.indexMap.clear();
        return;
      } 
    }
    const { keyMap, indexMap, keyForItem } = this;
    const existingKeys = Array.from(keyMap.keys());
    const updatingKeys = new Set(items.map((item, i) => keyForItem(item, i)));
    const removedIndexes: number[] = [];
    const keysToRemove = existingKeys.filter((key) => {
      const isRemoved = !updatingKeys.has(key);
      if (isRemoved) {
        const row = keyMap.get(key)!;
        removedIndexes.push(indexMap.get(key)!);
        this.destroyItem(row, key);
      }
      return isRemoved;
    });
    const amountOfKeys = existingKeys.length;
    this.updateItems(items, amountOfKeys, keysToRemove, removedIndexes);
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
  constructor(params: ListComponentArgs<any>, outlet: RenderTarget, topMarker: Comment) {
    super(params, outlet, topMarker);
    associateDestroyable(params.ctx, [
      opcodeFor(this.tag, async (value) => {
        await this.syncList(value as T[]);
      }),
    ]);
  }
  async syncList(items: T[]) {
    if (items.length === 0) {
      const parent = this.bottomMarker.parentElement;
      if (parent && parent.lastChild === this.bottomMarker && parent.firstChild === this.topMarker) {
        const promises = new Array(this.keyMap.size);
        let i = 0;
        this.keyMap.forEach((value) => {
          promises[i] = destroyElement(value, true);
          i++;
        });
        await Promise.all(promises);
        promises.length = 0;
        parent.innerHTML = '';
        parent.append(this.topMarker);
        parent.append(this.bottomMarker);
        this.keyMap.clear();
        this.indexMap.clear();
        return;
      } 
    }
    const { keyMap, indexMap, keyForItem } = this;
    const existingKeys = Array.from(keyMap.keys());
    const updatingKeys = new Set(items.map((item, i) => keyForItem(item, i)));
    const removedIndexes: number[] = [];
    const removeQueue: Array<Promise<void>> = [];
    const keysToRemove = existingKeys.filter((key) => {
      const isRemoved = !updatingKeys.has(key);
      if (isRemoved) {
        const row = keyMap.get(key)!;
        removedIndexes.push(indexMap.get(key)!);
        removeQueue.push(this.destroyItem(row, key));
      }
      return isRemoved;
    });
    const amountOfKeys = existingKeys.length;

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
    this.updateItems(items, amountOfKeys, keysToRemove, removedIndexes);
  }
  async destroyItem(row: GenericReturnType, key: string) {
    this.keyMap.delete(key);
    this.indexMap.delete(key);
    await destroyElement(row);
  }
}
