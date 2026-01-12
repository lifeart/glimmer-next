import { NS_SVG, NS_XMLNS, NS_XLINK } from '@/utils/namespaces';
import type { DOMApi } from '@/utils/dom-api';
import {
  isRehydrationScheduled,
  itemFromRehydrationStack,
  lastItemInStack,
} from './rehydration';

export class SVGRehydrationBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(doc: Document) {
    this.doc = doc;
  }
  isNode(node: Node): node is Node {
    return 'nodeType' in node;
  }
  destroy(node: Node): void {
    if (!node || !node.isConnected) return;
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
    return 'hydration-svg:dom-api';
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
  element(tagName: string): SVGElement {
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
      // check tagName (SVG elements have uppercase tagName in DOM)
      if (
        node &&
        (node.tagName === tagName.toUpperCase() || node.tagName === tagName)
      ) {
        return node as unknown as SVGElement;
      } else {
        // if node may be a text node from element
        if (
          node &&
          (node.nodeType === Node.TEXT_NODE ||
            node.nodeType === Node.COMMENT_NODE)
        ) {
          node = itemFromRehydrationStack();
          if (node && (node.tagName === tagName.toUpperCase() || node.tagName === tagName)) {
            return node as unknown as SVGElement;
          } else {
            // it may be a case where we have a queue of text/comment nodes
            if (
              node &&
              (node.nodeType === Node.TEXT_NODE ||
                node.nodeType === Node.COMMENT_NODE)
            ) {
              return this.element(tagName);
            }
            throw new Error(
              `SVG Rehydration failed. Expected tagName: ${tagName} got: ${node?.tagName}.`,
            );
          }
        }
        throw new Error(
          `SVG Rehydration failed. Expected tagName: ${tagName} got: ${node?.tagName}.`,
        );
      }
    }
    return this.doc.createElementNS(NS_SVG, tagName) as SVGElement;
  }
  attr(element: SVGElement, name: string, value: string) {
    if (isRehydrationScheduled()) {
      const existingValue = element.getAttribute(name);
      if (existingValue === value) {
        return;
      }
    }
    if (name.includes(':')) {
      if (name.startsWith('xmlns')) {
        element.setAttributeNS(NS_XMLNS, name, value);
      } else if (name.startsWith('xlink')) {
        element.setAttributeNS(NS_XLINK, name, value);
      } else {
        element.setAttributeNS(NS_SVG, name, value);
      }
    } else {
      element.setAttribute(name, value);
    }
  }
  prop(element: SVGElement, name: string, value: string) {
    if (isRehydrationScheduled()) {
      if (name === 'className') {
        const existingValue = element.getAttribute('class');
        if (existingValue === value) {
          return value;
        }
      } else {
        const existingValue = element.getAttribute(name);
        if (existingValue === value) {
          return value;
        }
      }
    }
    if (name === 'className') {
      element.setAttribute('class', value);
    } else {
      element.setAttribute(name, value);
    }
    return value;
  }
  insert(parent: SVGElement, child: SVGElement, anchor?: SVGElement | null) {
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
