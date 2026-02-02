/**
 * Integration tests for build-time and runtime compiled components working together.
 * Tests args passing, slots, blocks, and reactivity.
 *
 * Note: These tests use the actual template compilation infrastructure.
 * - Runtime templates use compileTemplate() which returns executable functions
 * - The tests verify that the runtime compiler produces working templates
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { Component } from './component';
import { HTMLBrowserDOMApi, DOMApi } from './dom-api';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  $template,
} from './shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from './context';
import {
  Root,
  $_c,
  $_args,
  $_edp,
  $_fin,
} from './dom';
import { cell } from './reactive';
import { renderElement } from './render-core';
import {
  compileTemplate,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../plugins/runtime-compiler';

// Note: setupGlobalScope() is now called explicitly in beforeEach
// instead of relying on auto-setup on module import.

describe('Runtime Compiler Integration', () => {
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

    // Explicitly setup global scope for runtime-compiled templates
    // This was previously auto-setup on module import, but is now lazy/explicit
    setupGlobalScope();

    // Make GXT symbols available globally for runtime templates
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  describe('compileTemplate API', () => {
    test('compiles simple template and returns templateFn', () => {
      const result = compileTemplate('<div>Hello World</div>');

      expect(result.errors).toHaveLength(0);
      expect(typeof result.templateFn).toBe('function');
      expect(result.code).toContain('$_tag');
    });

    test('compiles template with mustache expression', () => {
      const result = compileTemplate('<div>{{this.name}}</div>');

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('this.name');
    });

    test('compiles template with @arg syntax', () => {
      const result = compileTemplate('<span>{{@value}}</span>', {
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.errors).toHaveLength(0);
      // The code should reference args
      expect(result.code).toContain('$args');
    });
  });

  describe('Runtime Component Rendering', () => {
    test('runtime-compiled static template renders correctly', () => {
      const result = compileTemplate('<div data-testid="static">Static Content</div>');
      expect(result.errors).toHaveLength(0);

      // Create a minimal component that uses the template
      class StaticComponent extends Component {
        constructor(args: any) {
          super(args);
          const fn = result.templateFn;
          (this as any)[$template] = function(this: StaticComponent) {
            return $_fin(fn.call(this), this);
          };
        }
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const args = $_args({}, false, $_edp as any);
      const instance = $_c(StaticComponent as any, args, parentComponent);

      renderElement(api, parentComponent, container, instance);

      expect(container.textContent).toContain('Static Content');
    });

    test('runtime-compiled component with this.property works', () => {
      const result = compileTemplate('<div>Name: {{this.myName}}</div>');
      expect(result.errors).toHaveLength(0);

      class PropertyComponent extends Component {
        myName = 'TestUser';
        constructor(args: any) {
          super(args);
          const fn = result.templateFn;
          (this as any)[$template] = function(this: PropertyComponent) {
            return $_fin(fn.call(this), this);
          };
        }
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const args = $_args({}, false, $_edp as any);
      const instance = $_c(PropertyComponent as any, args, parentComponent);

      renderElement(api, parentComponent, container, instance);

      expect(container.textContent).toContain('Name: TestUser');
    });

    // Skip: Runtime template rendering with complex context needs investigation
    test.skip('runtime-compiled component with reactive cell property', async () => {
      const result = compileTemplate('<div>Count: {{this.countValue}}</div>');
      expect(result.errors).toHaveLength(0);

      class ReactivePropertyComponent extends Component {
        countCell = cell(0);
        get countValue() {
          return this.countCell.value;
        }
        constructor(args: any) {
          super(args);
          const fn = result.templateFn;
          (this as any)[$template] = function(this: ReactivePropertyComponent) {
            return $_fin(fn.call(this), this);
          };
        }
      }

      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parentComponent);

      const args = $_args({}, false, $_edp as any);
      const instance = $_c(ReactivePropertyComponent as any, args, parentComponent) as ReactivePropertyComponent;

      renderElement(api, parentComponent, container, instance);

      expect(container.textContent).toContain('Count: 0');

      // Update the cell
      instance.countCell.update(42);

      // Wait for reactivity to propagate
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(container.textContent).toContain('Count: 42');
    });
  });

  describe('Template Compilation Flags', () => {
    test('IS_GLIMMER_COMPAT_MODE flag affects @arg compilation', () => {
      const compatResult = compileTemplate('<div>{{@name}}</div>', {
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(compatResult.errors).toHaveLength(0);
      // In compat mode, @name should be compiled with args reference
      expect(compatResult.code).toContain('$args');
    });

    test('WITH_MODIFIER_MANAGER flag enables modifier support', () => {
      const result = compileTemplate('<div {{myModifier}}></div>', {
        bindings: new Set(['myModifier']),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_maybeModifier');
    });
  });

  describe('Error Handling', () => {
    test('malformed template reports errors gracefully', () => {
      const result = compileTemplate('<div><span></div>');

      // Should have errors for mismatched tags
      expect(result.errors.length).toBeGreaterThan(0);

      // Should still return a function (graceful degradation)
      expect(typeof result.templateFn).toBe('function');
    });

    test('template with unknown binding compiles with $_maybeHelper', () => {
      const result = compileTemplate('<div>{{unknownThing}}</div>');

      expect(result.errors).toHaveLength(0);
      // Unknown bindings should use $_maybeHelper for runtime resolution
      expect(result.code).toContain('$_maybeHelper');
    });
  });

  describe('Template Code Generation', () => {
    test('generates correct structure for nested elements', () => {
      const result = compileTemplate(`
        <div class="outer">
          <span class="inner">
            Content
          </span>
        </div>
      `);

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_tag');
      expect(result.code).toContain('outer');
      expect(result.code).toContain('inner');
    });

    test('generates correct structure for conditional', () => {
      const result = compileTemplate(`
        {{#if this.show}}
          <div>Visible</div>
        {{/if}}
      `);

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_if');
    });

    test('generates correct structure for each loop', () => {
      const result = compileTemplate(`
        {{#each this.items as |item|}}
          <li>{{item}}</li>
        {{/each}}
      `);

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_each');
    });
  });
});
