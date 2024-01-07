export const api = {
  attr(element: HTMLElement, name: string, value: string | null) {
    if (name.includes(':')) {
      const [ns, key] = name.split(':');
      element.setAttributeNS(ns, key, value as string);
      return;
    }
    element.setAttribute(name, value === null ? '' : value);
  },
  comment(text = '') {
    return document.createComment(text);
  },
  text(text = '') {
    return document.createTextNode(text);
  },
  textContent(node: Node, text: string) {
    node.textContent = text;
  },
  fragment() {
    return document.createDocumentFragment();
  },
  element(tagName = '') {
    return document.createElement(tagName);
  },
  svgElement(tagName = '') {
    return document.createElementNS('http://www.w3.org/2000/svg',  tagName);
  },
  append(parent: HTMLElement | Node, child: HTMLElement | Node) {
    parent.appendChild(child);
  },
  insert(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    anchor?: HTMLElement | Node | null,
  ) {
    parent.insertBefore(child, anchor || null);
  },
};
