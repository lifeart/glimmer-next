import { Component } from "./component";
import { $template } from "./shared";
import { provideContext } from './context';
import { getDocument, RENDERING_CONTEXT } from "./dom-api";

// SVG DOM API
const svgDomApi = {
    element: (tagName: string): SVGElement => {
      return getDocument().createElementNS('http://www.w3.org/2000/svg', tagName) as SVGElement;
    },
    setAttribute: (element: SVGElement, name: string, value: string) => {
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

    }
    [$template]() {
        return [];
    }
}