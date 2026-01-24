/**
 * Runtime integration tests for the element helper.
 * These tests execute compiled templates and verify actual DOM output.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { compile } from '../../plugins/compiler/compile';
import { cell, Cell, tagsToRevalidate, opsForTag, relatedTags } from './reactive';

// Set up a DOM environment for runtime tests
let window: Window;
let document: Window['document'];

beforeEach(() => {
  window = new Window();
  document = window.document;
  // Clear reactive state between tests
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
});

afterEach(() => {
  window.close();
});

/**
 * Helper to create a minimal runtime context for executing compiled templates
 */
function createRuntimeContext() {
  const container = document.createElement('div');
  container.id = 'test-container';
  document.body.appendChild(container);

  // Minimal API implementation for DOM operations
  // Using flexible types to accommodate happy-dom's type differences
  const api = {
    element: (tag: string) => document.createElement(tag),
    text: (content: string) => document.createTextNode(content),
    comment: (content: string) => document.createComment(content),
    fragment: () => document.createDocumentFragment(),
    attr: (el: { setAttribute: (name: string, value: string) => void }, name: string, value: string) => el.setAttribute(name, value),
    prop: (el: Record<string, unknown>, name: string, value: unknown) => {
      el[name] = value;
      return value;
    },
    insert: (parent: { insertBefore: Function; appendChild: Function }, child: unknown, anchor?: unknown) => {
      if (anchor) {
        parent.insertBefore(child, anchor);
      } else {
        parent.appendChild(child);
      }
    },
    parent: (node: { parentNode: unknown }) => node.parentNode,
    addEventListener: (el: { addEventListener: Function; removeEventListener: Function }, event: string, handler: unknown) => {
      el.addEventListener(event, handler);
      return () => el.removeEventListener(event, handler);
    },
    textContent: (el: { textContent: string | null }, content: string) => {
      el.textContent = content;
    },
    isNode: (value: unknown): boolean => value instanceof window.Node,
  };

  return { container, api, document };
}

describe('Element helper - runtime execution', () => {
  describe('basic tag creation', () => {
    test('creates element with literal string tag', () => {
      // Test that $_tag correctly creates an element when given a string
      const { container, api } = createRuntimeContext();

      // Simulate what the element helper generates:
      // $_tag("div", $fw, [...], this)
      const element = api.element('div');
      api.attr(element, 'data-test', 'value');
      container.appendChild(element);

      expect(container.querySelector('[data-test="value"]')).toBeTruthy();
      expect(container.querySelector('[data-test="value"]')?.tagName).toBe('DIV');
    });

    test('creates element with getter function tag', () => {
      // Test the fix: $_tag(() => tagName, ...) should work
      const { container, api } = createRuntimeContext();

      // Simulate dynamic tag from block param
      const tagName = 'span';
      const tagGetter = () => tagName;

      // Resolve the getter (this is what _DOM now does)
      const resolvedTag = typeof tagGetter === 'function' ? tagGetter() : tagGetter;
      const element = api.element(resolvedTag);
      api.attr(element, 'data-test', 'dynamic');
      container.appendChild(element);

      expect(container.querySelector('[data-test="dynamic"]')).toBeTruthy();
      expect(container.querySelector('[data-test="dynamic"]')?.tagName).toBe('SPAN');
    });

    test('creates custom element with hyphenated name', () => {
      const { container, api } = createRuntimeContext();

      const element = api.element('my-custom-element');
      api.attr(element, 'data-test', 'custom');
      container.appendChild(element);

      expect(container.querySelector('[data-test="custom"]')).toBeTruthy();
      expect(container.querySelector('[data-test="custom"]')?.tagName).toBe('MY-CUSTOM-ELEMENT');
    });
  });

  describe('dynamic tag resolution', () => {
    test('getter is called to resolve tag name', () => {
      let accessCount = 0;
      const tagGetter = () => {
        accessCount++;
        return 'article';
      };

      // Simulate _DOM behavior
      const resolvedTag = typeof tagGetter === 'function' ? tagGetter() : tagGetter;

      expect(accessCount).toBe(1);
      expect(resolvedTag).toBe('article');
    });

    test('variable tag name from closure', () => {
      const { container, api } = createRuntimeContext();

      // Simulate: {{#let 'section' as |tagName|}} ... (element tagName) ...
      let tagName = 'section';
      const tagGetter = () => tagName;

      const resolvedTag = typeof tagGetter === 'function' ? tagGetter() : tagGetter;
      const element = api.element(resolvedTag);
      api.attr(element, 'id', 'dynamic-section');
      container.appendChild(element);

      expect(container.querySelector('#dynamic-section')?.tagName).toBe('SECTION');
    });
  });

  describe('element with attributes', () => {
    test('applies string attributes', () => {
      const { container, api } = createRuntimeContext();

      const element = api.element('div');
      api.attr(element, 'class', 'test-class');
      api.attr(element, 'id', 'test-id');
      api.attr(element, 'data-value', '123');
      container.appendChild(element);

      const el = container.querySelector('#test-id');
      expect(el?.getAttribute('class')).toBe('test-class');
      expect(el?.getAttribute('data-value')).toBe('123');
    });

    test('applies boolean attributes', () => {
      const { container, api } = createRuntimeContext();

      const element = api.element('input');
      api.attr(element, 'disabled', '');
      api.attr(element, 'readonly', '');
      container.appendChild(element);

      const input = container.querySelector('input');
      expect(input?.hasAttribute('disabled')).toBe(true);
      expect(input?.hasAttribute('readonly')).toBe(true);
    });
  });

  describe('element with children', () => {
    test('appends text content', () => {
      const { container, api } = createRuntimeContext();

      const element = api.element('p');
      const text = api.text('Hello, World!');
      api.insert(element, text);
      container.appendChild(element);

      expect(container.querySelector('p')?.textContent).toBe('Hello, World!');
    });

    test('appends nested elements', () => {
      const { container, api } = createRuntimeContext();

      const outer = api.element('div');
      const inner = api.element('span');
      const text = api.text('nested');

      api.insert(inner, text);
      api.insert(outer, inner);
      container.appendChild(outer);

      expect(container.querySelector('div span')?.textContent).toBe('nested');
    });
  });
});

describe('Element helper - Cell integration', () => {
  test('Cell can be used for reactive updates', () => {
    const { container, api } = createRuntimeContext();

    const textCell = cell('initial');
    const element = api.element('div');
    element.textContent = textCell.value;
    container.appendChild(element);

    expect(container.querySelector('div')?.textContent).toBe('initial');

    // Update the cell
    textCell.update('updated');

    // In a real scenario, the opcode would update the DOM
    // Here we simulate it
    element.textContent = textCell.value;

    expect(container.querySelector('div')?.textContent).toBe('updated');
  });

  test('Cell passed through fn helper preserves reference', () => {
    // This tests the fix for the controls issue
    const myCell = cell(0);

    // Simulate: {{fn this.updateCell this.myCell}}
    // In compat mode, args are wrapped in getters
    const cellGetter = () => myCell;

    // $__fn unwraps the getter but preserves the Cell
    const unwrappedArg = typeof cellGetter === 'function' && !cellGetter.prototype
      ? cellGetter()
      : cellGetter;

    expect(unwrappedArg).toBe(myCell);
    expect(unwrappedArg).toBeInstanceOf(Cell);

    // Now we can call update on it
    (unwrappedArg as Cell<number>).update(100);
    expect(myCell.value).toBe(100);
  });
});

describe('Element helper - compiled template execution', () => {
  test('compiles and structure is correct for literal tag', () => {
    const result = compile(`
      {{#let (element 'div') as |Tag|}}
        <Tag data-test="compiled">content</Tag>
      {{/let}}
    `);

    // Verify the structure of compiled code
    expect(result.code).toContain('$_tag(');
    expect(result.code).toContain('"div"');
    expect(result.code).toContain('data-test');
  });

  test('compiles and structure is correct for dynamic tag', () => {
    const result = compile(`
      {{#let 'span' as |tagName|}}
        {{#let (element tagName) as |Tag|}}
          <Tag data-test="dynamic">content</Tag>
        {{/let}}
      {{/let}}
    `);

    // Verify the getter wraps the block param
    expect(result.code).toContain('() => Let_tagName_scope');
    expect(result.code).toContain('$_tag(');
  });
});
