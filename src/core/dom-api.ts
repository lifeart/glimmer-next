import { getNodeCounter, incrementNodeCounter } from '@/core/dom';
import { IN_SSR_ENV, noop } from './shared';

type VoidFn = () => void;

export abstract class DOMApi {
  abstract toString(): string;
  abstract parent(node: Node): Node | null;
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
  abstract clearChildren(element: Node): void;
}

export class HTMLBrowserDOMApi implements DOMApi {
  declare doc: Document;
  constructor(document: Document) {
    this.doc = document;
  }
  parent(node: Node) {
    return node.parentNode;
  }
  isNode(node: Node): node is Node  {
    return 'nodeType' in node;
  }
  destroy(node: Node): void {
    // Skip if node is undefined (isConnected check handled by caller)
    if (!node) return;
    // A DocumentFragment (nodeType 11) has no `.remove()` — and once its
    // children have been moved into the live DOM (every `api.insert` of a
    // fragment empties it), there is nothing to reclaim here anyway. Calling
    // `.remove()` on it throws `node.remove is not a function`, which (when it
    // happens mid-`syncList` row teardown for an `{{{value}}}` each-body that
    // returned a fragment) aborts the entire reconcile — leaving stale rows
    // un-removed AND new rows un-rendered (GH#16314). Skip non-removable nodes
    // defensively; the real content reclamation is handled by the html-raw
    // teardown destructor (gxt-backend compile.ts) / the row's other rendered
    // nodes.
    if (typeof (node as unknown as { remove?: unknown }).remove !== 'function') {
      return;
    }
    // @ts-expect-error remove() exists on Element/CharacterData, not on Node
    node.remove();
  }
  clearChildren(element: Node): void {
    // @ts-expect-error innerHTML is not on Node type but works on Element
    element.innerHTML = '';
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
    // Guard check is cheaper than try-catch and handles edge cases
    if (parent !== null) {
      parent.insertBefore(child, anchor || null);
    }
  }
}
