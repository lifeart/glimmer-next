import { NS_MATHML } from '@/utils/namespaces';
import { DOMApi } from './dom-api';

export class MathMLBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(document: Document) {
    this.doc = document;
  }
  isNode(node: Node): node is Node {
    return 'nodeType' in node;
  }
  destroy(node: Node): void {
    // Skip if node is already detached
    if (!node.isConnected) return;
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
  // @ts-expect-error foo
  addEventListener(_, __) {}
  toString() {
    return 'mathml:dom-api';
  }
  text(text: string) {
    return this.doc.createTextNode(text);
  }
  textContent(node: Node, text: string) {
    node.textContent = text;
  }
  element(tagName: string): SVGElement {
    return this.doc.createElementNS(NS_MATHML, tagName) as SVGElement;
  }
  attr(element: SVGElement, name: string, value: string) {
    if (name.includes(':')) {
      element.setAttributeNS(NS_MATHML, name, value);
    } else {
      element.setAttribute(name, value);
    }
  }
  prop(element: SVGElement, name: string, value: string) {
    element.setAttribute(name, value);
  }
  insert(parent: SVGElement, child: SVGElement) {
    parent.insertBefore(child, null);
  }
}
