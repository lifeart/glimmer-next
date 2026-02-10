/**
 * Destroy - Level 3
 *
 * Component destruction and cleanup functions.
 * Imports from Level 0-2 only.
 */

import {
  destroy,
  destroySync,
  isDestructionStarted,
} from '@/core/glimmer/destroyable';
import {
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  type DOMApi,
  type ComponentLike,
} from './types';
import { TREE, CHILD, PARENT } from './tree';
import { isArray } from './shared';
import { initDOM } from './context';

/**
 * Iteratively destroys nodes, handling both DOM nodes and nested ComponentReturnType objects.
 * Uses a stack to avoid recursion overhead for deeply nested structures.
 *
 * Optimization: Skips already-disconnected nodes. When a parent DOM node is removed,
 * all its children become disconnected automatically, so we don't need to process them.
 */
function destroyNodes(api: DOMApi, roots: Node | ComponentLike | Array<Node | ComponentLike>): void {
  if (!roots) return;

  // Use stack for iterative processing - avoids recursion overhead
  const stack: Array<Node | ComponentLike | Array<Node | ComponentLike>> = [roots];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (isArray(current)) {
      // Process array items - push in reverse to maintain order
      for (let i = current.length - 1; i >= 0; i--) {
        const item = current[i];
        if (item) {
          stack.push(item);
        }
      }
    } else {
      // Check if it's a component (has RENDERED_NODES_PROPERTY)
      const renderedNodes = (current as ComponentLike)[RENDERED_NODES_PROPERTY];
      if (renderedNodes !== undefined) {
        // It's a component - push its rendered nodes for processing
        stack.push(renderedNodes);
      } else {
        // It's a DOM node - only destroy if still connected
        // When parent nodes are destroyed, children become disconnected automatically
        const node = current as Node;
        if (node.isConnected) {
          api.destroy(node);
        }
      }
    }
  }
}

/**
 * Synchronously destroy a component or array of components.
 * Used for immediate cleanup when async destruction is not needed.
 */
export function destroyElementSync(
  component: ComponentLike | Node | Array<ComponentLike | Node>,
  skipDom = false,
  api: DOMApi,
): void {
  if (isArray(component)) {
    // Slice to prevent mutation during iteration
    const componentsCopy = component.slice();
    const len = componentsCopy.length;
    for (let i = 0; i < len; i++) {
      destroyElementSync(componentsCopy[i], skipDom, api);
    }
  } else if (component) {
    // Direct property access is faster than 'in' operator
    const renderedNodes = (component as ComponentLike)[RENDERED_NODES_PROPERTY];
    if (renderedNodes !== undefined) {
      try {
        runDestructorsSync(component as ComponentLike, skipDom, api);
      } catch (e) {
        if (IS_DEV_MODE) {
          console.error('Error during destruction:', e);
        }
        // Continue destruction even if there's an error
      }
    } else {
      try {
        (api as DOMApi).destroy(component as Node);
      } catch (e) {
        if (IS_DEV_MODE) {
          console.error('Error destroying node:', e);
        }
      }
    }
  }
}

/**
 * Unregister a component from its parent's child list.
 * Used when relocating components without destroying them.
 */
export function unregisterFromParent(
  component: ComponentLike | Node | Array<ComponentLike | Node>,
): void {
  if (!WITH_CONTEXT_API) {
    return;
  }
  if (isArray(component)) {
    component.forEach(unregisterFromParent);
  } else if (component && RENDERED_NODES_PROPERTY in component) {
    const id = component[COMPONENT_ID_PROPERTY];
    if (id === undefined) {
      return;
    }
    const parentId = PARENT.get(id);
    if (parentId === undefined) {
      return;
    }
    const childSet = CHILD.get(parentId);
    if (childSet !== undefined) {
      if (IS_DEV_MODE) {
        if (!childSet.has(id)) {
          console.warn('TODO: hmr negative index');
        }
      }
      childSet.delete(id);
    }
  }
}

/**
 * Asynchronously destroy a component or array of components.
 * Waits for all async destructors to complete.
 */
export async function destroyElement(
  component: ComponentLike | Node | Array<ComponentLike | Node>,
  skipDom = false,
  api?: DOMApi,
): Promise<void> {
  if (isArray(component)) {
    // Use for loop and collect promises for better performance
    const promises: Array<Promise<void>> = [];
    const len = component.length;
    for (let i = 0; i < len; i++) {
      promises.push(destroyElement(component[i], skipDom, api));
    }
    await Promise.all(promises);
  } else {
    // Direct property access is faster than 'in' operator
    const renderedNodes = (component as ComponentLike)[RENDERED_NODES_PROPERTY];
    if (renderedNodes !== undefined) {
      const destructors: Array<Promise<void>> = [];
      runDestructors(component as ComponentLike, destructors, skipDom, api);
      await Promise.all(destructors);
    } else {
      try {
        (api as DOMApi).destroy(component as Node);
      } catch (e) {
        throw new Error('unknown branch');
      }
    }
  }
}

/**
 * Synchronously run destructors for a component and its children.
 */
function runDestructorsSync(
  targetNode: ComponentLike,
  skipDom = false,
  api: DOMApi,
): void {
  const stack = [targetNode];

  while (stack.length > 0) {
    const currentNode = stack.pop()!;
    const nodesToRemove = CHILD.get(currentNode[COMPONENT_ID_PROPERTY]);

    destroySync(currentNode);
    if (skipDom !== true) {
      destroyNodes(api, currentNode![RENDERED_NODES_PROPERTY]);
    }
    if (nodesToRemove) {
      for (const childId of nodesToRemove) {
        const instance = TREE.get(childId);
        // Skip if instance doesn't exist or destruction has already started
        if (instance && !isDestructionStarted(instance)) {
          stack.push(instance);
        }
      }
    }
  }
}

/**
 * Run destructors for a component and its children, collecting async promises.
 */
export function runDestructors(
  target: ComponentLike,
  promises: Array<Promise<void>> = [],
  skipDom = false,
  _api?: DOMApi,
): Array<Promise<void>> {
  const api = _api || initDOM(target);
  const done = runDestructorsInternal(target, skipDom, api);
  if (done) {
    promises.push(done);
  }
  return promises;
}

function runDestructorsInternal(
  target: ComponentLike,
  skipDom: boolean,
  api: DOMApi,
): Promise<void> | null {
  const pending: Array<Promise<void>> = [];
  const childComponents = CHILD.get(target[COMPONENT_ID_PROPERTY]);
  destroy(target, pending);

  if (childComponents) {
    const childComponentsCopy = Array.from(childComponents);
    for (let i = 0; i < childComponentsCopy.length; i++) {
      const instance = TREE.get(childComponentsCopy[i]);
      // Skip if instance doesn't exist or destruction has already started
      if (instance && !isDestructionStarted(instance)) {
        const childDone = runDestructorsInternal(instance, skipDom, api);
        if (childDone) {
          pending.push(childDone);
        }
      }
    }
  }

  if (skipDom === true) {
    if (pending.length === 0) {
      return null;
    }
    if (pending.length === 1) {
      return pending[0]!;
    }
    return Promise.all(pending).then(() => void 0);
  }

  if (pending.length === 0) {
    destroyNodes(api, target[RENDERED_NODES_PROPERTY]);
    return null;
  }

  if (pending.length === 1) {
    return pending[0]!.then(() => {
      destroyNodes(api, target[RENDERED_NODES_PROPERTY]);
    });
  }

  return Promise.all(pending).then(() => {
    destroyNodes(api, target[RENDERED_NODES_PROPERTY]);
  });
}
