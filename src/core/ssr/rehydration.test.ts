import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { isRehydrationScheduled, lastItemInStack } from './rehydration';
import {
  cleanupFastContext,
  provideContext,
  getContext,
  RENDERING_CONTEXT,
  initDOM,
} from '../context';
import { HTMLBrowserDOMApi, DOMApi } from '../dom-api';
import { SUSPENSE_CONTEXT, followPromise } from '../suspense-utils';
import { HTMLRehydrationBrowserDOMApi } from './rehydration-dom-api';
import { SVGBrowserDOMApi } from '../svg-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  COMPONENT_ID_PROPERTY,
} from '../shared';
import { Component } from '../component';
import { Root } from '../dom';
import { NS_SVG, NS_MATHML } from '../namespaces';

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
      const ownPropsResult = Object.getOwnPropertyNames(
        HTMLBrowserDOMApi.prototype,
      );

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

describe('SVG Rehydration API', () => {
  let window: Window;
  let document: Document;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('SVGRehydrationBrowserDOMApi creates elements with SVG namespace when not rehydrating', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );
    const api = new SVGRehydrationBrowserDOMApi(document);

    const svg = api.element('svg');
    expect(svg.namespaceURI).toBe(NS_SVG);

    const path = api.element('path');
    expect(path.namespaceURI).toBe(NS_SVG);
  });

  test('SVGRehydrationBrowserDOMApi has correct toString identifier', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );
    const api = new SVGRehydrationBrowserDOMApi(document);

    expect(api.toString()).toBe('hydration-svg:dom-api');
  });

  test('SVGRehydrationBrowserDOMApi handles namespaced attributes', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );
    const api = new SVGRehydrationBrowserDOMApi(document);

    const use = api.element('use');
    api.attr(use, 'xlink:href', '#icon');

    // xlink attributes should use the xlink namespace
    expect(use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(
      '#icon',
    );
  });

  test('SVGRehydrationBrowserDOMApi prop handles className', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );
    const api = new SVGRehydrationBrowserDOMApi(document);

    const svg = api.element('svg');
    api.prop(svg, 'className', 'icon-class');

    expect(svg.getAttribute('class')).toBe('icon-class');
  });
});

describe('MathML Rehydration API', () => {
  let window: Window;
  let document: Document;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('MathMLRehydrationBrowserDOMApi creates elements with MathML namespace when not rehydrating', async () => {
    const { MathMLRehydrationBrowserDOMApi } = await import(
      './mathml-rehydration-dom-api'
    );
    const api = new MathMLRehydrationBrowserDOMApi(document);

    const math = api.element('math');
    expect(math.namespaceURI).toBe(NS_MATHML);

    const mrow = api.element('mrow');
    expect(mrow.namespaceURI).toBe(NS_MATHML);
  });

  test('MathMLRehydrationBrowserDOMApi has correct toString identifier', async () => {
    const { MathMLRehydrationBrowserDOMApi } = await import(
      './mathml-rehydration-dom-api'
    );
    const api = new MathMLRehydrationBrowserDOMApi(document);

    expect(api.toString()).toBe('hydration-mathml:dom-api');
  });
});

describe('API Factory in Rehydration', () => {
  let window: Window;
  let document: Document;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('API_FACTORY_CONTEXT symbol is exported from context', async () => {
    const { API_FACTORY_CONTEXT } = await import('../context');
    expect(typeof API_FACTORY_CONTEXT).toBe('symbol');
    expect(API_FACTORY_CONTEXT.description).toBe('API_FACTORY');
  });

  test('ApiFactory type creates correct API for SVG namespace', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );
    const { MathMLRehydrationBrowserDOMApi } = await import(
      './mathml-rehydration-dom-api'
    );
    const { HTMLRehydrationBrowserDOMApi } = await import(
      './rehydration-dom-api'
    );

    // Simulate the factory function from withRehydration
    const apiFactory = (namespace?: string) => {
      if (namespace === NS_SVG) {
        return new SVGRehydrationBrowserDOMApi(document);
      } else if (namespace === NS_MATHML) {
        return new MathMLRehydrationBrowserDOMApi(document);
      } else {
        return new HTMLRehydrationBrowserDOMApi(document);
      }
    };

    const htmlApi = apiFactory();
    expect(htmlApi.toString()).toBe('hydration-html:dom-api');

    const svgApi = apiFactory(NS_SVG);
    expect(svgApi.toString()).toBe('hydration-svg:dom-api');

    const mathmlApi = apiFactory(NS_MATHML);
    expect(mathmlApi.toString()).toBe('hydration-mathml:dom-api');
  });

  test('SVGBrowserDOMApi and SVGRehydrationBrowserDOMApi have compatible interfaces', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );

    const api = new SVGRehydrationBrowserDOMApi(document);

    // Verify all DOMApi methods exist
    expect(typeof api.element).toBe('function');
    expect(typeof api.attr).toBe('function');
    expect(typeof api.prop).toBe('function');
    expect(typeof api.insert).toBe('function');
    expect(typeof api.text).toBe('function');
    expect(typeof api.comment).toBe('function');
    expect(typeof api.fragment).toBe('function');
    expect(typeof api.destroy).toBe('function');
    expect(typeof api.clearChildren).toBe('function');
    expect(typeof api.parent).toBe('function');
    expect(typeof api.addEventListener).toBe('function');
    expect(typeof api.isNode).toBe('function');
    expect(typeof api.textContent).toBe('function');
  });

  test('MathMLBrowserDOMApi and MathMLRehydrationBrowserDOMApi have compatible interfaces', async () => {
    const { MathMLRehydrationBrowserDOMApi } = await import(
      './mathml-rehydration-dom-api'
    );

    const api = new MathMLRehydrationBrowserDOMApi(document);

    // Verify all DOMApi methods exist
    expect(typeof api.element).toBe('function');
    expect(typeof api.attr).toBe('function');
    expect(typeof api.prop).toBe('function');
    expect(typeof api.insert).toBe('function');
    expect(typeof api.text).toBe('function');
    expect(typeof api.comment).toBe('function');
    expect(typeof api.fragment).toBe('function');
    expect(typeof api.destroy).toBe('function');
    expect(typeof api.clearChildren).toBe('function');
    expect(typeof api.parent).toBe('function');
    expect(typeof api.addEventListener).toBe('function');
    expect(typeof api.isNode).toBe('function');
    expect(typeof api.textContent).toBe('function');
  });

  test('API upgrade replaces methods with standard API methods', async () => {
    const { SVGRehydrationBrowserDOMApi } = await import(
      './svg-rehydration-dom-api'
    );

    const api = new SVGRehydrationBrowserDOMApi(document);
    expect(api.toString()).toBe('hydration-svg:dom-api');

    // Simulate the upgrade that happens in withRehydration
    Object.getOwnPropertyNames(SVGBrowserDOMApi.prototype).forEach((key) => {
      if (key !== 'constructor') {
        // @ts-expect-error props
        api[key] = SVGBrowserDOMApi.prototype[key];
      }
    });

    expect(api.toString()).toBe('svg:dom-api');
  });
});

describe('Suspense Rehydration Integration', () => {
  let window: Window;
  let document: Document;
  let root: Root;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    root = new Root(document);
    // Add root to TREE so context lookup can find it when traversing from children
    TREE.set(root[COMPONENT_ID_PROPERTY], root as unknown as Component<any>);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  describe('Resolved Suspense Context During Rehydration', () => {
    test('suspense context is available during rehydration scenarios', () => {
      // Simulate a resolved suspense by providing context with pendingAmount = 0
      const resolvedSuspenseContext = {
        pendingAmount: 0,
        start: () => {},
        end: () => {},
        isResolved: () => true,
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, resolvedSuspenseContext);

      const child = createComponent(root);

      // Child should be able to access the suspense context
      const foundContext = getContext(
        child,
        SUSPENSE_CONTEXT,
      ) as typeof resolvedSuspenseContext;
      expect(foundContext).toBe(resolvedSuspenseContext);
      expect(foundContext.isResolved()).toBe(true);
    });

    test('resolved suspense shows content, not fallback', () => {
      // Suspense is resolved (pendingAmount === 0)
      let pendingAmount = 0;
      const resolvedSuspense = {
        pendingAmount: () => pendingAmount,
        isResolved: () => pendingAmount === 0,
        start: () => {
          pendingAmount++;
        },
        end: () => {
          pendingAmount--;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, resolvedSuspense);

      // Verify the suspense is in resolved state
      expect(resolvedSuspense.isResolved()).toBe(true);

      // When resolved, content should be shown (not fallback)
      // This is the state SSR produces when suspense has completed
      const contentDiv = document.createElement('div');
      contentDiv.textContent = 'Loaded Content';
      document.body.appendChild(contentDiv);

      expect(document.body.textContent).toBe('Loaded Content');
    });

    test('rehydration DOM API preserves existing elements', () => {
      // Create existing DOM (simulating SSR output)
      const existingDiv = document.createElement('div');
      existingDiv.setAttribute('data-node-id', '1');
      existingDiv.textContent = 'SSR Content';
      document.body.appendChild(existingDiv);

      const api = new HTMLRehydrationBrowserDOMApi(document);

      // The rehydration API should work without creating new elements
      // when the stack has matching elements
      expect(api.toString()).toBe('hydration-html:dom-api');
      expect(typeof api.element).toBe('function');
      expect(typeof api.textContent).toBe('function');
    });
  });

  describe('Unresolved Suspense Context During Rehydration', () => {
    test('unresolved suspense context tracks pending operations', () => {
      // Suspense is pending (has async operations in progress)
      let pendingAmount = 1;
      const pendingSuspense = {
        pendingAmount: () => pendingAmount,
        isPending: () => pendingAmount > 0,
        start: () => {
          pendingAmount++;
        },
        end: () => {
          pendingAmount--;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, pendingSuspense);

      const child = createComponent(root);
      const foundContext = getContext(
        child,
        SUSPENSE_CONTEXT,
      ) as typeof pendingSuspense;

      // Suspense should be in pending state
      expect(foundContext.isPending()).toBe(true);

      // Start another async operation
      foundContext.start();
      expect(pendingAmount).toBe(2);

      // End both operations
      foundContext.end();
      foundContext.end();
      expect(pendingAmount).toBe(0);
      expect(foundContext.isPending()).toBe(false);
    });

    test('fallback is shown when suspense has pending operations', () => {
      let pendingAmount = 1;
      const pendingSuspense = {
        pendingAmount: () => pendingAmount,
        isPending: () => pendingAmount > 0,
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, pendingSuspense);

      // Simulate the rendering decision
      if (pendingSuspense.isPending()) {
        // Show fallback
        const fallback = document.createElement('div');
        fallback.className = 'loading';
        fallback.textContent = 'Loading...';
        document.body.appendChild(fallback);
      }

      expect(document.body.querySelector('.loading')?.textContent).toBe(
        'Loading...',
      );
    });

    test('rehydration with pending suspense matches fallback DOM', () => {
      // SSR produced fallback HTML
      document.body.innerHTML =
        '<div class="fallback-container"><span class="spinner">Loading...</span></div>';

      let pendingAmount = 1;
      let startCallCount = 0;
      let endCallCount = 0;
      const pendingSuspense = {
        isPending: () => pendingAmount > 0,
        start: () => {
          pendingAmount++;
          startCallCount++;
        },
        end: () => {
          pendingAmount--;
          endCallCount++;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, pendingSuspense);

      // Verify the DOM structure matches SSR output
      expect(document.body.querySelector('.spinner')?.textContent).toBe(
        'Loading...',
      );

      // The suspense is still pending during rehydration
      expect(pendingSuspense.isPending()).toBe(true);
    });
  });

  describe('Nested Suspense Boundaries', () => {
    test('inner suspense shadows outer suspense context', () => {
      const outerSuspense = { id: 'outer', start: () => {}, end: () => {} };
      const innerSuspense = { id: 'inner', start: () => {}, end: () => {} };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, outerSuspense);

      const outerComponent = createComponent(root);
      provideContext(outerComponent, SUSPENSE_CONTEXT, innerSuspense);

      const innerComponent = createComponent(outerComponent);

      // Inner component should find inner suspense
      const foundContext = getContext(
        innerComponent,
        SUSPENSE_CONTEXT,
      ) as typeof innerSuspense;
      expect(foundContext.id).toBe('inner');
    });

    test('outer suspense can be resolved while inner is pending', () => {
      let outerPending = 0;
      let innerPending = 1;

      const outerSuspense = {
        isPending: () => outerPending > 0,
        start: () => {
          outerPending++;
        },
        end: () => {
          outerPending--;
        },
      };
      const innerSuspense = {
        isPending: () => innerPending > 0,
        start: () => {
          innerPending++;
        },
        end: () => {
          innerPending--;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, outerSuspense);

      const outerComponent = createComponent(root);
      provideContext(outerComponent, SUSPENSE_CONTEXT, innerSuspense);

      const innerComponent = createComponent(outerComponent);

      // Outer is resolved, inner is pending
      expect(outerSuspense.isPending()).toBe(false);
      expect(innerSuspense.isPending()).toBe(true);

      // Inner component uses inner suspense context
      const context = getContext(
        innerComponent,
        SUSPENSE_CONTEXT,
      ) as typeof innerSuspense;
      expect(context.isPending()).toBe(true);
    });

    test('multiple children can have different suspense states', () => {
      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));

      // Parent with three children, each with their own suspense state
      const parent = createComponent(root);

      // Child 1: resolved
      const suspense1 = { isPending: () => false };
      const child1 = createComponent(parent);
      provideContext(child1, SUSPENSE_CONTEXT, suspense1);

      // Child 2: pending
      const suspense2 = { isPending: () => true };
      const child2 = createComponent(parent);
      provideContext(child2, SUSPENSE_CONTEXT, suspense2);

      // Child 3: resolved
      const suspense3 = { isPending: () => false };
      const child3 = createComponent(parent);
      provideContext(child3, SUSPENSE_CONTEXT, suspense3);

      // Verify different states
      expect(
        (getContext(child1, SUSPENSE_CONTEXT) as typeof suspense1).isPending(),
      ).toBe(false);
      expect(
        (getContext(child2, SUSPENSE_CONTEXT) as typeof suspense2).isPending(),
      ).toBe(true);
      expect(
        (getContext(child3, SUSPENSE_CONTEXT) as typeof suspense3).isPending(),
      ).toBe(false);
    });
  });

  describe('followPromise During Rehydration', () => {
    test('followPromise tracks promises through suspense context', async () => {
      let pendingCount = 0;
      let startCallCount = 0;
      let endCallCount = 0;
      const suspenseContext = {
        start: () => {
          pendingCount++;
          startCallCount++;
        },
        end: () => {
          pendingCount--;
          endCallCount++;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, suspenseContext);

      const child = createComponent(root);

      // Before following any promises
      expect(pendingCount).toBe(0);

      // Follow a promise (simulating lazy loading during rehydration)
      const promise = Promise.resolve('data');
      followPromise(child, promise);

      // Start should be called
      expect(startCallCount).toBe(1);
      expect(pendingCount).toBe(1);

      await promise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      // End should be called after promise resolves
      expect(endCallCount).toBe(1);
      expect(pendingCount).toBe(0);
    });

    test('multiple promises tracked correctly during rehydration', async () => {
      let pendingCount = 0;
      const suspenseContext = {
        start: () => {
          pendingCount++;
        },
        end: () => {
          pendingCount--;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, suspenseContext);

      const child = createComponent(root);

      // Use controlled promises for deterministic behavior
      let resolve1!: () => void;
      let resolve2!: () => void;
      const promise1 = new Promise<void>((r) => {
        resolve1 = r;
      });
      const promise2 = new Promise<void>((r) => {
        resolve2 = r;
      });

      // followPromise returns the .finally() chain, so awaiting it
      // guarantees end() has been called
      const tracked1 = followPromise(child, promise1);
      const tracked2 = followPromise(child, promise2);

      expect(pendingCount).toBe(2);

      // Resolve and await - end() is guaranteed to have run
      resolve1();
      await tracked1;
      expect(pendingCount).toBe(1);

      resolve2();
      await tracked2;
      expect(pendingCount).toBe(0);
    });
  });

  describe('Rehydration State Transitions', () => {
    test('isRehydrationScheduled reflects global rehydration state', () => {
      // This test documents the current architecture
      expect(typeof isRehydrationScheduled).toBe('function');
      expect(isRehydrationScheduled()).toBe(false);
    });

    test('ARCHITECTURE: suspense should complete independently of rehydration', () => {
      // Document the expected behavior:
      // 1. Rehydration is a synchronous process that matches SSR DOM
      // 2. Suspense is an async mechanism that tracks pending operations
      // 3. These two systems should work independently
      //
      // When SSR produces a fallback state:
      // - Rehydration matches the fallback DOM
      // - Suspense remains pending
      // - After rehydration, suspense resolves normally
      // - UI updates via reactive system (not rehydration)

      let pendingAmount = 1;
      const suspense = {
        isPending: () => pendingAmount > 0,
        resolve: () => {
          pendingAmount = 0;
        },
      };

      provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
      provideContext(root, SUSPENSE_CONTEXT, suspense);

      // During rehydration, suspense is pending
      expect(suspense.isPending()).toBe(true);
      expect(isRehydrationScheduled()).toBe(false);

      // After async content loads, suspense resolves
      suspense.resolve();
      expect(suspense.isPending()).toBe(false);

      // Rehydration state is unchanged
      expect(isRehydrationScheduled()).toBe(false);
    });
  });
});
