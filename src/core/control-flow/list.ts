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
import { registerDestructor, isDestructionStarted } from '../glimmer/destroyable';
import { setParentContext, getParentContext } from '../tracking';

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

export type InverseFn = (ctx: Component<any>) => GenericReturnType | null;

type ListComponentArgs<T> = {
  tag: Cell<T[]> | MergedCell;
  key: string | null;
  ctx: Component<any>;
  ItemComponent: (item: T, index?: number | MergedCell) => GenericReturnType;
  inverseFn?: InverseFn;
};
type RenderTarget = HTMLElement | DocumentFragment;

// Reusable arrays for LIS algorithm — avoids allocations on each update
const _lisTails: number[] = [];
const _lisTailIdx: number[] = [];
const _lisPred: number[] = [];

/**
 * Compute positions in `arr` that form the Longest Increasing Subsequence.
 * Items at these positions are already in correct relative order and don't
 * need to be relocated.  O(n log n) time, O(n) space (reused).
 */
export function longestIncreasingSubsequence(arr: number[], out?: Set<number>): Set<number> {
  const n = arr.length;
  const result = out ?? new Set<number>();
  if (out) out.clear();
  if (n === 0) return result;

  const tails = _lisTails;
  const tailIdx = _lisTailIdx;
  const pred = _lisPred;
  tails.length = 0;
  tailIdx.length = 0;
  pred.length = n;

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
  private _existKeys: string[] = [];
  private _existNewIdx: number[] = [];
  private _existOldIdx: number[] = [];
  private _itemKeys: string[] = []; // cached keys for current update
  private _lisResult: Set<number> = new Set();
  private _updatingKeys: Set<string> = new Set();
  private _moveSet: Set<string> = new Set();
  private _freshMoveKeys: Set<string> = new Set();
  protected _keysToRemove: string[] = [];
  protected _rowsToRemove: GenericReturnType[] = [];
  [RENDERED_NODES_PROPERTY]: Array<Node> = [];
  [COMPONENT_ID_PROPERTY] = cId();
  ItemComponent: (
    item: T,
    index: number | MergedCell,
    ctx: Component<any>,
  ) => GenericReturnType;
  inverseFn: InverseFn | null = null;
  inverseContent: GenericReturnType | null = null;
  bottomMarker!: Comment;
  topMarker!: Comment;
  key: string = '@identity';
  tag!: Cell<T[]> | MergedCell;
  isFirstRender = true;
  get ctx() {
    return this;
  }
  protected keysForItems(items: T[], keyForItem: (item: T, index: number, items: T[]) => string): Set<string> {
    const set = this._updatingKeys;
    set.clear();
    for (let i = 0; i < items.length; i++) {
      set.add(keyForItem(items[i], i, items));
    }
    return set;
  }
  /**
   * Detach this list's child-id set before bulk destruction.
   *
   * This lets child destructors skip parent-sibling bookkeeping and avoids
   * allocating a replacement empty Set on every fast cleanup.
   */
  protected detachTreeChildren(): void {
    CHILD.delete(this[COMPONENT_ID_PROPERTY]);
  }
  /**
   * Fast-path for updates that preserve all existing items and only append
   * new ones at the end.
   *
   * We can safely skip the removal scan only when every old position still
   * points to the same key in the incoming list prefix.
   */
  protected isAppendOnlySuperset(
    items: T[],
    amountOfKeys: number,
    keyForItem: (item: T, index: number, items: T[]) => string,
  ): boolean {
    if (items.length < amountOfKeys) return false;
    const { indexMap } = this;
    for (let index = 0; index < amountOfKeys; index++) {
      const key = keyForItem(items[index], index, items);
      if (indexMap.get(key) !== index) {
        return false;
      }
    }
    return true;
  }
  // Cached fragment reused across relocateItem calls to avoid allocating new ones
  private _relocateFragment!: DocumentFragment;
  declare api: DOMApi;
  constructor(
    { tag, ctx, key, ItemComponent, inverseFn }: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    this.api = initDOM(ctx);
    if (inverseFn) {
      this.inverseFn = inverseFn;
    }
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
    // Prefer the current parent context (set by $_ucw / block wrappers)
    // over the lexical `ctx` passed by the compiler. For nested lists
    // inside an {{#each}} body, the compiled code emits the outer
    // component `this` as ctx, but the *actual* parent in the render
    // tree is the UnstableChildWrapper created per-iteration. Linking
    // the list to that wrapper (rather than the top-level component)
    // ensures the list is destroyed when its enclosing iteration is
    // torn down, so its opcode on the source cell is unregistered.
    const parentCtx = (getParentContext() as Component<any> | null) || ctx;
    // @ts-expect-error typings error
    addToTree(parentCtx, this, 'from list constructor');
    this[RENDERED_NODES_PROPERTY] = [];
    if (key) {
      this.key = key;
    }
    this.setupKeyForItem();
    // Register destructor to clean up the list's own TREE/PARENT/CHILD entries.
    // Attach to `this` so it fires when this list instance is destroyed as
    // part of its parent's child teardown (see parentCtx handling above).
    const listId = this[COMPONENT_ID_PROPERTY];
    registerDestructor(this, () => {
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
      registerDestructor(this, () => {
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
    // Defensive: anchor is the same marker we're about to move. This can
    // happen under duplicate-key lists where the same DOM subtree is the
    // anchor for itself. Moving would attempt to re-insert the marker
    // before itself AFTER extracting it, which throws NotFoundError.
    if (marker === anchor) return;
    const { markerSet, bottomMarker, _relocateFragment: fragment } = this;
    // Find end boundary: next item marker or bottomMarker
    let end: Node = bottomMarker;
    let node: Node | null = marker.nextSibling;
    while (node && node !== bottomMarker) {
      if (node.nodeType === 8 && markerSet.has(node as Comment)) {
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
      const map: WeakMap<T & object, string> = new WeakMap();
      this.keyForItem = (item: T, i: number, items?: T[]) => {
        if (isPrimitive(item) || isEmpty(item)) {
          return `${String(item)}:${i}`;
        }
        const existing = map.get(item as T & object);
        let baseKey: string;
        if (existing !== undefined) {
          baseKey = existing;
        } else {
          baseKey = ++cnt as unknown as string;
          map.set(item as T & object, baseKey);
        }
        // Duplicate-reference support: when the same object ref appears more
        // than once in the current items array, the first occurrence uses
        // the stable identity key; every subsequent occurrence gets a
        // position-qualified key so that the diff algorithm treats it as a
        // distinct row. This preserves identity stability for the common
        // (no-duplicates) case.
        if (items !== undefined) {
          // Find the first index in items[] where this same reference lives.
          // If it's < i, we're a subsequent occurrence.
          const firstIdx = items.indexOf(item);
          if (firstIdx !== -1 && firstIdx < i) {
            return `${baseKey}:${i}` as unknown as string;
          }
        }
        return baseKey;
      };
    } else {
      const resolveRawKey = (item: T): string => {
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
      this.keyForItem = (item: T, i: number, items?: T[]) => {
        const baseKey = resolveRawKey(item);
        // Duplicate-key support: when multiple items produce the same
        // key (e.g. `{{#each list key="text"}}` with several items having
        // the same text), each subsequent occurrence gets a position-
        // qualified key so they're rendered as distinct rows. Preserves
        // stable identity for the common (no-duplicates) case.
        if (items !== undefined) {
          for (let j = 0; j < i; j++) {
            if (resolveRawKey(items[j]) === baseKey) {
              return `${baseKey}:${i}`;
            }
          }
        }
        return baseKey;
      };
    }
  }
  renderInverse() {
    if (!this.inverseFn || this.inverseContent !== null) return;
    const self = this as unknown as ComponentLike;
    setParentContext(self);
    this.inverseContent = this.inverseFn(self as unknown as Component<any>);
    setParentContext(null);
    const parent = this.api.parent(this.bottomMarker)!;
    renderElement(this.api, self, parent, this.inverseContent, this.bottomMarker);
  }
  destroyInverseSync() {
    if (this.inverseContent === null) return;
    const content = this.inverseContent;
    this.inverseContent = null;
    // Run destructors on the inverse content component (cleans up reactivity, etc.)
    // Use skipDom=true because we manually remove DOM nodes below.
    // The inverse content's RENDERED_NODES_PROPERTY can become stale/corrupted
    // in compat mode, so relying on destroyElementSync for DOM removal is unreliable.
    destroyElementSync(content as ComponentLike, true, this.api);
    // Manually remove all DOM nodes between topMarker and bottomMarker.
    // This is the definitive cleanup — any inverse content nodes live in this range.
    this.clearInverseNodes();
  }
  /**
   * Remove all DOM nodes between topMarker and bottomMarker.
   * Used by destroyInverseSync/Async to ensure inverse content is fully cleaned up
   * regardless of RENDERED_NODES_PROPERTY state.
   */
  protected clearInverseNodes() {
    const { topMarker, bottomMarker, api } = this;
    let node = topMarker.nextSibling;
    while (node && node !== bottomMarker) {
      const next = node.nextSibling;
      api.destroy(node);
      node = next;
    }
  }
  async destroyInverseAsync() {
    if (this.inverseContent === null) return;
    const content = this.inverseContent;
    this.inverseContent = null;
    // Run destructors with skipDom=true, then manually remove DOM nodes
    // (same approach as destroyInverseSync — see comment there)
    await destroyElement(content as ComponentLike, true, this.api);
    this.clearInverseNodes();
  }
  // @ts-expect-error non-string return type
  keyForItem(item: T, index: number, items?: T[]): string {
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
  updateItems(items: T[], amountOfKeys: number, removedCount: number) {
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
      _existKeys: existKeys,
      _existNewIdx: existNewIdx,
      _existOldIdx: existOldIdx,
      _lisResult: lisResult,
      _itemKeys: itemKeys,
      _moveSet: moveSet,
      _freshMoveKeys: freshMoveKeys,
    } = this;
    existKeys.length = 0;
    existNewIdx.length = 0;
    existOldIdx.length = 0;
    itemKeys.length = items.length;
    moveSet.clear();
    freshMoveKeys.clear();

    const amountOfExistingKeys = amountOfKeys - removedCount;

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

      const key = keyForItem(item, index, items);
      itemKeys[index] = key;
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
                return keyForItem(value, i, values) === key;
              });
            }
            // For the common (non-duplicate) case, indexOf is correct. When
            // the item appears multiple times in `values`, compute the key
            // at each occurrence and return the one that matches.
            const firstKey = keyForItem(item, itemIndex, values);
            if (firstKey === key) return itemIndex;
            for (let j = itemIndex + 1; j < values.length; j++) {
              if (values[j] === item && keyForItem(values[j], j, values) === key) {
                return j;
              }
            }
            return itemIndex;
          }, `each.index[${index}]`);
          idx = indexFormula;
          // Track formula for cleanup when item is destroyed
          if (!this.indexFormulaMap) this.indexFormulaMap = new Map();
          this.indexFormulaMap.set(key, indexFormula);
        }

        const row = ItemComponent(item, idx, self as unknown as Component<any>);

        if (IS_DEV_MODE) {
          if (row === undefined || row === null) {
            console.log('[GXT-list] ItemComponent returned null/undefined for item:', item, 'key:', key);
          }
        }

        keyMap.set(key, row);
        indexMap.set(key, index);
        if (isAppendOnly) {
          // TODO: in ssr parentNode may not exist
          const parent = api.parent(targetNode)!;
          api.insert(parent, marker, targetNode);
          // Skip renderElement when ItemComponent produced no output.
          // This can happen during destroy cascades when the item's
          // body expression evaluates against a torn-down context
          // (e.g., primitive-key rows where every shift invalidates
          // every key and triggers a mid-sync teardown).
          if (row !== undefined && row !== null) {
            renderElement(
              api,
              self,
              parent,
              row,
              targetNode,
            );
          }
        } else {
          moveSet.add(key);
          freshMoveKeys.add(key);
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
          moveSet.add(existKeys[i]);
        }
      }
    } else if (existKeys.length === 1 && existOldIdx[0] !== existNewIdx[0]) {
      moveSet.add(existKeys[0]);
    }

    setParentContext(null);

    // Insert batched append-only fragment into main DOM before the move phase,
    // so that all item markers are reachable in the live DOM tree.
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

    // Move phase: iterate right-to-left through the new item list,
    // maintaining a running anchor.  Stable (LIS) items just update the
    // anchor; moved/new items are inserted before it.
    //
    // Duplicate-key handling: when the same item reference appears more
    // than once in the list (e.g. @identity key on a list containing the
    // same object ref multiple times) we only have ONE rendered DOM
    // subtree for that key. We must move it at most once per sync pass —
    // otherwise the second "move" tries to relocate the marker to itself
    // (or past an anchor that IS the marker), which throws in the browser
    // and corrupts the tree. The rightmost occurrence wins (first visited
    // in right-to-left order); subsequent duplicates are treated as
    // stable and simply update the anchor.
    if (moveSet.size > 0) {
      const moveParent = api.parent(bottomMarker)!;
      let anchor: Node = bottomMarker;
      const processedKeys: Set<string> = new Set();
      for (let idx = items.length - 1; idx >= 0; idx--) {
        const key = itemKeys[idx];
        const alreadyProcessed = processedKeys.has(key);
        if (!moveSet.has(key) || alreadyProcessed) {
          // Stable item (LIS or already-appended, or a duplicate whose
          // single DOM subtree was already handled). Use its marker as
          // the running anchor.
          const marker = itemMarkers.get(key);
          if (marker) anchor = marker;
          continue;
        }
        processedKeys.add(key);
        const marker = itemMarkers.get(key);
        if (!marker) continue;

        if (freshMoveKeys.has(key)) {
          const row = keyMap.get(key);
          api.insert(moveParent, marker, anchor);
          // Skip renderElement if ItemComponent produced no output.
          if (row !== undefined && row !== null) {
            renderElement(api, self, moveParent, row, anchor);
          }
        } else {
          this.relocateItem(marker, anchor, moveParent);
        }
        anchor = marker;
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
  // Re-entry guard: true while syncList is actively running on this instance.
  // Prevents destructor-triggered syncList([]) from re-entering during item
  // removal cascades (e.g., when @identity keys include index and every key
  // changes after a shiftObject on a primitive-item array). Without this,
  // a child destroy cascade can call back into a destructor that runs
  // `this.syncList([])` mid-update, corrupting keyMap/indexMap state and
  // causing the outer updateItems to throw and skip re-rendering new items.
  private _syncInProgress = false;
  constructor(
    params: ListComponentArgs<T>,
    outlet: RenderTarget,
    topMarker: Comment,
  ) {
    super(params, outlet, topMarker);
    // Register destructors on `this` (the list instance) rather than
    // `params.ctx`. The list instance is added to the destruction tree
    // as a child of the parent context via addToTree in the base
    // constructor, so it gets destroyed when the parent tears down.
    //
    // Registering on `params.ctx` breaks nested lists: a nested
    // {{#each}} inside a parent {{#each}}'s item body captures the
    // top-level test component as params.ctx (because that's what
    // GXT emits for the compiled fn). When the parent each removes an
    // item, its DOM is torn down, but because the inner list's
    // destructors were attached to the top-level component (not the
    // item), the inner list's opcode on its tag cell is NEVER removed.
    // Later, when the cell value changes, the orphaned opcode fires and
    // creates new item components (triggering their init hooks), even
    // though the inner list's DOM has been reparented/removed.
    //
    // Attaching the destructors to `this` (the list instance, which
    // sits under the parent item in the TREE/CHILD map) means the
    // inner list's opcode is correctly cleaned up when its parent
    // item is destroyed, matching Ember's expected teardown order.
    registerDestructor(
      this,
      () => {
        // If syncList is already running (destructor cascade fired during an
        // active sync), skip — the in-progress sync will tear items down
        // according to the new value; running another syncList([]) here
        // would corrupt keyMap state and throw inside updateItems.
        if (this._syncInProgress) return;
        this.inverseFn = null;
        this.destroyInverseSync();
        this.syncList([]);
      },
      opcodeFor(this.tag, (value) => {
        if (isDestructionStarted(this)) return;
        // Same re-entry guard: if an outer syncList on this instance is
        // active, drop this opcode invocation. The outer call already sees
        // the current tag value.
        if (this._syncInProgress) return;
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
      // Detach CHILD so item destructors skip parent-sibling deletes.
      this.detachTreeChildren();
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
    // Re-entry guard: during an item-destroy cascade, Ember's KVO/backtracking
    // layer can synchronously fire a destructor that re-invokes syncList on
    // this same instance. A nested call observes half-destroyed keyMap state
    // and corrupts it. Skip nested calls — the outer one is already applying
    // `items`, which is either the final desired state or `[]` (teardown).
    if (this._syncInProgress) return;
    this._syncInProgress = true;
    try {
    const { keyMap, keyForItem } = this;

    if (items.length > 0 && this.inverseContent !== null) {
      this.destroyInverseSync();
    }

    if (items.length === 0 && !this.isFirstRender) {
      if (this.fastCleanup()) {
        if (this.inverseFn) this.renderInverse();
        return;
      }
    }
    let amountOfKeys = keyMap.size;
    let removedCount = 0;

    if (
      amountOfKeys > 0 &&
      !this.isAppendOnlySuperset(items, amountOfKeys, keyForItem)
    ) {
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
      }
      if (keysToRemove.length) {
        if (keysToRemove.length === amountOfKeys) {
          if (this.fastCleanup()) {
            amountOfKeys = 0;
            keysToRemove.length = 0;
          } else {
            // fastCleanup failed but removing all items — detach CHILD
            // to skip parent-sibling delete work in each item's destructor.
            this.detachTreeChildren();
          }
        }
        removedCount = keysToRemove.length;
        for (let i = 0; i < keysToRemove.length; i++) {
          this.destroyItem(rowsToRemove[i], keysToRemove[i]);
        }
      }
      // Release references to destroyed rows
      rowsToRemove.length = 0;
    }
    this.updateItems(items, amountOfKeys, removedCount);

    if (items.length === 0 && this.inverseFn) {
      this.renderInverse();
    }
    } finally {
      this._syncInProgress = false;
    }
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
    // Defensive tree-scoping: under some compat-mode wrappers a row object
    // can point at a shared/root-level ComponentLike (COMPONENT_ID_PROPERTY=1)
    // whose CHILD set is the tree-root's own children. Passing that row to
    // destroyElementSync would cascade through every sibling subtree (other
    // #each regions, layouts, etc.) and wipe anchors mid-sync.
    //
    // Only walk the CHILD tree when `row` is registered as OUR direct child
    // (PARENT[rowId] === listId). Otherwise restrict destruction to the row's
    // own rendered nodes without traversing CHILD — the real subtree owner
    // will tear itself down when its scope ends.
    const rowAny = row as unknown as { [COMPONENT_ID_PROPERTY]?: number };
    const rowId =
      rowAny && typeof rowAny === 'object' && !Array.isArray(row)
        ? rowAny[COMPONENT_ID_PROPERTY]
        : undefined;
    const listId = this[COMPONENT_ID_PROPERTY];
    const parentOfRow = rowId !== undefined ? PARENT.get(rowId) : undefined;
    const isOurChild = rowId !== undefined && parentOfRow === listId;
    if (rowId === undefined || isOurChild || Array.isArray(row)) {
      // Normal path: safe to cascade.
      destroyElementSync(row as ComponentLike, false, this.api);
    } else {
      // Shared/root row — scope DOM cleanup to this row's rendered nodes only.
      try {
        const rendered = (row as any)?.[RENDERED_NODES_PROPERTY];
        if (Array.isArray(rendered)) {
          for (let i = 0; i < rendered.length; i++) {
            const node = rendered[i];
            if (node && typeof node === 'object' && 'nodeType' in node) {
              const n = node as Node;
              if (n.isConnected) {
                try {
                  this.api.destroy(n);
                } catch {
                  /* best-effort */
                }
              }
            }
          }
        }
      } catch {
        /* noop */
      }
    }
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
    // See SyncListComponent constructor for rationale: attach destructors
    // to `this` so a nested list's opcode is correctly unregistered when
    // its enclosing iteration is torn down.
    registerDestructor(
      this,
      () => {
        if (this.destroyPromise) {
          return this.destroyPromise;
        }
      },
      async () => {
        this.inverseFn = null;
        await this.destroyInverseAsync();
        await this.syncList([]);
      },
      opcodeFor(this.tag, async (value) => {
        if (isDestructionStarted(this)) return;
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
      // PR https://github.com/lifeart/glimmer-next/pull/212: when this list
      // is itself being torn down by a parent destruction cascade
      // (`isDestructionStarted(this) === true` while the LIST destructor is
      // running) the row destructors have ALREADY been invoked synchronously
      // by `runDestructorsInternal` when iterating LIST's CHILD set — and
      // `runDestructorsInternal` parks the per-row DOM removal behind the
      // row's pending modifier-destructor promises. Issuing
      // `clearChildren(parent)` here would short-circuit those promises and
      // wipe the row DOM before the async element destructors (e.g. fade-out
      // animations) finish. Bail out of the bulk-DOM path; the parent cascade
      // (and the per-row `destroyNodes(api, row[RENDERED_NODES_PROPERTY])`
      // queued behind each modifier promise) will reclaim the DOM at the
      // correct time. Regression: `Integration | InternalComponent | each >>
      // it wait for async element destructors before destroying`.
      const cascadeDestruction = isDestructionStarted(this);
      // Detach CHILD so item destructors skip parent-sibling deletes.
      this.detachTreeChildren();
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
      if (!cascadeDestruction) {
        // Stand-alone teardown (e.g. `items.update([])` while the list is
        // still alive) — bulk-remove between the markers.
        this.api.clearChildren(parent);
        this.api.insert(parent, topMarker);
        this.api.insert(parent, bottomMarker);
      }
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
    // Destroy inverse when items arrive — guarded to avoid unnecessary await
    if (items.length > 0 && this.inverseContent !== null) {
      await this.destroyInverseAsync();
    }

    if (items.length === 0 && !this.isFirstRender) {
      if (await this.fastCleanup()) {
        if (this.inverseFn) this.renderInverse();
        return;
      }
    }
    const { keyMap, keyForItem } = this;
    let amountOfKeys = keyMap.size;
    let removedCount = 0;

    if (
      amountOfKeys > 0 &&
      !this.isAppendOnlySuperset(items, amountOfKeys, keyForItem)
    ) {
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
      }
      if (keysToRemove.length) {
        if (keysToRemove.length === amountOfKeys) {
          if (await this.fastCleanup()) {
            amountOfKeys = 0;
            keysToRemove.length = 0;
          } else {
            // fastCleanup failed but removing all items — detach CHILD
            // to skip parent-sibling delete work in each item's destructor.
            this.detachTreeChildren();
          }
        }
        removedCount = keysToRemove.length;

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
    this.updateItems(items, amountOfKeys, removedCount);

    if (items.length === 0 && this.inverseFn) {
      this.renderInverse();
    }
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
