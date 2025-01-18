import { getNodeCounter, incrementNodeCounter } from '@/utils/dom';
import { IN_SSR_ENV, noop } from './shared';

type VoidFn = () => void;

export abstract class DOMApi {
  abstract toString(): string;
  abstract isNode(node: Node): node is Node;
  abstract addEventListener(
    node: Node,
    eventName: string,
    fn: EventListener,
  ): undefined | VoidFn;
  abstract attr(element: Node, name: string, value: string | null): void;
  abstract prop(element: Node, name: string, value: any): void;
  abstract comment(text?: string): Comment;
  abstract text(text: string | number): Node;
  abstract textContent(node: Node, text: string): void;
  abstract fragment(): DocumentFragment;
  abstract element(tagName: string): Node;
  abstract insert(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    anchor?: HTMLElement | Node | null,
  ): void;
  abstract destroy(element: Node): void;
}

export class HTMLBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(document: Document) {
    this.doc = document;
  }
  isNode(node: Node): node is Node  {
    return 'nodeType' in node;
  }
  destroy(node: Node): void {
    // Skip if node is already detached
    if (!node.isConnected) return;
    // @ts-expect-error
    node.remove();
  }
  toString() {
    return 'html:dom-api';
  }
  addEventListener(node: Node, eventName: string, fn: EventListener) {
    if (import.meta.env.SSR) {
      if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
        return noop;
      }
      return;
    }
    node.addEventListener(eventName, fn);
    if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
      return () => {
        node.removeEventListener(eventName, fn);
      };
    }
  }
  attr(element: HTMLElement, name: string, value: string | null) {
    element.setAttribute(name, value === null ? '' : value);
  }
  prop(element: HTMLElement, name: string, value: any) {
    // @ts-ignore
    element[name] = value;
    return value;
  }
  comment(text = '') {
    if (IN_SSR_ENV) {
      incrementNodeCounter();
      return this.doc.createComment(`${text} $[${getNodeCounter()}]`);
    } else {
      if (IS_DEV_MODE) {
        return this.doc.createComment(text);
      } else {
        return this.doc.createComment('');
      }
    }
  }
  text(text: string | number = '') {
    return this.doc.createTextNode(text as string);
  }
  textContent(node: Node, text: string) {
    node.textContent = text;
  }
  fragment() {
    return this.doc.createDocumentFragment();
  }
  element(tagName = ''): HTMLElement {
    return this.doc.createElement(tagName);
  }
  insert(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    anchor?: HTMLElement | Node | null,
  ) {
    parent.insertBefore(child, anchor || null);
  }
}
