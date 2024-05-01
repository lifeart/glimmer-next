import { getNodeCounter, incrementNodeCounter } from '@/utils/dom';
import { IN_SSR_ENV, noop } from './shared';

let $doc =
  typeof document !== 'undefined'
    ? document
    : (undefined as unknown as Document);
export function setDocument(newDocument: Document) {
  $doc = newDocument;
}
export function getDocument() {
  return $doc;
}
export const api = {
  addEventListener(node: Node, eventName: string, fn: EventListener) {
    if (import.meta.env.SSR) {
      return noop;
    }
    node.addEventListener(eventName, fn);
    if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
      return () => {
        node.removeEventListener(eventName, fn);
      };
    } else {
      return noop;
    }
  },
  attr(element: HTMLElement, name: string, value: string | null) {
    element.setAttribute(name, value === null ? '' : value);
  },
  prop(element: HTMLElement, name: string, value: any) {
    // @ts-ignore
    element[name] = value;
    return value;
  },
  comment(text = '') {
    if (IN_SSR_ENV) {
      incrementNodeCounter();
      return $doc.createComment(`${text} $[${getNodeCounter()}]`);
    } else {
      if (IS_DEV_MODE) {
        return $doc.createComment(text);
      } else {
        return $doc.createComment('');
      }
    }
  },
  text(text = '') {
    return $doc.createTextNode(text);
  },
  textContent(node: Node, text: string) {
    node.textContent = text;
  },
  fragment() {
    return $doc.createDocumentFragment();
  },
  element(tagName = ''): HTMLElement {
    return $doc.createElement(tagName);
  },
  append(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    // @ts-ignore
    targetIndex: number = 0,
  ) {
    this.insert(parent, child, null);
  },
  insert(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    anchor?: HTMLElement | Node | null,
  ) {
    parent.insertBefore(child, anchor || null);
  },
};
