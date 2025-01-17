import { NS_MATHML } from '@/utils/namespaces';
import { DOMApi } from './dom-api';

export class MathMLBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(document: Document) {
    this.doc = document;
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
  append(parent: SVGElement, child: SVGElement) {
    parent.appendChild(child);
  }
  insert(parent: SVGElement, child: SVGElement) {
    parent.insertBefore(child, null);
  }
}
