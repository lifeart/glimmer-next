import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { renderElement, destroyElementSync, Component } from './component';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
} from './shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import { Root } from './dom';

describe('renderElement', () => {
  let window: Window;
  let document: Document;
  let api: DOMApi;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  describe('primitive values', () => {
    test('renders string as text node', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      renderElement(api, component, container, 'hello');
      expect(container.textContent).toBe('hello');
      expect(component[RENDERED_NODES_PROPERTY].length).toBe(1);
    });

    test('renders number as text node', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      renderElement(api, component, container, 42);
      expect(container.textContent).toBe('42');
    });

    test('skips empty string', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      renderElement(api, component, container, '');
      expect(container.childNodes.length).toBe(0);
    });

    test('skips null', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      renderElement(api, component, container, null);
      expect(container.childNodes.length).toBe(0);
    });

    test('skips undefined', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      renderElement(api, component, container, undefined);
      expect(container.childNodes.length).toBe(0);
    });
  });

  describe('DOM nodes', () => {
    test('renders DOM element', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const div = document.createElement('div');
      div.textContent = 'test';
      renderElement(api, component, container, div);
      expect(container.firstChild).toBe(div);
      expect(component[RENDERED_NODES_PROPERTY]).toContain(div);
    });

    test('renders text node', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const text = document.createTextNode('hello');
      renderElement(api, component, container, text);
      expect(container.firstChild).toBe(text);
    });

    test('renders comment node', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const comment = document.createComment('test');
      renderElement(api, component, container, comment);
      expect(container.firstChild).toBe(comment);
    });

    test('inserts before placeholder when provided', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const placeholder = document.createComment('placeholder');
      container.appendChild(placeholder);

      const div = document.createElement('div');
      renderElement(api, component, container, div, placeholder);

      expect(container.firstChild).toBe(div);
      expect(container.lastChild).toBe(placeholder);
    });
  });

  describe('arrays', () => {
    test('renders array of nodes', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      renderElement(api, component, container, [div1, div2]);
      expect(container.childNodes.length).toBe(2);
      expect(container.firstChild).toBe(div1);
      expect(container.lastChild).toBe(div2);
    });

    test('renders nested arrays', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      renderElement(api, component, container, [[div1], [div2]]);
      expect(container.childNodes.length).toBe(2);
    });

    test('renders mixed array of strings and nodes', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const div = document.createElement('div');
      renderElement(api, component, container, ['text', div, 123]);
      expect(container.childNodes.length).toBe(3);
    });
  });

  describe('skipRegistration', () => {
    test('does not add to rendered nodes when skipRegistration is true', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const div = document.createElement('div');
      renderElement(api, component, container, div, null, true);
      expect(container.firstChild).toBe(div);
      expect(component[RENDERED_NODES_PROPERTY]).not.toContain(div);
    });

    test('adds to rendered nodes when skipRegistration is false', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const div = document.createElement('div');
      renderElement(api, component, container, div, null, false);
      expect(component[RENDERED_NODES_PROPERTY]).toContain(div);
    });
  });
});

describe('destroyElementSync', () => {
  let window: Window;
  let document: Document;
  let api: DOMApi;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('removes connected node from DOM', () => {
    const div = document.createElement('div');
    container.appendChild(div);
    expect(div.isConnected).toBe(true);

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div];
    addToTree(root, component);

    destroyElementSync(component, false, api);
    expect(div.isConnected).toBe(false);
  });

  test('handles already detached nodes', () => {
    const div = document.createElement('div');
    expect(div.isConnected).toBe(false);

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div];
    addToTree(root, component);

    // Should not throw
    expect(() => destroyElementSync(component, false, api)).not.toThrow();
  });

  test('skips DOM removal when skipDom is true', () => {
    const div = document.createElement('div');
    container.appendChild(div);

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div];
    addToTree(root, component);

    destroyElementSync(component, true, api);
    // Node should still be connected since skipDom is true
    expect(div.isConnected).toBe(true);
  });

  test('destroys child components recursively', () => {
    const parentDiv = document.createElement('div');
    const childDiv = document.createElement('div');
    container.appendChild(parentDiv);
    container.appendChild(childDiv);

    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [parentDiv];
    addToTree(root, parent);

    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [childDiv];
    addToTree(parent, child);

    destroyElementSync(parent, false, api);

    expect(parentDiv.isConnected).toBe(false);
    expect(childDiv.isConnected).toBe(false);
  });

  test('handles array of components', () => {
    const div1 = document.createElement('div');
    const div2 = document.createElement('div');
    container.appendChild(div1);
    container.appendChild(div2);

    const comp1 = new Component({});
    comp1[RENDERED_NODES_PROPERTY] = [div1];
    addToTree(root, comp1);

    const comp2 = new Component({});
    comp2[RENDERED_NODES_PROPERTY] = [div2];
    addToTree(root, comp2);

    destroyElementSync([comp1, comp2], false, api);

    expect(div1.isConnected).toBe(false);
    expect(div2.isConnected).toBe(false);
  });
});

describe('Custom DOMApi integration', () => {
  class MockCustomApi implements DOMApi {
    destroyCalled: Node[] = [];
    clearChildrenCalled: Node[] = [];
    doc: Document;

    constructor(document: Document) {
      this.doc = document;
    }

    toString() {
      return 'mock:custom-api';
    }

    parent(node: Node) {
      return node.parentNode;
    }

    isNode(node: Node): node is Node {
      return 'nodeType' in node;
    }

    addEventListener() {
      return undefined;
    }

    attr(element: HTMLElement, name: string, value: string | null) {
      element.setAttribute(name, value ?? '');
    }

    prop(element: HTMLElement, name: string, value: any) {
      (element as any)[name] = value;
      return value;
    }

    comment(text = '') {
      return this.doc.createComment(text);
    }

    text(text: string | number) {
      return this.doc.createTextNode(String(text));
    }

    textContent(node: Node, text: string) {
      node.textContent = text;
    }

    fragment() {
      return this.doc.createDocumentFragment();
    }

    element(tagName: string) {
      return this.doc.createElement(tagName);
    }

    insert(parent: Node, child: Node, anchor?: Node | null) {
      parent.insertBefore(child, anchor || null);
    }

    destroy(element: Node) {
      this.destroyCalled.push(element);
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }

    clearChildren(element: Node) {
      this.clearChildrenCalled.push(element);
      (element as HTMLElement).innerHTML = '';
    }
  }

  let window: Window;
  let document: Document;
  let customApi: MockCustomApi;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    customApi = new MockCustomApi(document);
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, customApi);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('uses custom API destroy method', () => {
    const div = document.createElement('div');
    container.appendChild(div);

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div];
    addToTree(root, component);

    destroyElementSync(component, false, customApi);

    expect(customApi.destroyCalled).toContain(div);
  });

  test('renders using custom API methods', () => {
    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, component);

    renderElement(customApi, component, container, 'test text');

    expect(container.textContent).toBe('test text');
  });

  test('custom API isNode check works', () => {
    const div = document.createElement('div');
    expect(customApi.isNode(div)).toBe(true);

    // Non-node object
    expect(customApi.isNode({} as any)).toBe(false);
  });
});
