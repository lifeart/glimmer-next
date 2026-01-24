import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { MathMLBrowserDOMApi } from './math-api';

describe('MathMLBrowserDOMApi', () => {
  let window: Window;
  let document: Document;
  let api: MathMLBrowserDOMApi;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new MathMLBrowserDOMApi(document);
  });

  afterEach(() => {
    window.close();
  });

  describe('toString', () => {
    test('returns correct identifier', () => {
      expect(api.toString()).toBe('mathml:dom-api');
    });
  });

  describe('isNode', () => {
    test('returns true for MathML elements', () => {
      const math = api.element('math');
      expect(api.isNode(math)).toBe(true);
    });

    test('returns true for text nodes', () => {
      const text = api.text('x');
      expect(api.isNode(text)).toBe(true);
    });
  });

  describe('element', () => {
    test('creates a MathML element with correct namespace', () => {
      const math = api.element('math');
      expect(math.tagName.toLowerCase()).toBe('math');
      expect(math.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML');
    });

    test('creates various MathML elements', () => {
      const mi = api.element('mi');
      const mn = api.element('mn');
      const mo = api.element('mo');
      const mrow = api.element('mrow');
      expect(mi.tagName.toLowerCase()).toBe('mi');
      expect(mn.tagName.toLowerCase()).toBe('mn');
      expect(mo.tagName.toLowerCase()).toBe('mo');
      expect(mrow.tagName.toLowerCase()).toBe('mrow');
    });
  });

  describe('text', () => {
    test('creates a text node', () => {
      const text = api.text('2');
      expect(text.textContent).toBe('2');
      expect(text.nodeType).toBe(3); // TEXT_NODE
    });
  });

  describe('textContent', () => {
    test('sets text content on MathML element', () => {
      const mi = api.element('mi');
      api.textContent(mi, 'x');
      expect(mi.textContent).toBe('x');
    });
  });

  describe('attr', () => {
    test('sets standard attributes', () => {
      const math = api.element('math');
      api.attr(math, 'display', 'block');
      expect(math.getAttribute('display')).toBe('block');
    });

    test('sets namespaced attributes', () => {
      const math = api.element('math');
      api.attr(math, 'mathml:display', 'inline');
      // Check that the attribute was set (happy-dom may store it differently)
      expect(
        math.getAttributeNS('http://www.w3.org/1998/Math/MathML', 'mathml:display') ||
        math.getAttributeNS('http://www.w3.org/1998/Math/MathML', 'display') ||
        math.getAttribute('mathml:display')
      ).toBe('inline');
    });
  });

  describe('prop', () => {
    test('sets properties as attributes', () => {
      const math = api.element('math');
      api.prop(math, 'id', 'equation-1');
      expect(math.getAttribute('id')).toBe('equation-1');
    });
  });

  describe('insert', () => {
    test('inserts child into MathML parent', () => {
      const math = api.element('math');
      const mi = api.element('mi');
      api.insert(math, mi);
      expect(math.firstChild).toBe(mi);
    });

    test('builds complex MathML structures', () => {
      const mrow = api.element('mrow');
      const mi = api.element('mi');
      const mo = api.element('mo');
      const mn = api.element('mn');
      api.insert(mrow, mi);
      api.insert(mrow, mo);
      api.insert(mrow, mn);
      expect(mrow.children.length).toBe(3);
    });
  });

  describe('destroy', () => {
    test('removes connected MathML element', () => {
      const math = api.element('math');
      const mi = api.element('mi');
      math.appendChild(mi);
      document.body.appendChild(math);

      expect(mi.isConnected).toBe(true);
      api.destroy(mi);
      expect(math.children.length).toBe(0);
    });

    test('does nothing for disconnected elements', () => {
      const orphan = api.element('mi');
      expect(orphan.isConnected).toBe(false);
      // Should not throw
      api.destroy(orphan);
    });
  });

  describe('clearChildren', () => {
    test('removes all children from MathML element', () => {
      const mrow = api.element('mrow');
      mrow.appendChild(api.element('mi'));
      mrow.appendChild(api.element('mo'));
      mrow.appendChild(api.element('mn'));

      expect(mrow.childNodes.length).toBe(3);
      api.clearChildren(mrow);
      expect(mrow.childNodes.length).toBe(0);
    });

    test('works on empty MathML elements', () => {
      const mrow = api.element('mrow');
      api.clearChildren(mrow);
      expect(mrow.childNodes.length).toBe(0);
    });
  });

  describe('parent', () => {
    test('returns parent MathML element', () => {
      const math = api.element('math');
      const mi = api.element('mi');
      math.appendChild(mi);
      expect(api.parent(mi)).toBe(math);
    });

    test('returns null for orphan elements', () => {
      const orphan = api.element('mi');
      expect(api.parent(orphan)).toBe(null);
    });
  });

  describe('comment', () => {
    test('creates a comment node', () => {
      const comment = api.comment('MathML comment');
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

    test('fragment can hold multiple MathML elements', () => {
      const fragment = api.fragment();
      fragment.appendChild(api.element('mi'));
      fragment.appendChild(api.element('mo'));
      fragment.appendChild(api.element('mn'));
      expect(fragment.childNodes.length).toBe(3);
    });
  });
});
