import { Component } from "./component";
import { $template } from "./shared";
import { provideContext } from './context';
import { getDocument, RENDERING_CONTEXT } from "./dom-api";

// SVG DOM API
export const svgDomApi = {
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

export class SvgProvider extends Component {
    constructor() {
        super(...arguments);
        provideContext(this, RENDERING_CONTEXT, svgDomApi);
        console.log('svg context provided');

    }
    [$template]() {
        return [];
    }
}