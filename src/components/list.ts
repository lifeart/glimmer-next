import { ComponentReturnType } from "@/utils/component";
import { Cell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";

function renderItem(item: ComponentReturnType, marker: Node) {
  const parent = marker.parentNode;
  item.nodes.forEach((node) => {
    parent?.insertBefore(node, marker);
  });
}

/*
  This is a list manager, it's used to render and sync a list of items.
  It's a proof of concept, it's not optimized, it's not a final API.

  Based on Glimmer-VM list update logic.
*/

export class ListComponent<T extends object> {
  keyMap: Map<string, ComponentReturnType> = new Map();
  nodes: Node[] = [];
  destructors: Array<() => void> = [];
  index = 0;
  ItemComponent: (item: T) => ComponentReturnType;
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
      this.syncList(tag.value);
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
    const rowsToMove: Array<[ComponentReturnType, number]> = [];
    let seenKeys = 0;

    // iterate over existing keys and remove them
    const removedIndexes = keysToRemove.map((key) => this.destroyListItem(key));
    for (const value of this.keyMap.values()) {
      removedIndexes.forEach((index) => {
        if (value.index > index) {
          value.index--;
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
        renderItem(row, targetNode);
        row.index = index;
        this.keyMap.set(key, row);
      } else {
        seenKeys++;
        if (maybeRow.index !== index) {
          rowsToMove.push([maybeRow, index]);
        }
      }
    });
    // iterate over rows to move and move them
    rowsToMove.forEach(([row, index]) => {
      const nextItem = items[index + 1];
      if (nextItem === undefined) {
        row.index = index;
        renderItem(row, this.bottomMarker);
      } else {
        const nextKey = this.keyForItem(nextItem);
        const nextRow = this.keyMap.get(nextKey);
        const firstNode = row.nodes[0];
        if (nextRow && firstNode) {
          nextRow.nodes.forEach((node) =>
            firstNode.parentNode!.insertBefore(firstNode, node)
          );
        }
        row.index = index;
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
    row.destructors.forEach((fn) => fn());
    this.keyMap.delete(key);
    row.nodes.forEach((node) => {
      node.parentElement?.removeChild(node);
    });
    return row.index;
  }
}
