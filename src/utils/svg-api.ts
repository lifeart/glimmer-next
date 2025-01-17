import { NS_SVG, NS_XMLNS, NS_XLINK } from '@/utils/namespaces';
import type { DOMApi } from './dom-api';

export class SVGBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(document: Document) {
    this.doc = document;
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
