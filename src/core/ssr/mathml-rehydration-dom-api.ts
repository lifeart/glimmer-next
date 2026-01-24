import { NS_MATHML } from '@/core/namespaces';
import type { DOMApi } from '@/core/dom-api';
import {
  isRehydrationScheduled,
  itemFromRehydrationStack,
  lastItemInStack,
} from './rehydration';

export class MathMLRehydrationBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(doc: Document) {
    this.doc = doc;
  }
  isNode(node: Node): node is Node {
    return 'nodeType' in node;
  }
  destroy(node: Node): void {
    // Skip if node is undefined (isConnected check handled by caller)
    if (!node) return;
    // @ts-expect-error
    node.remove();
  }
  clearChildren(element: Node): void {
    // @ts-expect-error innerHTML is not on Node type but works on Element
    element.innerHTML = '';
  }
  parent(node: Node) {
    return node.parentNode;
  }
  comment(text = '') {
    return this.doc.createComment(text);
  }
  fragment() {
    return this.doc.createDocumentFragment();
  }
  addEventListener(_: Node, __: string, ___: EventListener): undefined {
    return undefined;
  }
  toString() {
    return 'hydration-mathml:dom-api';
  }
  text(text: string | number) {
    return this.doc.createTextNode(String(text));
  }
  textContent(node: Node, text: string) {
    if (isRehydrationScheduled()) {
      const existingText = node.textContent;
      if (existingText === text) {
        return;
      }
    }
    node.textContent = text;
  }
  element(tagName: string): Element {
    if (isRehydrationScheduled()) {
      let nextNode = lastItemInStack('node');
      if (nextNode && nextNode.nodeType === Node.COMMENT_NODE) {
        itemFromRehydrationStack();
        return this.element(tagName);
      } else if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
        const dummyNode = itemFromRehydrationStack();
        if (dummyNode) {
          dummyNode.remove();
        }
        return this.element(tagName);
      }
      let node = itemFromRehydrationStack();
      if (
        node &&
        (node.tagName === tagName.toUpperCase() || node.tagName === tagName)
      ) {
        return node as unknown as Element;
      } else {
        if (
          node &&
          (node.nodeType === Node.TEXT_NODE ||
            node.nodeType === Node.COMMENT_NODE)
        ) {
          node = itemFromRehydrationStack();
          if (node && (node.tagName === tagName.toUpperCase() || node.tagName === tagName)) {
            return node as unknown as Element;
          } else {
            if (
              node &&
              (node.nodeType === Node.TEXT_NODE ||
                node.nodeType === Node.COMMENT_NODE)
            ) {
              return this.element(tagName);
            }
            throw new Error(
              `MathML Rehydration failed. Expected tagName: ${tagName} got: ${node?.tagName}.`,
            );
          }
        }
        throw new Error(
          `MathML Rehydration failed. Expected tagName: ${tagName} got: ${node?.tagName}.`,
        );
      }
    }
    return this.doc.createElementNS(NS_MATHML, tagName);
  }
  attr(element: Element, name: string, value: string) {
    if (isRehydrationScheduled()) {
      const existingValue = element.getAttribute(name);
      if (existingValue === value) {
        return;
      }
    }
    if (name.includes(':')) {
      element.setAttributeNS(NS_MATHML, name, value);
    } else {
      element.setAttribute(name, value);
    }
  }
  prop(element: Element, name: string, value: string) {
    if (isRehydrationScheduled()) {
      const existingValue = element.getAttribute(name);
      if (existingValue === value) {
        return value;
      }
    }
    element.setAttribute(name, value);
    return value;
  }
  insert(parent: Element, child: Element, anchor?: Element | null) {
    if (child.isConnected) {
      return;
    }
    if (isRehydrationScheduled()) {
      const existingChild = anchor ? anchor.previousSibling : parent.lastChild;
      const alternativeChild = anchor ? anchor.nextSibling : parent.firstChild;
      if (alternativeChild === child) {
        return;
      }
      if (existingChild === child) {
        return;
      }
    }
    parent.insertBefore(child, anchor || null);
  }
}
