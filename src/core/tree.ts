/**
 * Component Tree Management - Level 0
 *
 * This module manages the component tree structure used for parent-child
 * relationships and context lookup. It only imports from types.ts.
 */

import {
  COMPONENT_ID_PROPERTY,
  ADDED_TO_TREE_FLAG,
  type ComponentLike,
} from './types';
import { config } from '@/core/config';
import { registerDestructor } from './glimmer/destroyable';

// ============================================
// Tree Data Structures
// ============================================

/**
 * Maps component IDs to component instances
 */
export const TREE: Map<number, ComponentLike> = new Map();

/**
 * Maps component IDs to arrays of child component IDs
 */
export const CHILD: Map<number, Array<number> | undefined> = new Map();

/**
 * Maps component IDs to parent component IDs (for context API)
 */
export const PARENT: Map<number, number> = new Map();

// ============================================
// Component ID Management
// ============================================

let componentIdCounter = 1;
const availableIds: number[] = [];
let currentIdPoolMax = config.idPool.initial;
let idHighWaterMark = 0;

/**
 * Get a unique component ID.
 * Reuses IDs from the pool when available.
 */
export function cId(): number {
  if (availableIds.length > 0) {
    return availableIds.pop()!;
  }
  // Track high water mark for adaptive growth
  const newId = componentIdCounter++;
  idHighWaterMark = Math.max(idHighWaterMark, componentIdCounter - availableIds.length);
  return newId;
}

/**
 * Release a component ID back to the pool for reuse.
 */
export function releaseId(id: number): void {
  // Adaptive growth: if we're hitting capacity and below max, grow
  if (availableIds.length >= currentIdPoolMax) {
    if (idHighWaterMark > currentIdPoolMax && currentIdPoolMax < config.idPool.max) {
      currentIdPoolMax = Math.min(
        Math.ceil(currentIdPoolMax * config.idPool.growthFactor),
        config.idPool.max,
      );
    } else {
      // At capacity, discard ID
      return;
    }
  }
  availableIds.push(id);
}

// ============================================
// Tree Management Functions
// ============================================

/**
 * Add a component node to the tree under a parent context.
 * Registers a destructor to clean up tree entries when the node is destroyed.
 */
export function addToTree(
  ctx: ComponentLike,
  node: ComponentLike,
  debugName?: string,
): void {
  if (IS_DEV_MODE) {
    if (ctx === node) {
      throw new Error('Unable to create recursive tree');
    }
  }
  // Use component flag instead of WeakSet for faster lookup
  // @ts-expect-error - dynamic property
  if (node[ADDED_TO_TREE_FLAG]) {
    if (IS_DEV_MODE) {
      // console.log('node is already added to tree in:', node._debugName, '| and now in |', debugName);
    }
    // GET_ARGS may re-add node to tree (depending on component type)
    return;
  }
  const ID = node[COMPONENT_ID_PROPERTY];
  const PARENT_ID = ctx[COMPONENT_ID_PROPERTY];
  let ch = CHILD.get(PARENT_ID);
  if (ch === undefined) {
    ch = [ID];
    CHILD.set(PARENT_ID, ch);
  } else {
    ch.push(ID);
  }
  TREE.set(ID, node);
  if (WITH_CONTEXT_API) {
    if (IS_DEV_MODE) {
      if (!PARENT_ID) {
        throw new Error("unknown parent");
      }
    }
    PARENT.set(ID, PARENT_ID);
  }
  // @ts-expect-error - dynamic property
  node[ADDED_TO_TREE_FLAG] = true;

  if (IS_DEV_MODE) {
    if ('nodeType' in node) {
      throw new Error('invalid node');
    } else if ('ctx' in node && node.ctx === null) {
      throw new Error('invalid node');
    }
    if (debugName) {
      Object.defineProperty(node, '_debugName', {
        value: debugName,
        enumerable: false,
      });
    }
    if (!node) {
      throw new Error('invalid node');
    }
    if (!ctx) {
      throw new Error('invalid ctx');
    }
  }

  // Register destructor for tree cleanup
  registerDestructor(node, () => {
    // Only clean up if this node still owns the ID in TREE.
    // This prevents race conditions when IDs are recycled before destruction completes
    if (TREE.get(ID) === node) {
      // @ts-expect-error - dynamic property
      node[ADDED_TO_TREE_FLAG] = false;
      // Remove this node from its parent's CHILD list
      if (WITH_CONTEXT_API) {
        const parentId = PARENT.get(ID);
        if (parentId !== undefined) {
          const siblings = CHILD.get(parentId);
          if (siblings) {
            const index = siblings.indexOf(ID);
            if (index !== -1) {
              siblings.splice(index, 1);
            }
          }
        }
        PARENT.delete(ID);
      }
      CHILD.delete(ID);
      TREE.delete(ID);
      // Recycle the ID for reuse
      releaseId(ID);
    }
  });
}

// ============================================
// Dev Mode Debugging
// ============================================

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    window['getRenderTree'] = () => {
      return {
        TREE,
        CHILD,
        PARENT,
      };
    };
    window['getParentGraph'] = () => PARENT;
  }
}
