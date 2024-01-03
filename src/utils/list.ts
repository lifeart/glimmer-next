import {
  ComponentReturnType,
  NodeReturnType,
  addDestructors,
  destroyElement,
  renderElement,
} from "@/utils/component";
import { Cell, MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";

function setIndex(item: GenericReturnType, index: number) {
  if (Array.isArray(item)) {
    item.forEach((item) => {
      item.index = index;
    });
  } else {
    item.index = index;
  }
}
function getIndex(item: GenericReturnType) {
  if (Array.isArray(item)) {
    return item[0].index;
  } else {
    return item.index;
  }
}
function getFirstNode(item: GenericReturnType) {
  if (Array.isArray(item)) {
    return getFirstNode(item[0]);
  } else {
    if ("nodes" in item) {
      return item.nodes[0];
    } else {
      return item.node;
    }
  }
}

/*
  This is a list manager, it's used to render and sync a list of items.
  It's a proof of concept, it's not optimized, it's not a final API.

  Based on Glimmer-VM list update logic.
*/
type GenericReturnType =
  | ComponentReturnType
  | NodeReturnType
  | ComponentReturnType[]
  | NodeReturnType[];

export class ListComponent<T extends { id: number }> {
  keyMap: Map<string, GenericReturnType> = new Map();
  nodes: Node[] = [];
  destructors: Array<() => void> = [];
  index = 0;
  ItemComponent: (item: T, index?: number) => GenericReturnType;
  bottomMarker!: Comment;
  key: string = 'id';
  constructor(
    {
      tag,
      key,
      ItemComponent,
    }: { tag: Cell<T[]>; key: string | null, ItemComponent: (item: T, index?: number) => ComponentReturnType },
    outlet: HTMLElement | DocumentFragment
  ) {
    this.ItemComponent = ItemComponent;
    const mainNode = outlet;
    this.nodes = [];
    this.key = key ?? 'id';
    // "list bottom marker"
    this.bottomMarker = document.createComment("");
    mainNode.appendChild(this.bottomMarker);

    // @ts-expect-error never ever
    if (!(tag instanceof Cell) && !(tag instanceof MergedCell)) {
      console.warn("iterator for @each should be a cell");
      if (Array.isArray(tag)) {
        tag = new Cell(tag);
      }
    }

    addDestructors(
      [
        bindUpdatingOpcode(tag, async () => {
          await this.syncList(tag.value);
        }),
      ],
      this.bottomMarker
    );
  }
  keyForItem(item: T & { id: number }) {
    // @ts-expect-error key doesn't exist
    return String(item[this.key]);
  }
  getTargetNode(amountOfKeys: number) {
    if (amountOfKeys > 0) {
      return this.bottomMarker;
    } else {
      const fragment = document.createDocumentFragment();
      // list fragment marker
      const marker = document.createComment("");
      fragment.appendChild(marker);
      return marker;
    }
  }
  async syncList(items: T[]) {
    const existingKeys = new Set(this.keyMap.keys());
    const updatingKeys = new Set(items.map((item) => this.keyForItem(item)));
    const keysToRemove = [...existingKeys].filter(
      (key) => !updatingKeys.has(key)
    );
    const amountOfKeys = existingKeys.size;
    let targetNode = this.getTargetNode(amountOfKeys);
    const rowsToMove: Array<[GenericReturnType, number]> = [];
    let seenKeys = 0;

    // iterate over existing keys and remove them
    const removedIndexes = keysToRemove.map((key) =>
      this.getListItemIndex(key)
    );
    const removePromise = Promise.all(
      keysToRemove.map((key) => this.destroyListItem(key))
    );
    const rmDist = addDestructors(
      [
        async () => {
          await removePromise;
        },
      ],
      this.bottomMarker
    );
    removePromise.then(() => {
      rmDist?.();
    });
    for (const value of this.keyMap.values()) {
      removedIndexes.forEach((index) => {
        if (Array.isArray(value)) {
          value.forEach((item) => {
            if (item.index > index) {
              item.index--;
            }
          });
        } else {
          if (value.index > index) {
            value.index--;
          }
        }
      });
    }

    const amountOfExistingKeys = amountOfKeys - keysToRemove.length;

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
        if (Array.isArray(row)) {
          row.forEach((item) => {
            renderElement(targetNode.parentNode!, item, targetNode);
            item.index = index;
          });
        } else {
          renderElement(targetNode.parentNode!, row, targetNode);
          row.index = index;
        }

        this.keyMap.set(key, row);
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
      if (nextItem === undefined) {
        setIndex(row, index);
        renderElement(this.bottomMarker.parentNode!, row, this.bottomMarker);
      } else {
        const nextKey = this.keyForItem(nextItem);
        const nextRow = this.keyMap.get(nextKey);
        const firstNode = getFirstNode(row);
        if (nextRow && firstNode) {
          const parent = firstNode.parentNode!;
          renderElement(parent, nextRow, firstNode);
        }
        setIndex(row, index);
      }
    });
    if (targetNode !== this.bottomMarker) {
      const parent = targetNode.parentNode!;
      parent.removeChild(targetNode);
      this.bottomMarker.parentNode!.insertBefore(parent, this.bottomMarker);
    }
    return this;
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
