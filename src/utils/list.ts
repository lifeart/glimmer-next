import {
  ComponentReturnType,
  NodeReturnType,
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
  $node,
  $nodes,
  isFn,
  isPrimitive,
  isTagLike,
} from './shared';
import { isRehydrationScheduled } from './rehydration';

function setIndex(item: GenericReturnType, index: number) {
  item.forEach((item) => {
    item.index = index;
  });
}
function getIndex(item: GenericReturnType) {
  return item[0].index;
}
export function getFirstNode(
  rawItem:
    | Node
    | ComponentReturnType
    | NodeReturnType
    | GenericReturnType
    | Array<Node | ComponentReturnType | NodeReturnType | GenericReturnType>,
): Node {
  if (Array.isArray(rawItem)) {
    return getFirstNode(rawItem[0]);
  } else if ('nodeType' in rawItem) {
    return rawItem;
  } else if ($nodes in rawItem) {
    return getFirstNode(rawItem[$nodes]);
  } else {
    return getFirstNode(rawItem[$node]);
  }
}

/*
  This is a list manager, it's used to render and sync a list of items.
  It's a proof of concept, it's not optimized, it's not a final API.

  Based on Glimmer-VM list update logic.
*/
type GenericReturnType = Array<ComponentReturnType | NodeReturnType>;

type ListComponentArgs<T> = {
  tag: Cell<T[]> | MergedCell;
  key: string | null;
  ctx: Component<any>;
  ItemComponent: (item: T, index?: number | MergedCell) => GenericReturnType;
};
type RenderTarget = HTMLElement | DocumentFragment;
class BasicListComponent<T extends { id: number }> {
  keyMap: Map<string, GenericReturnType> = new Map();
  nodes: Node[] = [];
  index = 0;
  parentCtx!: Component<any>;
  ItemComponent: (
    item: T,
    index: number | MergedCell,
    ctx: Component<any>,
  ) => GenericReturnType;
  bottomMarker!: Comment;
  key: string = '@identity';
  tag!: Cell<T[]> | MergedCell;
  isSync = false;
  get ctx() {
    return this;
  }
  constructor(
    { tag, ctx, key, ItemComponent }: ListComponentArgs<T>,
    outlet: RenderTarget,
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
    }
    // "list bottom marker"
    if (IS_DEV_MODE) {
      this.bottomMarker = api.comment('list bottom marker');
    } else {
      this.bottomMarker = api.comment();
    }

    api.append(mainNode, this.bottomMarker);

    const originalTag = tag;

    if (!isTagLike(tag)) {
      if (Array.isArray(tag)) {
        console.warn('iterator for @each should be a cell');
        tag = new Cell(tag, 'list tag');
      } else if (isFn(originalTag)) {
        tag = formula(() => deepFnValue(originalTag), 'list tag');
      }
    }
    this.tag = tag;
  }
  setupKeyForItem() {
    if (this.key === '@identity') {
      let cnt = 0;
      const map: WeakMap<T, string> = new WeakMap();
      this.keyForItem = (item: T) => {
        if (IS_DEV_MODE) {
          if (isPrimitive(item)) {
            console.warn(`Iteration over primitives is not supported yet`);
            return String(item);
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
  keyForItem(item: T): string {
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
      const marker = api.comment('list fragment target marker');
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

    if (removedIndexes.length > 0 && this.keyMap.size > 0) {
      for (const value of this.keyMap.values()) {
        removedIndexes.forEach((index) => {
          value.forEach((item) => {
            if (item.index > index) {
              item.index--;
            }
          });
        });
      }
    }

    let targetNode = this.getTargetNode(amountOfKeys);
    let seenKeys = 0;
    items.forEach((item, index) => {
      // @todo - fix here
      if (
        seenKeys === amountOfExistingKeys &&
        targetNode === this.bottomMarker
      ) {
        // optimization for appending items case
        targetNode = this.getTargetNode(0);
      }
      const key = this.keyForItem(item);
      const maybeRow = this.keyMap.get(key);
      if (!maybeRow) {
        let idx: number | MergedCell = index;
        if (IS_DEV_MODE) {
          // @todo - add `hasIndex` argument to compiler to tree-shake this
          // for now reactive indexes works only in dev mode
          idx = formula(() => {
            const values = this.tag.value;
            const itemIndex = values.indexOf(item);
            if (itemIndex === -1) {
              return values.findIndex((value: T) => {
                return this.keyForItem(value) === key;
              });
            }
            return itemIndex;
          });
        }
        const row = this.ItemComponent(
          item,
          idx,
          this as unknown as Component<any>,
        );
        this.keyMap.set(key, row);
        row.forEach((item) => {
          renderElement(targetNode.parentNode!, item, targetNode);
          item.index = index;
        });
      } else {
        seenKeys++;
        if (getIndex(maybeRow) !== index) {
          rowsToMove.push([maybeRow, index]);
        }
      }
    });

    // iterate over rows to move and move them

    rowsToMove.forEach(([row, index]) => {
      const nextItem = items[index + 1];
      setIndex(row, index);
      if (nextItem === undefined) {
        renderElement(this.bottomMarker.parentNode!, row, this.bottomMarker);
      } else {
        const nextKey = this.keyForItem(nextItem);
        const nextRow = this.keyMap.get(nextKey)!;
        const firstNode = getFirstNode(nextRow);
        if (nextRow !== undefined && firstNode !== undefined) {
          const parent = firstNode.parentNode!;
          renderElement(parent, row, firstNode);
        }
      }
    });

    if (targetNode !== this.bottomMarker) {
      const parent = targetNode.parentNode!;
      const trueParent = this.bottomMarker.parentNode!;
      // parent.removeChild(targetNode);
      if (trueParent !== parent) {
        api.insert(trueParent, parent, this.bottomMarker);
      }
    }
  }
}

export class SyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  constructor(params: ListComponentArgs<T>, outlet: RenderTarget) {
    super(params, outlet);
    associateDestroyable(params.ctx, [
      opcodeFor(this.tag, () => {
        this.syncList(this.tag.value);
      }),
    ]);
  }
  syncList(items: T[]) {
    const existingKeys = Array.from(this.keyMap.keys());
    const updatingKeys = new Set(items.map((item) => this.keyForItem(item)));
    const removedIndexes: number[] = [];
    const keysToRemove = existingKeys.filter((key) => {
      const isRemoved = !updatingKeys.has(key);
      if (isRemoved) {
        const row = this.keyMap.get(key)!;
        removedIndexes.push(getIndex(row));
        this.destroyItem(row, key);
      }
      return isRemoved;
    });
    const amountOfKeys = existingKeys.length;
    this.updateItems(items, amountOfKeys, keysToRemove, removedIndexes);
  }
  destroyItem(row: GenericReturnType, key: string) {
    this.keyMap.delete(key);
    destroyElementSync(row);
  }
}
export class AsyncListComponent<
  T extends { id: number },
> extends BasicListComponent<T> {
  constructor(params: ListComponentArgs<any>, outlet: RenderTarget) {
    super(params, outlet);
    associateDestroyable(params.ctx, [
      opcodeFor(this.tag, async () => {
        await this.syncList(this.tag.value);
      }),
    ]);
  }
  async syncList(items: T[]) {
    const existingKeys = Array.from(this.keyMap.keys());
    const updatingKeys = new Set(items.map((item) => this.keyForItem(item)));
    const removedIndexes: number[] = [];
    const removeQueue: Array<Promise<void>> = [];
    const keysToRemove = existingKeys.filter((key) => {
      const isRemoved = !updatingKeys.has(key);
      if (isRemoved) {
        const row = this.keyMap.get(key)!;
        removedIndexes.push(getIndex(row));
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
    await destroyElement(row);
  }
}
