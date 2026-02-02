import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { renderElement, destroyElementSync, Component, runDestructors } from './component';
import { registerDestructor } from './glimmer/destroyable';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  COMPONENT_ID_PROPERTY,
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

// ============================================
// destroyNodes with nested ComponentReturnType
// ============================================

describe('destroyNodes - nested components', () => {
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

  test('destroys DOM nodes nested inside ComponentReturnType objects', () => {
    // Create nested structure: parent -> child component -> DOM nodes
    const childDiv = document.createElement('div');
    childDiv.textContent = 'child content';
    container.appendChild(childDiv);

    // Child component with actual DOM node
    const childComponent = new Component({});
    childComponent[RENDERED_NODES_PROPERTY] = [childDiv];
    addToTree(root, childComponent);

    // Parent component with child component in RENDERED_NODES_PROPERTY
    // This simulates what happens with $_fin([$_c(component, ...)], this)
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [childComponent as unknown as Node]; // Contains ComponentReturnType, not Node
    addToTree(root, parentComponent);

    expect(childDiv.isConnected).toBe(true);

    // Destroy parent - should recursively destroy child's DOM nodes
    destroyElementSync(parentComponent, false, api);

    expect(childDiv.isConnected).toBe(false);
  });

  test('destroys deeply nested component structures', () => {
    // Create 3-level nesting: grandparent -> parent -> child -> DOM
    const leafDiv = document.createElement('div');
    leafDiv.textContent = 'leaf';
    container.appendChild(leafDiv);

    const childComponent = new Component({});
    childComponent[RENDERED_NODES_PROPERTY] = [leafDiv];
    addToTree(root, childComponent);

    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [childComponent as unknown as Node];
    addToTree(root, parentComponent);

    const grandparentComponent = new Component({});
    grandparentComponent[RENDERED_NODES_PROPERTY] = [parentComponent as unknown as Node];
    addToTree(root, grandparentComponent);

    expect(leafDiv.isConnected).toBe(true);

    destroyElementSync(grandparentComponent, false, api);

    expect(leafDiv.isConnected).toBe(false);
  });

  test('destroys mixed array of nodes and components', () => {
    const directDiv = document.createElement('div');
    directDiv.textContent = 'direct';
    container.appendChild(directDiv);

    const nestedDiv = document.createElement('div');
    nestedDiv.textContent = 'nested';
    container.appendChild(nestedDiv);

    const childComponent = new Component({});
    childComponent[RENDERED_NODES_PROPERTY] = [nestedDiv];
    addToTree(root, childComponent);

    // Parent has both direct DOM nodes and nested components
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [directDiv, childComponent as unknown as Node];
    addToTree(root, parentComponent);

    expect(directDiv.isConnected).toBe(true);
    expect(nestedDiv.isConnected).toBe(true);

    destroyElementSync(parentComponent, false, api);

    expect(directDiv.isConnected).toBe(false);
    expect(nestedDiv.isConnected).toBe(false);
  });

  test('handles empty RENDERED_NODES_PROPERTY gracefully', () => {
    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, component);

    // Should not throw
    expect(() => destroyElementSync(component, false, api)).not.toThrow();
  });

  test('handles undefined in RENDERED_NODES_PROPERTY array', () => {
    const validDiv = document.createElement('div');
    container.appendChild(validDiv);

    const component = new Component({});
    // Simulate corrupted array with undefined values
    component[RENDERED_NODES_PROPERTY] = [validDiv, undefined as any, null as any];
    addToTree(root, component);

    // Should not throw and should still destroy valid nodes
    expect(() => destroyElementSync(component, false, api)).not.toThrow();
    expect(validDiv.isConnected).toBe(false);
  });

  test('handles component with undefined RENDERED_NODES_PROPERTY', () => {
    const childComponent = new Component({});
    // Don't set RENDERED_NODES_PROPERTY - it will be undefined
    addToTree(root, childComponent);

    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [childComponent as unknown as Node];
    addToTree(root, parentComponent);

    // Should not throw
    expect(() => destroyElementSync(parentComponent, false, api)).not.toThrow();
  });

  test('multiple sibling components are all destroyed', () => {
    const div1 = document.createElement('div');
    const div2 = document.createElement('div');
    const div3 = document.createElement('div');
    container.appendChild(div1);
    container.appendChild(div2);
    container.appendChild(div3);

    const child1 = new Component({});
    child1[RENDERED_NODES_PROPERTY] = [div1];
    addToTree(root, child1);

    const child2 = new Component({});
    child2[RENDERED_NODES_PROPERTY] = [div2];
    addToTree(root, child2);

    const child3 = new Component({});
    child3[RENDERED_NODES_PROPERTY] = [div3];
    addToTree(root, child3);

    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [child1 as unknown as Node, child2 as unknown as Node, child3 as unknown as Node];
    addToTree(root, parent);

    expect(div1.isConnected).toBe(true);
    expect(div2.isConnected).toBe(true);
    expect(div3.isConnected).toBe(true);

    destroyElementSync(parent, false, api);

    expect(div1.isConnected).toBe(false);
    expect(div2.isConnected).toBe(false);
    expect(div3.isConnected).toBe(false);
  });

  test('destruction order is preserved (left to right)', () => {
    const destructionOrder: string[] = [];

    // Create a custom API that tracks destruction order
    const trackingApi = {
      ...api,
      destroy(node: Node) {
        destructionOrder.push((node as HTMLElement).id || node.textContent || 'unknown');
        api.destroy(node);
      },
    } as DOMApi;

    const div1 = document.createElement('div');
    div1.id = 'div1';
    const div2 = document.createElement('div');
    div2.id = 'div2';
    const div3 = document.createElement('div');
    div3.id = 'div3';
    container.appendChild(div1);
    container.appendChild(div2);
    container.appendChild(div3);

    // Nested structure: parent -> [div1, child -> [div2], div3]
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [div2];
    addToTree(root, child);

    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [div1, child as unknown as Node, div3];
    addToTree(root, parent);

    destroyElementSync(parent, false, trackingApi);

    // Order should be: div1, div2 (from nested child), div3
    expect(destructionOrder).toEqual(['div1', 'div2', 'div3']);
  });

  test('empty array RENDERED_NODES_PROPERTY is handled (not undefined)', () => {
    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = []; // Empty array, not undefined
    addToTree(root, component);

    // Should recognize this as a component (has property) and not throw
    expect(() => destroyElementSync(component, false, api)).not.toThrow();
  });

  test('skipDom=true prevents DOM node removal but still processes components', () => {
    const div = document.createElement('div');
    container.appendChild(div);

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div];
    addToTree(root, component);

    expect(div.isConnected).toBe(true);

    destroyElementSync(component, true, api); // skipDom = true

    // Node should still be connected since skipDom is true
    expect(div.isConnected).toBe(true);
  });

  test('skips destroy call for child nodes when parent already destroyed', () => {
    const destroyCalls: string[] = [];

    // Create a tracking API that logs destroy calls
    const trackingApi = {
      ...api,
      destroy(node: Node) {
        const id = (node as HTMLElement).id || 'unknown';
        destroyCalls.push(id);
        api.destroy(node);
      },
    } as DOMApi;

    // Create DOM structure: parentDiv > childDiv > grandchildDiv
    const parentDiv = document.createElement('div');
    parentDiv.id = 'parent';
    const childDiv = document.createElement('div');
    childDiv.id = 'child';
    const grandchildDiv = document.createElement('div');
    grandchildDiv.id = 'grandchild';

    parentDiv.appendChild(childDiv);
    childDiv.appendChild(grandchildDiv);
    container.appendChild(parentDiv);

    // Create component structure that references these nodes in order
    // parent -> [parentDiv], child -> [childDiv], grandchild -> [grandchildDiv]
    const grandchildComponent = new Component({});
    grandchildComponent[RENDERED_NODES_PROPERTY] = [grandchildDiv];
    addToTree(root, grandchildComponent);

    const childComponent = new Component({});
    childComponent[RENDERED_NODES_PROPERTY] = [childDiv, grandchildComponent as unknown as Node];
    addToTree(root, childComponent);

    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [parentDiv, childComponent as unknown as Node];
    addToTree(root, parentComponent);

    expect(parentDiv.isConnected).toBe(true);
    expect(childDiv.isConnected).toBe(true);
    expect(grandchildDiv.isConnected).toBe(true);

    destroyElementSync(parentComponent, false, trackingApi);

    // Only parentDiv should have destroy called - child and grandchild
    // become disconnected when parent is removed, so they should be skipped
    expect(destroyCalls).toEqual(['parent']);

    // All nodes should be disconnected
    expect(parentDiv.isConnected).toBe(false);
    expect(childDiv.isConnected).toBe(false);
    expect(grandchildDiv.isConnected).toBe(false);
  });

  test('still destroys sibling nodes that are not descendants', () => {
    const destroyCalls: string[] = [];

    const trackingApi = {
      ...api,
      destroy(node: Node) {
        const id = (node as HTMLElement).id || 'unknown';
        destroyCalls.push(id);
        api.destroy(node);
      },
    } as DOMApi;

    // Create two separate DOM trees (siblings, not parent-child)
    const div1 = document.createElement('div');
    div1.id = 'div1';
    const div2 = document.createElement('div');
    div2.id = 'div2';

    container.appendChild(div1);
    container.appendChild(div2);

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div1, div2];
    addToTree(root, component);

    destroyElementSync(component, false, trackingApi);

    // Both should be destroyed since they're siblings, not descendants
    expect(destroyCalls).toEqual(['div1', 'div2']);
  });

  test('child component destructors still run even when DOM nodes are skipped', () => {
    const destructorCalls: string[] = [];

    // Create DOM structure: parentDiv > childDiv > grandchildDiv
    const parentDiv = document.createElement('div');
    parentDiv.id = 'parent';
    const childDiv = document.createElement('div');
    childDiv.id = 'child';
    const grandchildDiv = document.createElement('div');
    grandchildDiv.id = 'grandchild';

    parentDiv.appendChild(childDiv);
    childDiv.appendChild(grandchildDiv);
    container.appendChild(parentDiv);

    // Create parent component first (root of our test tree)
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [parentDiv];
    addToTree(root, parentComponent);
    registerDestructor(parentComponent, () => {
      destructorCalls.push('parent-destructor');
    });

    // Create child component as child of parent
    const childComponent = new Component({});
    childComponent[RENDERED_NODES_PROPERTY] = [childDiv];
    addToTree(parentComponent, childComponent);
    registerDestructor(childComponent, () => {
      destructorCalls.push('child-destructor');
    });

    // Create grandchild component as child of child
    const grandchildComponent = new Component({});
    grandchildComponent[RENDERED_NODES_PROPERTY] = [grandchildDiv];
    addToTree(childComponent, grandchildComponent);
    registerDestructor(grandchildComponent, () => {
      destructorCalls.push('grandchild-destructor');
    });

    expect(destructorCalls).toEqual([]);

    // Destroy using runDestructors (which is what cleanupRender uses)
    runDestructors(parentComponent, [], false, api);

    // ALL destructors should have been called, even though child DOM nodes were skipped
    expect(destructorCalls).toContain('parent-destructor');
    expect(destructorCalls).toContain('child-destructor');
    expect(destructorCalls).toContain('grandchild-destructor');
    expect(destructorCalls.length).toBe(3);

    // All nodes should be disconnected
    expect(parentDiv.isConnected).toBe(false);
    expect(childDiv.isConnected).toBe(false);
    expect(grandchildDiv.isConnected).toBe(false);
  });

  test('async destructors still run for child components', async () => {
    const destructorCalls: string[] = [];

    const parentDiv = document.createElement('div');
    const childDiv = document.createElement('div');
    parentDiv.appendChild(childDiv);
    container.appendChild(parentDiv);

    // Create parent component first
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [parentDiv];
    addToTree(root, parentComponent);
    registerDestructor(parentComponent, () => {
      destructorCalls.push('parent-destructor');
    });

    // Create child component with async destructor as child of parent
    const childComponent = new Component({});
    childComponent[RENDERED_NODES_PROPERTY] = [childDiv];
    addToTree(parentComponent, childComponent);
    registerDestructor(childComponent, async () => {
      await Promise.resolve();
      destructorCalls.push('child-async-destructor');
    });

    // Use async destroyElement
    const { destroyElement } = await import('./component');
    await destroyElement(parentComponent, false, api);

    // Both destructors should have been called
    expect(destructorCalls).toContain('parent-destructor');
    expect(destructorCalls).toContain('child-async-destructor');
  });

  test('isConnected is checked only once per node (no double check regression)', () => {
    // This test ensures we don't have double isConnected checks which cause performance regression
    // The isConnected check should happen in destroyNodes, NOT in api.destroy()
    const isConnectedChecks: string[] = [];
    const destroyCalls: string[] = [];

    // Create a node with tracked isConnected getter
    const div = document.createElement('div');
    div.id = 'tracked-div';
    container.appendChild(div);

    // Track isConnected access using a proxy-like approach
    let realIsConnected = true;
    Object.defineProperty(div, 'isConnected', {
      get() {
        isConnectedChecks.push('checked');
        return realIsConnected;
      },
      configurable: true,
    });

    // Create a tracking API
    const trackingApi = {
      ...api,
      destroy(node: Node) {
        destroyCalls.push((node as HTMLElement).id || 'unknown');
        // Simulate what happens when remove() is called - node becomes disconnected
        realIsConnected = false;
        api.destroy(node);
      },
    } as DOMApi;

    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [div];
    addToTree(root, component);

    destroyElementSync(component, false, trackingApi);

    // isConnected should only be checked ONCE (in destroyNodes)
    // If api.destroy() also checks isConnected, we'd see 2 checks
    expect(isConnectedChecks.length).toBe(1);
    expect(destroyCalls).toEqual(['tracked-div']);
  });

  test('clearing many sibling items only checks isConnected once per item', () => {
    // Regression test for clearManyItems benchmark performance
    // When clearing many sibling items, each should only have isConnected checked once
    const ITEM_COUNT = 100; // Smaller than benchmark but enough to verify
    const isConnectedChecks: Map<string, number> = new Map();
    const divs: HTMLElement[] = [];

    // Create many sibling divs
    for (let i = 0; i < ITEM_COUNT; i++) {
      const div = document.createElement('div');
      div.id = `item-${i}`;
      container.appendChild(div);

      // Track isConnected checks per div
      let realIsConnected = true;
      Object.defineProperty(div, 'isConnected', {
        get() {
          const count = isConnectedChecks.get(div.id) || 0;
          isConnectedChecks.set(div.id, count + 1);
          return realIsConnected;
        },
        set(value) {
          realIsConnected = value;
        },
        configurable: true,
      });

      divs.push(div);
    }

    // Create components that reference these divs (simulating list items)
    const components: Component<any>[] = [];
    for (let i = 0; i < ITEM_COUNT; i++) {
      const comp = new Component({});
      comp[RENDERED_NODES_PROPERTY] = [divs[i]];
      addToTree(root, comp);
      components.push(comp);
    }

    // Create a parent that holds all components
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = components.map(c => c as unknown as Node);
    addToTree(root, parent);

    // Destroy all
    destroyElementSync(parent, false, api);

    // Each div should have isConnected checked exactly once
    for (let i = 0; i < ITEM_COUNT; i++) {
      const checkCount = isConnectedChecks.get(`item-${i}`) || 0;
      expect(checkCount).toBe(1);
    }
  });
});

// ============================================
// If Component Destruction Tests
// ============================================

import { IfCondition } from './control-flow/if';
import { cell, formula, opsForTag, relatedTags, tagsToRevalidate } from './reactive';
import { opcodeFor } from './vm';

describe('If Component Destruction', () => {
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
    tagsToRevalidate.clear();
    window.close();
  });

  test('opcodes are removed when if branch is destroyed', async () => {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const condition = cell(true);
    const reactiveValue = cell(42);
    let opcodeCallCount = 0;

    // Create an if condition
    const placeholder = document.createComment('if');
    container.appendChild(placeholder);

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      (ctx) => {
        // True branch: register an opcode for reactiveValue
        const div = document.createElement('div');
        const destructor = opcodeFor(reactiveValue, (value) => {
          opcodeCallCount++;
          div.textContent = String(value);
        });
        registerDestructor(ctx as unknown as Component<any>, destructor);
        return [div];
      },
      () => null, // False branch
    );

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify opcode is registered
    const opsBeforeDestroy = opsForTag.get(reactiveValue.id);
    expect(opsBeforeDestroy?.length).toBe(1);

    // Destroy the if component
    await ifInstance.destroy();

    // Verify opcodes are removed
    const opsAfterDestroy = opsForTag.get(reactiveValue.id);
    expect(opsAfterDestroy?.length ?? 0).toBe(0);
  });

  test('relatedTags are cleaned up when MergedCells are destroyed', async () => {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const condition = cell(true);
    const baseCell = cell(10);

    const placeholder = document.createComment('if');
    container.appendChild(placeholder);

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      (ctx) => {
        // True branch: create a formula that depends on baseCell
        const derivedCell = formula(() => baseCell.value * 2, 'test-derived');

        const div = document.createElement('div');
        const destructor = opcodeFor(derivedCell, (value) => {
          div.textContent = String(value);
        });
        registerDestructor(ctx as unknown as Component<any>, destructor);
        return [div];
      },
      () => null,
    );

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify relatedTags contains the derived cell
    const relatedBefore = relatedTags.get(baseCell.id);
    expect(relatedBefore?.size).toBeGreaterThan(0);

    // Destroy the if component
    await ifInstance.destroy();

    // Verify relatedTags is cleaned up
    const relatedAfter = relatedTags.get(baseCell.id);
    // Either deleted or empty
    expect(relatedAfter?.size ?? 0).toBe(0);
  });

  test('updating destroyed cell does not trigger opcodes', async () => {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const condition = cell(true);
    const reactiveValue = cell(1);
    let opcodeCallCount = 0;

    const placeholder = document.createComment('if');
    container.appendChild(placeholder);

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      (ctx) => {
        const div = document.createElement('div');
        const destructor = opcodeFor(reactiveValue, () => {
          opcodeCallCount++;
        });
        registerDestructor(ctx as unknown as Component<any>, destructor);
        return [div];
      },
      () => null,
    );

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 10));

    const initialCallCount = opcodeCallCount;

    // Update the cell - should trigger opcode
    reactiveValue.update(2);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(opcodeCallCount).toBe(initialCallCount + 1);

    // Destroy the if component
    await ifInstance.destroy();

    const countAfterDestroy = opcodeCallCount;

    // Update the cell after destruction - should NOT trigger opcode
    reactiveValue.update(3);
    await new Promise(resolve => setTimeout(resolve, 10));

    // Opcode should not have been called again
    expect(opcodeCallCount).toBe(countAfterDestroy);
  });

  test('HMR: IFS_FOR_HMR is cleaned up after destruction', async () => {
    // Skip if IS_DEV_MODE is not set (lib builds / production)
    if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
      return;
    }

    const { IFS_FOR_HMR } = await import('./shared');

    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const condition = cell(true);
    const placeholder = document.createComment('if');
    container.appendChild(placeholder);

    const initialHmrSize = IFS_FOR_HMR.size;

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      () => [document.createElement('div')],
      () => null,
    );

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 10));

    // In dev mode, if should be added to IFS_FOR_HMR
    expect(IFS_FOR_HMR.size).toBe(initialHmrSize + 1);

    // Destroy the if component
    await ifInstance.destroy();

    // IFS_FOR_HMR should be cleaned up
    expect(IFS_FOR_HMR.size).toBe(initialHmrSize);
  });

  test('tree structure is cleaned up after destruction', async () => {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const condition = cell(true);
    const placeholder = document.createComment('if');
    container.appendChild(placeholder);

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      () => [document.createElement('div')],
      () => null,
    );

    // Wait for initial render
    await new Promise(resolve => setTimeout(resolve, 10));

    const ifId = ifInstance[COMPONENT_ID_PROPERTY];

    // Verify if is in tree
    expect(TREE.has(ifId)).toBe(true);
    expect(PARENT.has(ifId)).toBe(true);

    // Destroy the if component
    await ifInstance.destroy();

    // Tree structure should be cleaned up
    expect(TREE.has(ifId)).toBe(false);
    expect(PARENT.has(ifId)).toBe(false);
    expect(CHILD.has(ifId)).toBe(false);
  });

  test('multiple create/destroy cycles do not leak (HMR simulation)', async () => {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const initialTreeSize = TREE.size;

    // Simulate 5 HMR cycles
    for (let cycle = 0; cycle < 5; cycle++) {
      const condition = cell(true);
      const placeholder = document.createComment('if');
      container.appendChild(placeholder);

      const ifInstance = new IfCondition(
        parentComponent,
        condition,
        container,
        placeholder,
        (ctx) => {
          // Create nested component with reactive binding
          const reactiveValue = cell(cycle);
          const div = document.createElement('div');
          const destructor = opcodeFor(reactiveValue, (value) => {
            div.textContent = String(value);
          });
          registerDestructor(ctx as unknown as Component<any>, destructor);
          return [div];
        },
        () => null,
      );

      await new Promise(resolve => setTimeout(resolve, 10));

      // Destroy
      await ifInstance.destroy();
      placeholder.remove();
    }

    // No leaks - tree size should be back to initial
    expect(TREE.size).toBe(initialTreeSize);
  });

  test('complete destruction cleans up all branch opcodes', async () => {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parentComponent);

    const condition = cell(true);
    const trueBranchValue = cell('true-value');
    let trueBranchOpcodeCount = 0;

    const placeholder = document.createComment('if');
    container.appendChild(placeholder);

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      (ctx) => {
        const div = document.createElement('div');
        const destructor = opcodeFor(trueBranchValue, () => {
          trueBranchOpcodeCount++;
        });
        registerDestructor(ctx as unknown as Component<any>, destructor);
        return [div];
      },
      () => null,
    );

    // Wait for initial render (true branch)
    await new Promise(resolve => setTimeout(resolve, 10));

    // Verify true branch opcode was called during initial render
    expect(trueBranchOpcodeCount).toBeGreaterThanOrEqual(1);

    // Destroy the entire IfCondition
    await ifInstance.destroy();

    const countAfterDestroy = trueBranchOpcodeCount;

    // Update true branch value after destruction - should NOT trigger opcode
    trueBranchValue.update('should-not-trigger');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(trueBranchOpcodeCount).toBe(countAfterDestroy);
  });
});

describe('renderElement unknown types fallback', () => {
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

  test('renders object with custom toString as text', () => {
    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, component);

    const customObj = {
      toString() {
        return 'custom-text';
      },
    };

    renderElement(api, component, container, customObj as any);
    expect(container.textContent).toBe('custom-text');
    expect(component[RENDERED_NODES_PROPERTY].length).toBe(1);
  });

  test('skips plain object with [object Object] toString', () => {
    const component = new Component({});
    component[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, component);

    const plainObj = { foo: 'bar' };

    // In dev mode this may warn but not throw, in prod it should skip silently
    renderElement(api, component, container, plainObj as any);
    // Should not render [object Object]
    expect(container.textContent).not.toBe('[object Object]');
  });
});
