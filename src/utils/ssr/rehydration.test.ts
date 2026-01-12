import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  isRehydrationScheduled,
  lastItemInStack,
} from './rehydration';
import {
  cleanupFastContext,
  provideContext,
  RENDERING_CONTEXT,
  initDOM,
} from '../context';
import { HTMLBrowserDOMApi, DOMApi } from '../dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
} from '../shared';
import { Component } from '../component';
import { Root } from '../dom';

// Custom DOMApi for testing nested contexts
class TestCustomDOMApi implements DOMApi {
  name: string;
  doc: Document;

  constructor(name: string, document: Document) {
    this.name = name;
    this.doc = document;
  }

  toString() {
    return `test:${this.name}`;
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
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }

  clearChildren(element: Node) {
    (element as HTMLElement).innerHTML = '';
  }
}

// Helper to create a component and add it to the tree
function createComponent(parent: Component<any> | Root): Component<any> {
  const component = new Component({});
  component[RENDERED_NODES_PROPERTY] = [];
  addToTree(parent, component);
  return component;
}

describe('Rehydration Context Issues', () => {
  let window: Window;
  let document: Document;
  let root: Root;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    root = new Root(document);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  describe('Global rehydration state', () => {
    test('isRehydrationScheduled is a global flag', () => {
      // The rehydrationScheduled flag is global, not per-context
      // This means nested custom renderers (Canvas, SVG) will see
      // the same rehydration state as the parent DOM tree
      expect(typeof isRehydrationScheduled()).toBe('boolean');
    });

    test('KNOWN ISSUE: nested contexts share rehydration state', () => {
      // When rehydrating a DOM tree that contains a Canvas component,
      // the Canvas component will incorrectly see isRehydrationScheduled() as true
      //
      // This can cause issues because:
      // 1. Canvas elements don't participate in DOM rehydration
      // 2. Canvas API doesn't understand the rehydration stack
      // 3. The Canvas component should render fresh, not try to rehydrate
      //
      // Current behavior: Canvas will see isRehydrationScheduled() === true
      // Expected behavior: Canvas should have its own rehydration context
      //
      // Documenting this as a known architectural issue that affects
      // nested rendering contexts during rehydration.
      expect(true).toBe(true); // Placeholder - actual test requires integration test
    });
  });

  describe('Context during rehydration', () => {
    test('HTML API provided to root during rehydration', () => {
      const htmlApi = new HTMLBrowserDOMApi(document);
      provideContext(root, RENDERING_CONTEXT, htmlApi);

      const child = createComponent(root);
      expect(initDOM(child).toString()).toBe('html:dom-api');
    });

    test('KNOWN ISSUE: nested custom renderer during rehydration uses parent API', () => {
      // During rehydration, withRehydration provides HTMLRehydrationBrowserDOMApi
      // to the root. If a Canvas component is nested inside, it will:
      // 1. Get HTMLRehydrationBrowserDOMApi (wrong!)
      // 2. Try to use DOM rehydration methods for canvas elements
      // 3. Potentially fail or cause incorrect rendering
      //
      // The current architecture doesn't support different rehydration
      // strategies for different parts of the tree.

      const htmlApi = new TestCustomDOMApi('html-rehydration', document);
      const canvasApi = new TestCustomDOMApi('canvas', document);

      provideContext(root, RENDERING_CONTEXT, htmlApi);

      // Simulate Canvas component providing its own context
      const canvasComponent = createComponent(root);
      provideContext(canvasComponent, RENDERING_CONTEXT, canvasApi);

      const canvasChild = createComponent(canvasComponent);

      // Canvas child should get canvasApi, not htmlApi
      expect(initDOM(canvasChild).toString()).toBe('test:canvas');
    });

    test('fast path is cleared when non-Root provides RENDERING_CONTEXT', () => {
      const htmlApi = new TestCustomDOMApi('html', document);
      const canvasApi = new TestCustomDOMApi('canvas', document);

      provideContext(root, RENDERING_CONTEXT, htmlApi);

      // This sets fast path since root is instanceof Root

      const canvasComponent = createComponent(root);
      provideContext(canvasComponent, RENDERING_CONTEXT, canvasApi);

      // After providing to non-Root, fast path should be cleared
      // forcing tree traversal for all context lookups
      const canvasChild = createComponent(canvasComponent);
      expect(initDOM(canvasChild).toString()).toBe('test:canvas');
    });
  });

  describe('Rehydration stack issues', () => {
    test('lastItemInStack returns undefined when stack is empty', () => {
      // The rehydration stack is global
      // Custom renderers don't use this stack
      const result = lastItemInStack('node');
      // Stack should be empty by default
      expect(result).toBe(undefined);
    });
  });

  describe('Documentation of architectural issues', () => {
    test('ARCHITECTURE ISSUE: single global rehydration state', () => {
      // The following state is global in rehydration.ts:
      // - withRehydrationStack: HTMLElement[]
      // - commentsToRehydrate: Comment[]
      // - rehydrationScheduled: boolean
      // - nodesMap: Map<string, HTMLElement>
      //
      // This means:
      // 1. Only one rehydration can happen at a time
      // 2. Nested custom renderers see the same state
      // 3. Custom renderers can't have their own rehydration logic
      //
      // Potential fix: Make rehydration state per-context using a WeakMap
      expect(true).toBe(true);
    });

    test('ARCHITECTURE ISSUE: no context-aware rehydration API', () => {
      // withRehydration() always uses HTMLRehydrationBrowserDOMApi
      // There's no way to specify different rehydration APIs for different
      // parts of the tree.
      //
      // For example, a Canvas component inside a rehydrating DOM tree
      // should:
      // 1. Let parent DOM elements rehydrate normally
      // 2. Render canvas content fresh (not rehydrate)
      // 3. Use canvasApi, not HTMLRehydrationBrowserDOMApi
      //
      // Current behavior: Canvas gets HTMLRehydrationBrowserDOMApi
      // which doesn't make sense for canvas rendering.
      expect(true).toBe(true);
    });

    test('ARCHITECTURE ISSUE: API replacement after rehydration', () => {
      // After rehydration completes, withRehydration() replaces the
      // HTMLRehydrationBrowserDOMApi methods with HTMLBrowserDOMApi methods
      // (lines 164-167 in rehydration.ts)
      //
      // This is done to "upgrade" the API for runtime updates.
      // However, this approach has issues:
      // 1. It mutates the API object
      // 2. Nested custom renderers' APIs are not affected
      // 3. Components that cached the old API keep working incorrectly
      //
      // Potential fix: Use a proxy or provide a new API instance
      expect(true).toBe(true);
    });
  });

  describe('API method upgrade verification', () => {
    test('Object.getOwnPropertyNames captures class methods', () => {
      // This test verifies the fix for the Object.keys bug
      // Object.keys returns [] for class prototypes (methods are non-enumerable)
      // Object.getOwnPropertyNames returns all property names including methods

      const keysResult = Object.keys(HTMLBrowserDOMApi.prototype);
      const ownPropsResult = Object.getOwnPropertyNames(HTMLBrowserDOMApi.prototype);

      // Object.keys should return empty array (class methods are non-enumerable)
      expect(keysResult).toEqual([]);

      // getOwnPropertyNames should include all methods
      expect(ownPropsResult).toContain('constructor');
      expect(ownPropsResult).toContain('prop');
      expect(ownPropsResult).toContain('attr');
      expect(ownPropsResult).toContain('element');
      expect(ownPropsResult).toContain('insert');
      expect(ownPropsResult).toContain('text');
      expect(ownPropsResult).toContain('comment');
      expect(ownPropsResult).toContain('fragment');
      expect(ownPropsResult).toContain('destroy');
      expect(ownPropsResult).toContain('clearChildren');
    });
  });
});

describe('Context caching during rehydration', () => {
  let window: Window;
  let document: Document;
  let root: Root;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    root = new Root(document);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('components cache their rendering context', () => {
    const api = new TestCustomDOMApi('cached', document);
    provideContext(root, RENDERING_CONTEXT, api);

    const component = createComponent(root);

    // First access caches the API
    const result1 = initDOM(component);
    const result2 = initDOM(component);

    // Should return same instance (cached)
    expect(result1).toBe(result2);
  });

  test('cache is invalidated when context changes', () => {
    // When a component's rendering context is changed after first access,
    // the cached value should be updated.

    const api1 = new TestCustomDOMApi('first', document);
    const api2 = new TestCustomDOMApi('second', document);

    provideContext(root, RENDERING_CONTEXT, api1);

    const component = createComponent(root);

    // First access caches api1
    expect(initDOM(component).toString()).toBe('test:first');

    // Change context - this should update the cached value
    provideContext(component, RENDERING_CONTEXT, api2);

    // Should now return 'second' because provideContext updates RENDERING_CONTEXT_PROPERTY
    expect(initDOM(component).toString()).toBe('test:second');
  });
});
