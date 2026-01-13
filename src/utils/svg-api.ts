import { NS_SVG, NS_XMLNS, NS_XLINK } from '@/utils/namespaces';
import type { DOMApi } from './dom-api';

export class SVGBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(document: Document) {
    this.doc = document;
  }
  isNode(node: Node): node is Node  {
    return 'nodeType' in node;
  }
  destroy(node: Node): void {
    // Skip if node is undefined or already detached
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
  // @ts-expect-error
  addEventListener(_: Node, __: string, ___: EventListener) {}
  toString() {
    return 'svg:dom-api';
  }
  text(text: string) {
    return this.doc.createTextNode(text);
  }
  textContent(node: Node, text: string) {
    node.textContent = text;
  }
  element(tagName: string): SVGElement {
    return this.doc.createElementNS(NS_SVG, tagName) as SVGElement;
  }
  attr(element: SVGElement, name: string, value: string) {
    if (name.includes(':')) {
      // console.log(element, name, value);
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
    if (name === 'className') {
      element.setAttribute('class', value);
    } else {
      element.setAttribute(name, value);
    }
  }
  insert(parent: SVGElement, child: SVGElement) {
    parent.insertBefore(child, null);
  }
}
