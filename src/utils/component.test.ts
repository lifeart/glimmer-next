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
// If Component Destruction Tests
// ============================================

import { IfCondition } from './control-flow/if';
import { cell, formula, opsForTag, relatedTags, tagsToRevalidate } from './reactive';
import { opcodeFor } from './vm';
import { registerDestructor } from './glimmer/destroyable';

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

    let mergedCellId: number | null = null;

    const ifInstance = new IfCondition(
      parentComponent,
      condition,
      container,
      placeholder,
      (ctx) => {
        // True branch: create a formula that depends on baseCell
        const derivedCell = formula(() => baseCell.value * 2, 'test-derived');
        mergedCellId = derivedCell.id;

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
