/**
 * Render Core - Level 3
 *
 * Core rendering functions for elements and components.
 * Imports from Level 0-2 only.
 */

import { registerDestructor } from '@/core/glimmer/destroyable';
import {
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  type DOMApi,
  type ComponentLike,
  type RenderableElement,
} from './types';
import { TREE, CHILD } from './tree';
import {
  isFn,
  isPrimitive,
  isArray,
  isEmpty,
  isTagLike,
} from './shared';
import { opcodeFor } from './vm';
import type { MergedCell } from './reactive';

// Import resolveRenderable from root.ts
import { resolveRenderable } from './root';

// Track which components have been rendered
const RENDERED_COMPONENTS = new WeakSet();

/**
 * Get the first DOM node from a component or array of components/nodes.
 * Used for positioning during list updates and relocations.
 */
export function getFirstNode(
  api: DOMApi,
  rawItem:
    | Node
    | ComponentLike
    | Array<Node | ComponentLike>,
): Node {
  if (isArray(rawItem)) {
    return getFirstNode(api, rawItem[0]);
  } else if (api.isNode(rawItem as unknown as Node)) {
    return rawItem as Node;
  } else if (RENDERED_NODES_PROPERTY in rawItem) {
    // Get the first element from RENDERED_NODES - could be a Node or a Component
    const firstRendered = rawItem![RENDERED_NODES_PROPERTY][0];
    // If firstRendered is a Component, recursively get its first node
    let selfNode: Node | null = null;
    if (firstRendered) {
      if (RENDERED_NODES_PROPERTY in firstRendered) {
        // It's a component, recursively get its first node
        selfNode = getFirstNode(api, firstRendered as unknown as ComponentLike);
      } else if (api.isNode(firstRendered as Node)) {
        selfNode = firstRendered as Node;
      }
    }
    const childNode = Array.from(
      CHILD.get(rawItem![COMPONENT_ID_PROPERTY]) ?? [],
    ).reduce((acc: null | Node, item: number) => {
      if (!acc) {
        const child = TREE.get(item);
        if (!child) return null;
        return getFirstNode(api, child);
      } else {
        return acc;
      }
    }, null);
    if (selfNode && childNode) {
      const position = selfNode.compareDocumentPosition(childNode);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return selfNode;
      } else {
        return childNode;
      }
    }
    return (selfNode || childNode)!;
  } else {
    throw new Error('Unknown branch');
  }
}

/**
 * Render an element (primitive, node, or component) to a target node.
 * This is the core rendering function used throughout the framework.
 */
export function renderElement(
  api: DOMApi,
  ctx: ComponentLike,
  target: Node,
  el: RenderableElement | RenderableElement[] | MergedCell,
  placeholder: Comment | Node | null = null,
  skipRegistration = false,
): void {
  if (isFn(el)) {
    // @ts-expect-error
    el = resolveRenderable(el);
  }
  if (isEmpty(el) || el === '') {
    return;
  }
  if (isPrimitive(el)) {
    let node = api.text(el);
    if (skipRegistration !== true) {
      ctx[RENDERED_NODES_PROPERTY].push(node);
    }
    api.insert(target, node, placeholder);
    return;
  }
  if (api.isNode(el as Node)) {
    if (!skipRegistration) {
      ctx[RENDERED_NODES_PROPERTY].push(el as Node);
    }
    api.insert(target, el as Node, placeholder);
    return;
  }
  if (RENDERED_NODES_PROPERTY in el) {
    if (RENDERED_COMPONENTS.has(el)) {
      // relocate case
      // move row case (node already rendered and re-located)
      const renderedNodes = el[RENDERED_NODES_PROPERTY];
      const childs = CHILD.get(el[COMPONENT_ID_PROPERTY]) ?? [];
      // we need to do proper relocation, considering initial child position
      // Build list with proper first node for each item (renderedNodes may contain components)
      const list: Array<[Node | null, ComponentLike | Node]> = [];
      const componentsInRenderedNodes = new Set<ComponentLike>();
      for (let i = 0; i < renderedNodes.length; i++) {
        const item = renderedNodes[i];
        if (RENDERED_NODES_PROPERTY in item) {
          // item is a component, get its first node for sorting
          const component = item as unknown as ComponentLike;
          const firstNode = getFirstNode(api, component);
          list.push([firstNode, component]);
          componentsInRenderedNodes.add(component);
        } else {
          // item is a DOM node
          list.push([item, item]);
        }
      }
      for (let i = 0; i < childs.length; i++) {
        const child = TREE.get(childs[i]);
        if (!child) continue; // Skip if child no longer exists
        // Skip if this child is already in renderedNodes (avoid duplicates)
        if (componentsInRenderedNodes.has(child)) continue;
        const firstChildNode = getFirstNode(api, child);
        // Skip child components whose nodes are already contained within parent's rendered nodes
        const isContainedInParent = renderedNodes.some(
          (parentNode) => parentNode && (parentNode as Node).contains && (parentNode as Node).contains(firstChildNode)
        );
        if (isContainedInParent) continue;
        list.push([firstChildNode, child]);
      }
      list.sort(([node1], [node2]) => {
        if (!node1) {
          return -1;
        }
        if (!node2) {
          return 1;
        }
        const position = node1.compareDocumentPosition(node2);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          return -1;
        } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          return 1;
        }
        return 0;
      });
      list.forEach(([_, item]) => {
        renderElement(
          api,
          el as ComponentLike,
          target,
          item,
          placeholder,
          true,
        );
      });
    } else {
      // fresh (not rendered component)
      const renderedNodes = el[RENDERED_NODES_PROPERTY];
      const len = renderedNodes.length;
      for (let i = 0; i < len; i++) {
        let node: unknown = renderedNodes[i];
        // Resolve renderable if it's a function
        if (isFn(node)) {
          node = resolveRenderable(node as () => unknown);
        }
        if (isEmpty(node) || node === '') {
          continue;
        }
        if (isPrimitive(node)) {
          const textNode = api.text(node as string | number);
          renderedNodes[i] = textNode;
          api.insert(target, textNode, placeholder);
        } else if (api.isNode(node as Node)) {
          renderedNodes[i] = node as Node;
          api.insert(target, node as Node, placeholder);
        } else if (isArray(node)) {
          renderElement(api, el as ComponentLike, target, node as RenderableElement[], placeholder, true);
        } else {
          renderElement(api, el as ComponentLike, target, node as RenderableElement, placeholder, true);
        }
      }
      RENDERED_COMPONENTS.add(el);
    }
    return;
  }
  if (isTagLike(el)) {
    const node = api.text('');
    if (!skipRegistration) {
      ctx[RENDERED_NODES_PROPERTY].push(node);
    }
    api.insert(target, node, placeholder);
    registerDestructor(
      ctx,
      opcodeFor(el, (value) => {
        api.textContent(node, String(value ?? ''));
      }),
    );
    return;
  }
  if (isArray(el)) {
    for (let i = 0; i < el.length; i++) {
      renderElement(api, ctx, target, el[i], placeholder, skipRegistration);
    }
  } else {
    // For unknown types, use TRY_CATCH_ERROR_HANDLING to determine behavior
    if (TRY_CATCH_ERROR_HANDLING) {
      // In error-handling mode: try graceful conversion, throw only if that fails
      if (el !== null && el !== undefined) {
        try {
          const text = String(el);
          if (text && text !== '[object Object]') {
            const textNode = api.text(text);
            if (!skipRegistration) {
              ctx[RENDERED_NODES_PROPERTY].push(textNode);
            }
            api.insert(target, textNode, placeholder);
            return;
          }
        } catch {
          // Conversion failed, fall through to error
        }
      }
      // Graceful handling failed - throw in dev mode, skip in prod
      if (IS_DEV_MODE) {
        throw new Error(`Unknown rendering path: ${typeof el}`);
      }
    } else {
      // Without error handling: just throw immediately in dev mode
      if (IS_DEV_MODE) {
        throw new Error(`Unknown rendering path: ${typeof el}`);
      }
    }
  }
}
