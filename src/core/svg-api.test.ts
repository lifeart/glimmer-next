import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { SVGBrowserDOMApi } from './svg-api';

describe('SVGBrowserDOMApi', () => {
  let window: Window;
  let document: Document;
  let api: SVGBrowserDOMApi;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new SVGBrowserDOMApi(document);
  });

  afterEach(() => {
    window.close();
  });

  describe('toString', () => {
    test('returns correct identifier', () => {
      expect(api.toString()).toBe('svg:dom-api');
    });
  });

  describe('isNode', () => {
    test('returns true for SVG elements', () => {
      const svg = api.element('svg');
      expect(api.isNode(svg)).toBe(true);
    });

    test('returns true for text nodes', () => {
      const text = api.text('hello');
      expect(api.isNode(text)).toBe(true);
    });
  });

  describe('element', () => {
    test('creates an SVG element with correct namespace', () => {
      const rect = api.element('rect');
      expect(rect.tagName.toLowerCase()).toBe('rect');
      expect(rect.namespaceURI).toBe('http://www.w3.org/2000/svg');
    });

    test('creates various SVG elements', () => {
      const circle = api.element('circle');
      const path = api.element('path');
      const g = api.element('g');
      expect(circle.tagName.toLowerCase()).toBe('circle');
      expect(path.tagName.toLowerCase()).toBe('path');
      expect(g.tagName.toLowerCase()).toBe('g');
    });
  });

  describe('text', () => {
    test('creates a text node', () => {
      const text = api.text('svg text');
      expect(text.textContent).toBe('svg text');
      expect(text.nodeType).toBe(3); // TEXT_NODE
    });
  });

  describe('textContent', () => {
    test('sets text content on SVG element', () => {
      const text = api.element('text');
      api.textContent(text, 'Hello SVG');
      expect(text.textContent).toBe('Hello SVG');
    });
  });

  describe('attr', () => {
    test('sets standard attributes', () => {
      const rect = api.element('rect');
      api.attr(rect, 'width', '100');
      api.attr(rect, 'height', '50');
      expect(rect.getAttribute('width')).toBe('100');
      expect(rect.getAttribute('height')).toBe('50');
    });

    test('sets namespaced xlink attributes', () => {
      const use = api.element('use');
      api.attr(use, 'xlink:href', '#icon');
      // Check that the attribute was set (happy-dom may store it differently)
      expect(
        use.getAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href') ||
        use.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        use.getAttribute('xlink:href')
      ).toBe('#icon');
    });

    test('sets namespaced xmlns attributes', () => {
      const svg = api.element('svg');
      api.attr(svg, 'xmlns:xlink', 'http://www.w3.org/1999/xlink');
      // Check that the attribute was set (happy-dom may store it differently)
      expect(
        svg.getAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:xlink') ||
        svg.getAttributeNS('http://www.w3.org/2000/xmlns/', 'xlink') ||
        svg.getAttribute('xmlns:xlink')
      ).toBe('http://www.w3.org/1999/xlink');
    });
  });

  describe('prop', () => {
    test('sets className via class attribute', () => {
      const rect = api.element('rect');
      api.prop(rect, 'className', 'my-class');
      expect(rect.getAttribute('class')).toBe('my-class');
    });

    test('sets other properties as attributes', () => {
      const rect = api.element('rect');
      api.prop(rect, 'id', 'my-id');
      expect(rect.getAttribute('id')).toBe('my-id');
    });
  });

  describe('insert', () => {
    test('inserts child into SVG parent', () => {
      const svg = api.element('svg');
      const rect = api.element('rect');
      api.insert(svg, rect);
      expect(svg.firstChild).toBe(rect);
    });

    test('appends to end of children', () => {
      const g = api.element('g');
      const rect1 = api.element('rect');
      const rect2 = api.element('rect');
      api.insert(g, rect1);
      api.insert(g, rect2);
      expect(g.children.length).toBe(2);
      expect(g.lastChild).toBe(rect2);
    });
  });

  describe('destroy', () => {
    test('removes connected SVG element', () => {
      const svg = api.element('svg');
      const rect = api.element('rect');
      svg.appendChild(rect);
      document.body.appendChild(svg);

      expect(rect.isConnected).toBe(true);
      api.destroy(rect);
      expect(svg.children.length).toBe(0);
    });

    test('does nothing for disconnected elements', () => {
      const orphan = api.element('rect');
      expect(orphan.isConnected).toBe(false);
      // Should not throw
      api.destroy(orphan);
    });
  });

  describe('clearChildren', () => {
    test('removes all children from SVG element', () => {
      const g = api.element('g');
      g.appendChild(api.element('rect'));
      g.appendChild(api.element('circle'));
      g.appendChild(api.element('path'));

      expect(g.childNodes.length).toBe(3);
      api.clearChildren(g);
      expect(g.childNodes.length).toBe(0);
    });

    test('works on empty SVG elements', () => {
      const g = api.element('g');
      api.clearChildren(g);
      expect(g.childNodes.length).toBe(0);
    });
  });

  describe('parent', () => {
    test('returns parent SVG element', () => {
      const svg = api.element('svg');
      const rect = api.element('rect');
      svg.appendChild(rect);
      expect(api.parent(rect)).toBe(svg);
    });

    test('returns null for orphan elements', () => {
      const orphan = api.element('rect');
      expect(api.parent(orphan)).toBe(null);
    });
  });

  describe('comment', () => {
    test('creates a comment node', () => {
      const comment = api.comment('SVG comment');
      expect(comment.nodeType).toBe(8); // COMMENT_NODE
    });

    test('creates empty comment by default', () => {
      const comment = api.comment();
      expect(comment.nodeType).toBe(8);
    });
  });

  describe('fragment', () => {
    test('creates a document fragment', () => {
      const fragment = api.fragment();
      expect(fragment.nodeType).toBe(11); // DOCUMENT_FRAGMENT_NODE
    });

    test('fragment can hold multiple SVG elements', () => {
      const fragment = api.fragment();
      fragment.appendChild(api.element('rect'));
      fragment.appendChild(api.element('circle'));
      expect(fragment.childNodes.length).toBe(2);
    });
  });
});
