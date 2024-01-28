import { getNodeCounter, incrementNodeCounter } from '@/utils/dom';
import { IN_SSR_ENV } from './shared';

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
  attr(element: HTMLElement, name: string, value: string | null) {
    element.setAttribute(name, value === null ? '' : value);
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
