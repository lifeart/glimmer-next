import {
  ComponentReturnType,
  NodeReturnType,
  destroyElement,
} from "@/utils/component";
import { Cell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";

function renderItem(
  item:
    | ComponentReturnType
    | NodeReturnType
    | ComponentReturnType[]
    | NodeReturnType[],
  marker: Node
) {
  if (Array.isArray(item)) {
    item.forEach((item) => {
      renderItem(item, marker);
    });
  } else {
    const parent = marker.parentNode;
    if ("node" in item) {
      parent?.insertBefore(item.node, marker);
    } else {
      item.nodes.forEach((node) => {
        parent?.insertBefore(node, marker);
      });
    }
  }
}

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
function getRootNodes(item: GenericReturnType): Node[] {
  if (Array.isArray(item)) {
    return item.reduce(
      (acc: Node[], item: ComponentReturnType | NodeReturnType) => {
        return acc.concat(getRootNodes(item));
      },
      [] as Node[]
    );
  } else if ("nodes" in item) {
    return item.nodes;
  } else {
    return [item.node];
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

export class ListComponent<T extends object> {
  keyMap: Map<string, GenericReturnType> = new Map();
  nodes: Node[] = [];
  destructors: Array<() => void> = [];
  index = 0;
  ItemComponent: (item: T) => GenericReturnType;
  bottomMarker!: Node;
  constructor(
    {
      tag,
      ItemComponent,
    }: { tag: Cell<T[]>; ItemComponent: (item: T) => ComponentReturnType },
    outlet: HTMLElement | DocumentFragment
  ) {
    this.ItemComponent = ItemComponent;
    const mainNode = outlet;
    this.nodes = [];
    this.bottomMarker = document.createComment("list bottom marker");
    mainNode.appendChild(this.bottomMarker);
    bindUpdatingOpcode(tag, () => {
      try {
        this.syncList(tag.value);
      } catch (e) {
        console.error(e.stack);
      }
    });
  }
  keyForItem(item: T) {
    return String(item["id"]);
  }
  getTargetNode(amountOfKeys: number) {
    if (amountOfKeys > 0) {
      return this.bottomMarker;
    } else {
      const fragment = document.createDocumentFragment();
      const marker = document.createComment("list fragment marker");
      fragment.appendChild(marker);
      return marker;
    }
  }
  syncList(items: T[]) {
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
    const removedIndexes = keysToRemove.map((key) => this.destroyListItem(key));
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
        const row = this.ItemComponent(item);
        if (Array.isArray(row)) {
          row.forEach((item) => {
            renderItem(item, targetNode);
            item.index = index;
          });
        } else {
          renderItem(row, targetNode);
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
        renderItem(row, this.bottomMarker);
      } else {
        const nextKey = this.keyForItem(nextItem);
        const nextRow = this.keyMap.get(nextKey);
        const firstNode = getFirstNode(row);
        if (nextRow && firstNode) {
          getRootNodes(nextRow).forEach((node) =>
            firstNode.parentNode!.insertBefore(firstNode, node)
          );
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
  destroyListItem(key: string) {
    const row = this.keyMap.get(key)!;
    this.keyMap.delete(key);
    destroyElement(row);
    return getIndex(row);
  }
}
