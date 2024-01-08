import {
  ComponentReturnType,
  NodeReturnType,
  addDestructors,
  destroyElement,
  renderElement,
} from '@/utils/component';
import { api } from '@/utils/dom-api';
import {
  Cell,
  MergedCell,
  formula,
  isTag,
  deepFnValue,
} from '@/utils/reactive';
import { opcodeFor } from '@/utils/vm';

function setIndex(item: GenericReturnType, index: number) {
  item.forEach((item) => {
    item.index = index;
  });
}
function getIndex(item: GenericReturnType) {
  return item[0].index;
}
function getFirstNode(rawItem: GenericReturnType) {
  const item = rawItem[0];
  if ('nodes' in item) {
    return item.nodes[0];
  } else {
    return item.node;
  }
}

/*
  This is a list manager, it's used to render and sync a list of items.
  It's a proof of concept, it's not optimized, it's not a final API.

  Based on Glimmer-VM list update logic.
*/
type GenericReturnType = Array<ComponentReturnType | NodeReturnType>;

export class ListComponent<T extends { id: number }> {
  keyMap: Map<string, GenericReturnType> = new Map();
  nodes: Node[] = [];
  index = 0;
  ItemComponent: (item: T, index?: number) => GenericReturnType;
  bottomMarker!: Comment;
  key: string = '@identity';
  constructor(
    {
      tag,
      key,
      ItemComponent,
    }: {
      tag: Cell<T[]> | MergedCell;
      key: string | null;
      ItemComponent: (item: T, index?: number) => GenericReturnType;
    },
    outlet: HTMLElement | DocumentFragment,
  ) {
    this.ItemComponent = ItemComponent;
    const mainNode = outlet;
    this.nodes = [];
    if (key) {
      this.key = key;
    }
    this.setupKeyForItem();
    // "list bottom marker"
    if (import.meta.env.DEV) {
      this.bottomMarker = api.comment('list bottom marker');
    } else {
      this.bottomMarker = api.comment();
    }

    api.append(mainNode, this.bottomMarker);

    const originalTag = tag;

    if (!tag[isTag]) {
      if (Array.isArray(tag)) {
        console.warn('iterator for @each should be a cell');
        tag = new Cell(tag);
      } else if (typeof originalTag === 'function') {
        tag = formula(() => deepFnValue(originalTag));
      }
    }

    addDestructors(
      [
        opcodeFor(tag, async () => {
          await this.syncList(tag.value);
        }),
      ],
      this.bottomMarker,
    );
  }
  setupKeyForItem() {
    if (this.key === '@identity') {
      let cnt = 0;
      const map: WeakMap<T, string> = new WeakMap();
      this.keyForItem = (item: T) => {
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
        // @ts-expect-error unknown key
        return String(item[this.key]);
      };
    }
  }
  // @ts-expect-error non-string return type
  keyForItem(item: T): string {
    if (import.meta.env.DEV) {
      throw new Error(`Key for item not implemented, ${JSON.stringify(item)}`);
    }
  }
  getTargetNode(amountOfKeys: number) {
    if (amountOfKeys > 0) {
      return this.bottomMarker;
    } else {
      const fragment = api.fragment();
      // list fragment marker
      const marker = api.comment();
      api.append(fragment, marker);
      return marker;
    }
  }
  async syncList(items: T[]) {
    const existingKeys = Array.from(this.keyMap.keys());
    const updatingKeys = new Set(items.map((item) => this.keyForItem(item)));
    const keysToRemove = existingKeys.filter((key) => !updatingKeys.has(key));
    const amountOfKeys = existingKeys.length;
    const rowsToMove: Array<[GenericReturnType, number]> = [];
    const amountOfExistingKeys = amountOfKeys - keysToRemove.length;

    let targetNode = this.getTargetNode(amountOfKeys);
    let seenKeys = 0;

    // iterate over existing keys and remove them
    const removedIndexes = keysToRemove.map((key) =>
      this.getListItemIndex(key),
    );
    const removePromise = Promise.all(
      keysToRemove.map((key) => this.destroyListItem(key)),
    );
    const rmDist = addDestructors(
      [
        async () => {
          await removePromise;
        },
      ],
      this.bottomMarker,
    );
    removePromise.then(() => {
      rmDist?.();
    });

    if (removedIndexes.length > 0) {
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
        const row = this.ItemComponent(item, index);
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
      parent.removeChild(targetNode);
      api.insert(this.bottomMarker.parentNode!, parent, this.bottomMarker);
    }
  }
  getListItemIndex(key: string) {
    const row = this.keyMap.get(key)!;
    return getIndex(row);
  }
  async destroyListItem(key: string) {
    const row = this.keyMap.get(key)!;
    this.keyMap.delete(key);
    await destroyElement(row);
  }
}
