import { hbs } from '@lifeart/gxt';
import { provideContext } from './context';
import { getDocument, RENDERING_CONTEXT, api } from './dom-api';
import { NS_SVG, NS_MATHML, NS_XMLNS, NS_XLINK } from '@/utils/namespaces';

// SVG DOM API
export const svgDomApi = {
  text(text: string) {
    return getDocument().createTextNode(text);
  },
  textContent(node: Node, text: string) {
    node.textContent = text;
  },
  element: (tagName: string): SVGElement => {
    return getDocument().createElementNS(NS_SVG, tagName) as SVGElement;
  },
  attr: (element: SVGElement, name: string, value: string) => {
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
  },
  prop: (element: SVGElement, name: string, value: string) => {
    if (name === 'className') {
      element.setAttribute('class', value);
    } else {
      element.setAttribute(name, value);
    }
  },
  append: (parent: SVGElement, child: SVGElement) => {
    parent.appendChild(child);
  },
};

export const mathDomApi = {
  text(text: string) {
    return getDocument().createTextNode(text);
  },
  textContent(node: Node, text: string) {
    node.textContent = text;
  },
  element: (tagName: string): SVGElement => {
    return getDocument().createElementNS(NS_MATHML, tagName) as SVGElement;
  },
  attr: (element: SVGElement, name: string, value: string) => {
    if (name.includes(':')) {
      element.setAttributeNS(NS_MATHML, name, value);
    } else {
      element.setAttribute(name, value);
    }
  },
  prop: (element: SVGElement, name: string, value: string) => {
    element.setAttribute(name, value);
  },
  append: (parent: SVGElement, child: SVGElement) => {
    parent.appendChild(child);
  },
};

export function SVGProvider() {
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, svgDomApi);
  return hbs`{{yield}}`;
}

export function HTMLProvider() {
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, api);
  return hbs`{{yield}}`;
}

export function MathMLProvider() {
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, mathDomApi);
  return hbs`{{yield}}`;
}
