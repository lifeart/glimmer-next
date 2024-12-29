import { hbs } from '@lifeart/gxt';
import { provideContext } from './context';
import { getDocument, RENDERING_CONTEXT, api } from "./dom-api";

// SVG DOM API
export const svgDomApi = {
    textContent(node: Node, text: string) {
      node.textContent = text;
    },
    element: (tagName: string): SVGElement => {
      return getDocument().createElementNS('http://www.w3.org/2000/svg', tagName) as SVGElement;
    },
    attr: (element: SVGElement, name: string, value: string) => {
      element.setAttribute(name, value);
    },
    append: (parent: SVGElement, child: SVGElement) => {
      parent.appendChild(child);
    },
};

export function SvgProvider() {
  provideContext(this, RENDERING_CONTEXT, svgDomApi);
  return hbs`{{yield}}`;
}

export function HtmlProvider() {
  provideContext(this, RENDERING_CONTEXT, api);
  return hbs`{{yield}}`;
}