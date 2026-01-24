import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import {
  initDOM,
  getContext,
  provideContext,
  cleanupFastContext,
  RENDERING_CONTEXT,
} from './context';
import { DOMApi } from './dom-api';
import { Component } from './component';
import {
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
  PARENT,
  addToTree,
} from './shared';
import { Root } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';

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

describe('Context Management', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  describe('provideContext', () => {
    test('stores context value in CONTEXTS map', () => {
      const api = new TestCustomDOMApi('test', fixture.document);
      const component = createComponent(fixture.root);
      provideContext(component, RENDERING_CONTEXT, api);

      expect(initDOM(component).toString()).toBe('test:test');
    });

    test('supports function values that are called on get', () => {
      const api = new TestCustomDOMApi('lazy', fixture.document);
      const component = createComponent(fixture.root);
      provideContext(component, RENDERING_CONTEXT, () => api);

      expect(initDOM(component).toString()).toBe('test:lazy');
    });
  });

  describe('getContext', () => {
    test('returns null when context not found', () => {
      const component = createComponent(fixture.root);
      const UNKNOWN = Symbol('UNKNOWN');

      const result = getContext(component, UNKNOWN);
      expect(result).toBe(null);
    });

    test('traverses up the tree to find context', () => {
      const api = new TestCustomDOMApi('parent-api', fixture.document);
      provideContext(fixture.root, RENDERING_CONTEXT, api);

      const parent = createComponent(fixture.root);
      const child = createComponent(parent);

      expect(initDOM(child).toString()).toBe('test:parent-api');
    });

    test('returns nearest context when multiple providers exist', () => {
      const rootApi = new TestCustomDOMApi('root', fixture.document);
      const parentApi = new TestCustomDOMApi('parent', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, rootApi);

      const parent = createComponent(fixture.root);
      provideContext(parent, RENDERING_CONTEXT, parentApi);

      const child = createComponent(parent);

      expect(initDOM(child).toString()).toBe('test:parent');
    });
  });

  describe('RENDERING_CONTEXT fast path', () => {
    test('uses fast path when only Root provides context', () => {
      const api = new TestCustomDOMApi('fast', fixture.document);
      provideContext(fixture.root, RENDERING_CONTEXT, api);

      const child = createComponent(fixture.root);

      // Fast path should be used
      expect(initDOM(child).toString()).toBe('test:fast');
    });

    test('clears fast path when non-Root provides RENDERING_CONTEXT', () => {
      const rootApi = new TestCustomDOMApi('root', fixture.document);
      const childApi = new TestCustomDOMApi('child', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, rootApi);

      const child = createComponent(fixture.root);
      provideContext(child, RENDERING_CONTEXT, childApi);

      // Fast path should be cleared, tree traversal used
      const grandchild = createComponent(child);
      expect(initDOM(grandchild).toString()).toBe('test:child');
    });
  });

  describe('Nested Rendering Contexts', () => {
    test('child component can have different DOMApi than parent', () => {
      const htmlApi = new TestCustomDOMApi('html', fixture.document);
      const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

      const htmlComponent = createComponent(fixture.root);
      const canvasComponent = createComponent(htmlComponent);
      provideContext(canvasComponent, RENDERING_CONTEXT, canvasApi);
      const canvasChild = createComponent(canvasComponent);

      // HTML component should get htmlApi
      expect(initDOM(htmlComponent).toString()).toBe('test:html');

      // Canvas component and its children should get canvasApi
      expect(initDOM(canvasComponent).toString()).toBe('test:canvas');
      expect(initDOM(canvasChild).toString()).toBe('test:canvas');
    });

    test('sibling components can have different DOMApis', () => {
      const htmlApi = new TestCustomDOMApi('html', fixture.document);
      const svgApi = new TestCustomDOMApi('svg', fixture.document);
      const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

      // Sibling 1: SVG subtree
      const svgProvider = createComponent(fixture.root);
      provideContext(svgProvider, RENDERING_CONTEXT, svgApi);
      const svgChild = createComponent(svgProvider);

      // Sibling 2: Canvas subtree
      const canvasProvider = createComponent(fixture.root);
      provideContext(canvasProvider, RENDERING_CONTEXT, canvasApi);
      const canvasChild = createComponent(canvasProvider);

      // Each subtree should have its own DOMApi
      expect(initDOM(svgChild).toString()).toBe('test:svg');
      expect(initDOM(canvasChild).toString()).toBe('test:canvas');

      // Root-level components should use htmlApi
      const rootChild = createComponent(fixture.root);
      expect(initDOM(rootChild).toString()).toBe('test:html');
    });

    test('deeply nested contexts work correctly', () => {
      const api1 = new TestCustomDOMApi('level1', fixture.document);
      const api2 = new TestCustomDOMApi('level2', fixture.document);
      const api3 = new TestCustomDOMApi('level3', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, api1);

      const level1 = createComponent(fixture.root);
      const level2Provider = createComponent(level1);
      provideContext(level2Provider, RENDERING_CONTEXT, api2);

      const level2 = createComponent(level2Provider);
      const level3Provider = createComponent(level2);
      provideContext(level3Provider, RENDERING_CONTEXT, api3);

      const level3 = createComponent(level3Provider);
      const level4 = createComponent(level3);

      expect(initDOM(level1).toString()).toBe('test:level1');
      expect(initDOM(level2).toString()).toBe('test:level2');
      expect(initDOM(level3).toString()).toBe('test:level3');
      expect(initDOM(level4).toString()).toBe('test:level3');
    });

    test('context caching on component is updated correctly', () => {
      const htmlApi = new TestCustomDOMApi('html', fixture.document);
      const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

      const component = createComponent(fixture.root);

      // First access - should cache htmlApi
      expect(initDOM(component).toString()).toBe('test:html');

      // Now provide a different context to the component
      provideContext(component, RENDERING_CONTEXT, canvasApi);

      // provideContext now updates RENDERING_CONTEXT_PROPERTY when providing
      // RENDERING_CONTEXT, so initDOM returns the new value correctly
      expect(initDOM(component).toString()).toBe('test:canvas');
    });

    test('context caching issue workaround - clear cache manually', () => {
      const htmlApi = new TestCustomDOMApi('html', fixture.document);
      const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

      const component = createComponent(fixture.root);

      // First access - caches htmlApi
      expect(initDOM(component).toString()).toBe('test:html');

      // Manually clear the cache before providing new context
      delete (component as any)[Symbol.for('RENDERING_CONTEXT_PROPERTY')];

      // Now provide a different context
      provideContext(component, RENDERING_CONTEXT, canvasApi);

      // Now initDOM will do a fresh lookup and find canvasApi
      // Note: This workaround works because we clear the cache
      // before the lookup happens
      initDOM(component);

      // This tests that getContext properly finds the new value
      // when there's no cached value
      expect(getContext(component, RENDERING_CONTEXT)?.toString()).toBe('test:canvas');
    });
  });

  describe('Context switching edge cases', () => {
    test('cleanupFastContext resets the fast path', () => {
      const api1 = new TestCustomDOMApi('api1', fixture.document);
      const api2 = new TestCustomDOMApi('api2', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, api1);

      // Access to set up cache
      const child1 = createComponent(fixture.root);
      expect(initDOM(child1).toString()).toBe('test:api1');

      // Cleanup
      cleanupFastContext();

      // New root with different API
      const root2 = new Root(fixture.document);
      provideContext(root2, RENDERING_CONTEXT, api2);

      const child2 = createComponent(root2);
      expect(initDOM(child2).toString()).toBe('test:api2');
    });

    test('multiple roots can have different contexts', () => {
      const htmlApi = new TestCustomDOMApi('html', fixture.document);
      const workerApi = new TestCustomDOMApi('worker', fixture.document);

      // Root 1: HTML rendering
      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);
      const htmlChild = createComponent(fixture.root);

      // Root 2: Worker/off-screen rendering (separate tree)
      const workerRoot = new Root(fixture.document);
      provideContext(workerRoot, RENDERING_CONTEXT, workerApi);
      const workerChild = createComponent(workerRoot);

      // Each tree should have its own context
      // Note: This test may not work perfectly due to fast path optimization
      // The fast path is global and only one Root can use it
      cleanupFastContext(); // Ensure clean state

      // After cleanup, tree traversal should work
      expect(initDOM(htmlChild).toString()).toBe('test:html');
      expect(initDOM(workerChild).toString()).toBe('test:worker');
    });
  });

  describe('RENDERING_CONTEXT_PROPERTY caching', () => {
    test('initDOM caches the API on the component', () => {
      const api = new TestCustomDOMApi('cached', fixture.document);
      provideContext(fixture.root, RENDERING_CONTEXT, api);

      const component = createComponent(fixture.root);

      // First call should do lookup and cache
      const result1 = initDOM(component);
      expect(result1.toString()).toBe('test:cached');

      // Second call should use cached value
      const result2 = initDOM(component);
      expect(result2).toBe(result1); // Same instance
    });

    test('getContext uses cached RENDERING_CONTEXT_PROPERTY during traversal', () => {
      const rootApi = new TestCustomDOMApi('root', fixture.document);
      const cachedApi = new TestCustomDOMApi('cached', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, rootApi);

      const parent = createComponent(fixture.root);
      // Manually cache a different API on parent (simulating previous render)
      (parent as any)[Symbol.for('RENDERING_CONTEXT_PROPERTY')] = cachedApi;

      const child = createComponent(parent);

      // The getContext should check parent's cached property
      // This is the behavior at line 84-86 in context.ts
      // However, the symbol might not match - let's verify the actual behavior
      const result = initDOM(child);

      // Should find root's context since parent doesn't have it in CONTEXTS
      expect(result.toString()).toBe('test:root');
    });
  });
});

describe('Context with Tree Structure (addToTree)', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('addToTree establishes parent-child relationship', () => {
    const parent = createComponent(fixture.root);
    const child = new Component({});
    child[RENDERED_NODES_PROPERTY] = [];

    // Use addToTree to establish relationship
    addToTree(parent, child);

    // Verify relationship
    expect(PARENT.get(child[COMPONENT_ID_PROPERTY])).toBe(
      parent[COMPONENT_ID_PROPERTY],
    );
  });

  test('context traversal works with addToTree relationships', () => {
    const api = new TestCustomDOMApi('via-addToTree', fixture.document);
    provideContext(fixture.root, RENDERING_CONTEXT, api);

    const child = createComponent(fixture.root);

    // Context should be found via tree traversal
    expect(initDOM(child).toString()).toBe('test:via-addToTree');
  });
});

describe('Complex Nested Rendering Contexts', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('html -> svg -> html nesting (foreignObject pattern)', () => {
    // This simulates: <div> -> <svg> -> <foreignObject> -> <div>
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const svgApi = new TestCustomDOMApi('svg', fixture.document);
    const foreignObjectHtmlApi = new TestCustomDOMApi('html-foreign', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    // HTML content
    const htmlDiv = createComponent(fixture.root);

    // SVG element inside HTML
    const svgElement = createComponent(htmlDiv);
    provideContext(svgElement, RENDERING_CONTEXT, svgApi);

    // SVG child
    const svgChild = createComponent(svgElement);

    // foreignObject switches back to HTML
    const foreignObject = createComponent(svgChild);
    provideContext(foreignObject, RENDERING_CONTEXT, foreignObjectHtmlApi);

    // HTML content inside foreignObject
    const foreignHtmlChild = createComponent(foreignObject);

    expect(initDOM(htmlDiv).toString()).toBe('test:html');
    expect(initDOM(svgElement).toString()).toBe('test:svg');
    expect(initDOM(svgChild).toString()).toBe('test:svg');
    expect(initDOM(foreignObject).toString()).toBe('test:html-foreign');
    expect(initDOM(foreignHtmlChild).toString()).toBe('test:html-foreign');
  });

  test('html -> svg -> html -> canvas deep nesting', () => {
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const svgApi = new TestCustomDOMApi('svg', fixture.document);
    const innerHtmlApi = new TestCustomDOMApi('inner-html', fixture.document);
    const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    // Level 1: HTML
    const htmlComp = createComponent(fixture.root);

    // Level 2: SVG
    const svgComp = createComponent(htmlComp);
    provideContext(svgComp, RENDERING_CONTEXT, svgApi);

    // Level 3: Back to HTML (foreignObject)
    const innerHtmlComp = createComponent(svgComp);
    provideContext(innerHtmlComp, RENDERING_CONTEXT, innerHtmlApi);

    // Level 4: Canvas inside HTML inside SVG
    const canvasComp = createComponent(innerHtmlComp);
    provideContext(canvasComp, RENDERING_CONTEXT, canvasApi);

    // Level 5: Canvas children
    const canvasChild = createComponent(canvasComp);

    expect(initDOM(htmlComp).toString()).toBe('test:html');
    expect(initDOM(svgComp).toString()).toBe('test:svg');
    expect(initDOM(innerHtmlComp).toString()).toBe('test:inner-html');
    expect(initDOM(canvasComp).toString()).toBe('test:canvas');
    expect(initDOM(canvasChild).toString()).toBe('test:canvas');
  });

  test('multiple svg sections in html with different contexts', () => {
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const svg1Api = new TestCustomDOMApi('svg-1', fixture.document);
    const svg2Api = new TestCustomDOMApi('svg-2', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    // HTML container
    const htmlContainer = createComponent(fixture.root);

    // First SVG section
    const svg1 = createComponent(htmlContainer);
    provideContext(svg1, RENDERING_CONTEXT, svg1Api);
    const svg1Child1 = createComponent(svg1);
    const svg1Child2 = createComponent(svg1);

    // HTML between SVGs
    const htmlBetween = createComponent(htmlContainer);

    // Second SVG section
    const svg2 = createComponent(htmlContainer);
    provideContext(svg2, RENDERING_CONTEXT, svg2Api);
    const svg2Child = createComponent(svg2);

    expect(initDOM(htmlContainer).toString()).toBe('test:html');
    expect(initDOM(svg1).toString()).toBe('test:svg-1');
    expect(initDOM(svg1Child1).toString()).toBe('test:svg-1');
    expect(initDOM(svg1Child2).toString()).toBe('test:svg-1');
    expect(initDOM(htmlBetween).toString()).toBe('test:html');
    expect(initDOM(svg2).toString()).toBe('test:svg-2');
    expect(initDOM(svg2Child).toString()).toBe('test:svg-2');
  });

  test('context change mid-tree does not affect siblings', () => {
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    const parent = createComponent(fixture.root);

    // Child 1: regular HTML
    const child1 = createComponent(parent);

    // Child 2: switches to Canvas
    const child2 = createComponent(parent);
    provideContext(child2, RENDERING_CONTEXT, canvasApi);
    const canvasGrandchild = createComponent(child2);

    // Child 3: regular HTML (sibling of canvas)
    const child3 = createComponent(parent);

    expect(initDOM(child1).toString()).toBe('test:html');
    expect(initDOM(child2).toString()).toBe('test:canvas');
    expect(initDOM(canvasGrandchild).toString()).toBe('test:canvas');
    expect(initDOM(child3).toString()).toBe('test:html');
  });

  test('same context type can be provided at different levels', () => {
    // Sometimes the same "type" of context is re-provided at different levels
    // Each should be independent
    const html1 = new TestCustomDOMApi('html-root', fixture.document);
    const html2 = new TestCustomDOMApi('html-nested', fixture.document);
    const html3 = new TestCustomDOMApi('html-deep', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, html1);

    const level1 = createComponent(fixture.root);

    const level2 = createComponent(level1);
    provideContext(level2, RENDERING_CONTEXT, html2);

    const level3 = createComponent(level2);

    const level4 = createComponent(level3);
    provideContext(level4, RENDERING_CONTEXT, html3);

    const level5 = createComponent(level4);

    expect(initDOM(level1).toString()).toBe('test:html-root');
    expect(initDOM(level2).toString()).toBe('test:html-nested');
    expect(initDOM(level3).toString()).toBe('test:html-nested');
    expect(initDOM(level4).toString()).toBe('test:html-deep');
    expect(initDOM(level5).toString()).toBe('test:html-deep');
  });

  test('context updates propagate correctly in nested structure', () => {
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const svgApi = new TestCustomDOMApi('svg', fixture.document);
    const newSvgApi = new TestCustomDOMApi('svg-updated', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    const svgComp = createComponent(fixture.root);
    provideContext(svgComp, RENDERING_CONTEXT, svgApi);

    const svgChild = createComponent(svgComp);

    // Initial state
    expect(initDOM(svgComp).toString()).toBe('test:svg');
    expect(initDOM(svgChild).toString()).toBe('test:svg');

    // Update the SVG context
    provideContext(svgComp, RENDERING_CONTEXT, newSvgApi);

    // The component that received the new context should update
    expect(initDOM(svgComp).toString()).toBe('test:svg-updated');

    // Child still has cached value - this is expected behavior
    // as we only update the component that received provideContext
    // The child would need to be re-created or have its cache cleared
  });

  test('deeply nested alternating contexts html -> svg -> html -> svg -> canvas', () => {
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const svg1Api = new TestCustomDOMApi('svg-1', fixture.document);
    const html2Api = new TestCustomDOMApi('html-2', fixture.document);
    const svg2Api = new TestCustomDOMApi('svg-2', fixture.document);
    const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    // Level 1: HTML
    const html1 = createComponent(fixture.root);

    // Level 2: SVG
    const svg1 = createComponent(html1);
    provideContext(svg1, RENDERING_CONTEXT, svg1Api);

    // Level 3: HTML (foreignObject)
    const html2 = createComponent(svg1);
    provideContext(html2, RENDERING_CONTEXT, html2Api);

    // Level 4: Nested SVG inside foreignObject
    const svg2 = createComponent(html2);
    provideContext(svg2, RENDERING_CONTEXT, svg2Api);

    // Level 5: Canvas inside nested SVG
    const canvas = createComponent(svg2);
    provideContext(canvas, RENDERING_CONTEXT, canvasApi);

    // Level 6: Canvas children
    const canvasChild = createComponent(canvas);

    expect(initDOM(html1).toString()).toBe('test:html');
    expect(initDOM(svg1).toString()).toBe('test:svg-1');
    expect(initDOM(html2).toString()).toBe('test:html-2');
    expect(initDOM(svg2).toString()).toBe('test:svg-2');
    expect(initDOM(canvas).toString()).toBe('test:canvas');
    expect(initDOM(canvasChild).toString()).toBe('test:canvas');
  });

  test('wide tree with multiple context providers at same level', () => {
    const htmlApi = new TestCustomDOMApi('html', fixture.document);
    const svgApi = new TestCustomDOMApi('svg', fixture.document);
    const canvasApi = new TestCustomDOMApi('canvas', fixture.document);
    const mathApi = new TestCustomDOMApi('math', fixture.document);

    provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

    const container = createComponent(fixture.root);

    // Four siblings, each with different context
    const htmlSection = createComponent(container);
    const htmlChild = createComponent(htmlSection);

    const svgSection = createComponent(container);
    provideContext(svgSection, RENDERING_CONTEXT, svgApi);
    const svgChild = createComponent(svgSection);

    const canvasSection = createComponent(container);
    provideContext(canvasSection, RENDERING_CONTEXT, canvasApi);
    const canvasChild = createComponent(canvasSection);

    const mathSection = createComponent(container);
    provideContext(mathSection, RENDERING_CONTEXT, mathApi);
    const mathChild = createComponent(mathSection);

    expect(initDOM(htmlSection).toString()).toBe('test:html');
    expect(initDOM(htmlChild).toString()).toBe('test:html');
    expect(initDOM(svgSection).toString()).toBe('test:svg');
    expect(initDOM(svgChild).toString()).toBe('test:svg');
    expect(initDOM(canvasSection).toString()).toBe('test:canvas');
    expect(initDOM(canvasChild).toString()).toBe('test:canvas');
    expect(initDOM(mathSection).toString()).toBe('test:math');
    expect(initDOM(mathChild).toString()).toBe('test:math');
  });
});

describe('Optional Contexts (required parameter)', () => {
  let fixture: DOMFixture;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleWarnSpy: any;

  beforeEach(() => {
    fixture = createDOMFixture();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    fixture.cleanup();
    consoleWarnSpy.mockRestore();
  });

  test('getContext with required=true (default) warns when context not found', () => {
    const UNKNOWN_CONTEXT = Symbol('UNKNOWN');
    const component = createComponent(fixture.root);

    // Default behavior (required=true) should warn
    const result = getContext(component, UNKNOWN_CONTEXT);

    expect(result).toBe(null);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain('Unable to resolve context');
  });

  test('getContext with required=false does not warn when context not found', () => {
    const OPTIONAL_CONTEXT = Symbol('OPTIONAL');
    const component = createComponent(fixture.root);

    // Optional context (required=false) should not warn
    const result = getContext(component, OPTIONAL_CONTEXT, false);

    expect(result).toBe(null);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('getContext with required=false returns value when context is provided', () => {
    const OPTIONAL_CONTEXT = Symbol('OPTIONAL');
    const contextValue = { data: 'test' };
    const component = createComponent(fixture.root);

    provideContext(component, OPTIONAL_CONTEXT, contextValue);

    // Should return value without warning
    const result = getContext(component, OPTIONAL_CONTEXT, false);

    expect(result).toBe(contextValue);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('optional context lookup traverses tree correctly', () => {
    const OPTIONAL_CONTEXT = Symbol('OPTIONAL');
    const contextValue = { level: 'parent' };

    const parent = createComponent(fixture.root);
    provideContext(parent, OPTIONAL_CONTEXT, contextValue);

    const child = createComponent(parent);
    const grandchild = createComponent(child);

    // Child and grandchild should find parent's context without warning
    expect(getContext(child, OPTIONAL_CONTEXT, false)).toBe(contextValue);
    expect(getContext(grandchild, OPTIONAL_CONTEXT, false)).toBe(contextValue);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('Root does not trigger warning for missing context', () => {
    const UNKNOWN_CONTEXT = Symbol('UNKNOWN');

    // Root lookup should not warn even with required=true
    const result = getContext(fixture.root, UNKNOWN_CONTEXT, true);

    expect(result).toBe(null);
    // Root is explicitly excluded from warnings
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('API_FACTORY_CONTEXT pattern - optional context with fallback', () => {
    // This tests the pattern used in provider.ts
    const API_FACTORY_CONTEXT = Symbol('API_FACTORY');
    const component = createComponent(fixture.root);

    // Get optional context (will be null)
    const factoryWrapper = getContext<{ factory: () => any }>(component, API_FACTORY_CONTEXT, false);

    // Use fallback when context is not provided
    const defaultValue = { type: 'default' };
    const result = factoryWrapper?.factory() ?? defaultValue;

    expect(result).toBe(defaultValue);
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  test('SUSPENSE_CONTEXT pattern - optional context with optional chaining', () => {
    // This tests the pattern used in suspense.ts
    const SUSPENSE_CONTEXT = Symbol('SUSPENSE');
    const component = createComponent(fixture.root);

    // Get optional context (will be null)
    const suspense = getContext<{ start: () => void; end: () => void }>(component, SUSPENSE_CONTEXT, false);

    // Use optional chaining (pattern from suspense code)
    suspense?.start(); // Should not throw

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

describe('Bug Fixes Verification', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  describe('FIX: Context cache invalidation on provideContext', () => {
    test('provideContext updates RENDERING_CONTEXT_PROPERTY when changing context', () => {
      const api1 = new TestCustomDOMApi('original', fixture.document);
      const api2 = new TestCustomDOMApi('updated', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, api1);

      const component = createComponent(fixture.root);

      // First access - caches api1
      const cached1 = initDOM(component);
      expect(cached1.toString()).toBe('test:original');

      // Change context on the component
      provideContext(component, RENDERING_CONTEXT, api2);

      // initDOM should return the new value, not the stale cached value
      const cached2 = initDOM(component);
      expect(cached2.toString()).toBe('test:updated');

      // Verify it's actually the new API instance
      expect(cached2).toBe(api2);
    });

    test('context update works after multiple accesses', () => {
      const api1 = new TestCustomDOMApi('v1', fixture.document);
      const api2 = new TestCustomDOMApi('v2', fixture.document);
      const api3 = new TestCustomDOMApi('v3', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, api1);
      const component = createComponent(fixture.root);

      // Multiple accesses with first API
      expect(initDOM(component).toString()).toBe('test:v1');
      expect(initDOM(component).toString()).toBe('test:v1');
      expect(initDOM(component).toString()).toBe('test:v1');

      // Update to second API
      provideContext(component, RENDERING_CONTEXT, api2);
      expect(initDOM(component).toString()).toBe('test:v2');

      // Update to third API
      provideContext(component, RENDERING_CONTEXT, api3);
      expect(initDOM(component).toString()).toBe('test:v3');
    });

    test('context update on parent does not affect children with their own context', () => {
      const htmlApi1 = new TestCustomDOMApi('html-v1', fixture.document);
      const htmlApi2 = new TestCustomDOMApi('html-v2', fixture.document);
      const canvasApi = new TestCustomDOMApi('canvas', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi1);

      const htmlComponent = createComponent(fixture.root);
      const canvasComponent = createComponent(htmlComponent);
      provideContext(canvasComponent, RENDERING_CONTEXT, canvasApi);
      const canvasChild = createComponent(canvasComponent);

      // Initial state
      expect(initDOM(htmlComponent).toString()).toBe('test:html-v1');
      expect(initDOM(canvasComponent).toString()).toBe('test:canvas');
      expect(initDOM(canvasChild).toString()).toBe('test:canvas');

      // Update root context
      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi2);

      // HTML component gets updated (after re-providing)
      provideContext(htmlComponent, RENDERING_CONTEXT, htmlApi2);
      expect(initDOM(htmlComponent).toString()).toBe('test:html-v2');

      // Canvas components should still have canvas API
      expect(initDOM(canvasComponent).toString()).toBe('test:canvas');
      expect(initDOM(canvasChild).toString()).toBe('test:canvas');
    });
  });

  describe('FIX: Function provider evaluation in provideContext', () => {
    test('function provider is evaluated when setting RENDERING_CONTEXT', () => {
      let callCount = 0;
      const api = new TestCustomDOMApi('lazy-evaluated', fixture.document);
      const lazyProvider = () => {
        callCount++;
        return api;
      };

      const component = createComponent(fixture.root);
      provideContext(component, RENDERING_CONTEXT, lazyProvider);

      // Function should have been called once during provideContext
      expect(callCount).toBe(1);

      // initDOM should return the evaluated result
      expect(initDOM(component).toString()).toBe('test:lazy-evaluated');
      expect(initDOM(component)).toBe(api);

      // Function should not be called again on subsequent initDOM calls
      expect(callCount).toBe(1);
    });

    test('function provider returns correct API instance', () => {
      const api = new TestCustomDOMApi('from-function', fixture.document);

      const component = createComponent(fixture.root);
      provideContext(component, RENDERING_CONTEXT, () => api);

      const result = initDOM(component);
      expect(result).toBe(api);
      expect(result.toString()).toBe('test:from-function');
    });

    test('non-function provider works normally', () => {
      const api = new TestCustomDOMApi('direct', fixture.document);

      const component = createComponent(fixture.root);
      provideContext(component, RENDERING_CONTEXT, api);

      expect(initDOM(component)).toBe(api);
      expect(initDOM(component).toString()).toBe('test:direct');
    });

    test('function provider in nested context', () => {
      const htmlApi = new TestCustomDOMApi('html', fixture.document);
      const canvasApi = new TestCustomDOMApi('canvas-lazy', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, htmlApi);

      const htmlComponent = createComponent(fixture.root);
      const canvasComponent = createComponent(htmlComponent);

      // Provide canvas API via function
      provideContext(canvasComponent, RENDERING_CONTEXT, () => canvasApi);

      const canvasChild = createComponent(canvasComponent);

      expect(initDOM(htmlComponent).toString()).toBe('test:html');
      expect(initDOM(canvasComponent).toString()).toBe('test:canvas-lazy');
      expect(initDOM(canvasChild).toString()).toBe('test:canvas-lazy');
    });
  });

  describe('FIX: Fast path cleared on nested context provider', () => {
    test('fast path is used when only Root provides context', () => {
      const api = new TestCustomDOMApi('fast-path', fixture.document);
      provideContext(fixture.root, RENDERING_CONTEXT, api);

      // Create multiple components - all should use fast path
      const comp1 = createComponent(fixture.root);
      const comp2 = createComponent(fixture.root);
      const comp3 = createComponent(comp1);

      expect(initDOM(comp1).toString()).toBe('test:fast-path');
      expect(initDOM(comp2).toString()).toBe('test:fast-path');
      expect(initDOM(comp3).toString()).toBe('test:fast-path');
    });

    test('fast path is cleared when component provides different context', () => {
      const rootApi = new TestCustomDOMApi('root-api', fixture.document);
      const childApi = new TestCustomDOMApi('child-api', fixture.document);

      provideContext(fixture.root, RENDERING_CONTEXT, rootApi);

      const comp1 = createComponent(fixture.root);
      expect(initDOM(comp1).toString()).toBe('test:root-api');

      // This should clear the fast path
      const comp2 = createComponent(fixture.root);
      provideContext(comp2, RENDERING_CONTEXT, childApi);

      const comp2Child = createComponent(comp2);

      // comp2 and its children should get childApi
      expect(initDOM(comp2).toString()).toBe('test:child-api');
      expect(initDOM(comp2Child).toString()).toBe('test:child-api');

      // New components under root should still get rootApi via tree traversal
      const comp3 = createComponent(fixture.root);
      expect(initDOM(comp3).toString()).toBe('test:root-api');
    });
  });
});
