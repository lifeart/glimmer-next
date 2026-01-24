import { expect, test, describe, beforeEach } from 'vitest';
import {
  CanvasBaseElement,
  CanvasComment,
  CanvasFragment,
  CanvasTextElement,
  DESTROYED_NODES,
} from './canvas';

describe('Canvas Renderer Elements', () => {
  describe('CanvasBaseElement', () => {
    let element: CanvasBaseElement;

    beforeEach(() => {
      element = new CanvasBaseElement();
    });

    test('initializes with empty children array', () => {
      expect(element.children).toEqual([]);
    });

    test('initializes with isConnected as false', () => {
      expect(element.isConnected).toBe(false);
    });

    test('initializes with undefined parentElement', () => {
      expect(element.parentElement).toBeUndefined();
    });

    test('childNodes returns children array', () => {
      const child = new CanvasBaseElement();
      element.children.push(child);
      expect(element.childNodes).toEqual([child]);
    });

    test('parentNode getter returns parentElement', () => {
      const parent = new CanvasBaseElement();
      element.parentElement = parent;
      expect(element.parentNode).toBe(parent);
    });

    describe('removeChild', () => {
      test('removes child from children array', () => {
        const child1 = new CanvasBaseElement();
        const child2 = new CanvasBaseElement();
        element.children.push(child1, child2);

        element.removeChild(child1);

        expect(element.children).toEqual([child2]);
      });

      test('does nothing if child not found', () => {
        const child1 = new CanvasBaseElement();
        const child2 = new CanvasBaseElement();
        element.children.push(child1);

        element.removeChild(child2);

        expect(element.children).toEqual([child1]);
      });
    });

    describe('remove', () => {
      test('sets isConnected to false', () => {
        element.isConnected = true;
        element.remove();
        expect(element.isConnected).toBe(false);
      });

      test('clears children array', () => {
        element.children.push(new CanvasBaseElement());
        element.remove();
        expect(element.children.length).toBe(0);
      });

      test('sets parentElement to undefined', () => {
        element.parentElement = new CanvasBaseElement();
        element.remove();
        expect(element.parentElement).toBeUndefined();
      });

      test('removes itself from parent children when parent is CanvasBaseElement', () => {
        const parent = new CanvasBaseElement();
        parent.children.push(element);
        element.parentElement = parent;

        element.remove();

        expect(parent.children).toEqual([]);
      });

      test('does nothing if already destroyed', () => {
        element.isConnected = true;
        element.remove();

        // Try to remove again - should not throw
        element.isConnected = true; // Reset to test idempotency
        element.remove();

        expect(element.isConnected).toBe(true); // Should not change because already in DESTROYED_NODES
      });
    });

    describe('toCanvas', () => {
      test('does not throw when called', () => {
        const mockCtx = {} as CanvasRenderingContext2D;
        expect(() => element.toCanvas(mockCtx)).not.toThrow();
      });
    });
  });

  describe('CanvasComment', () => {
    test('extends CanvasBaseElement', () => {
      const comment = new CanvasComment();
      expect(comment).toBeInstanceOf(CanvasBaseElement);
    });

    test('has all base element properties', () => {
      const comment = new CanvasComment();
      expect(comment.children).toEqual([]);
      expect(comment.isConnected).toBe(false);
    });
  });

  describe('CanvasFragment', () => {
    test('extends CanvasBaseElement', () => {
      const fragment = new CanvasFragment();
      expect(fragment).toBeInstanceOf(CanvasBaseElement);
    });

    test('can hold multiple children', () => {
      const fragment = new CanvasFragment();
      const child1 = new CanvasTextElement();
      const child2 = new CanvasComment();

      fragment.children.push(child1, child2);

      expect(fragment.children.length).toBe(2);
    });
  });

  describe('CanvasTextElement', () => {
    let textElement: CanvasTextElement;

    beforeEach(() => {
      textElement = new CanvasTextElement();
    });

    test('extends CanvasBaseElement', () => {
      expect(textElement).toBeInstanceOf(CanvasBaseElement);
    });

    test('has default attrs', () => {
      expect(textElement.attrs).toEqual({
        font: '48px serif',
        fillStyle: 'red',
        x: 0,
        y: 0,
      });
    });

    test('has empty text by default', () => {
      expect(textElement.text).toBe('');
    });

    test('text can be set', () => {
      textElement.text = 'Hello World';
      expect(textElement.text).toBe('Hello World');
    });

    test('attrs can be modified', () => {
      textElement.attrs.font = '24px Arial';
      textElement.attrs.fillStyle = 'blue';
      textElement.attrs.x = 100;
      textElement.attrs.y = 200;

      expect(textElement.attrs).toEqual({
        font: '24px Arial',
        fillStyle: 'blue',
        x: 100,
        y: 200,
      });
    });

    describe('toCanvas', () => {
      test('renders text to canvas context', () => {
        textElement.text = 'Test';
        textElement.attrs.x = 10;
        textElement.attrs.y = 20;
        textElement.attrs.font = '16px sans-serif';
        textElement.attrs.fillStyle = 'black';

        let fillStyleSet = '';
        let fontSet = '';
        let fillTextArgs: [string, number, number] | null = null;

        const mockCtx = {
          set fillStyle(value: string) {
            fillStyleSet = value;
          },
          set font(value: string) {
            fontSet = value;
          },
          fillText(text: string, x: number, y: number) {
            fillTextArgs = [text, x, y];
          },
        } as unknown as CanvasRenderingContext2D;

        textElement.toCanvas(mockCtx);

        expect(fillStyleSet).toBe('black');
        expect(fontSet).toBe('16px sans-serif');
        expect(fillTextArgs).toEqual(['Test', 10, 20]);
      });
    });
  });

  describe('Element hierarchy', () => {
    test('can build parent-child relationships', () => {
      const parent = new CanvasFragment();
      const child1 = new CanvasTextElement();
      const child2 = new CanvasComment();

      child1.parentElement = parent;
      child2.parentElement = parent;
      parent.children.push(child1, child2);

      expect(parent.children).toEqual([child1, child2]);
      expect(child1.parentElement).toBe(parent);
      expect(child2.parentElement).toBe(parent);
    });

    test('removing child updates parent', () => {
      const parent = new CanvasFragment();
      const child = new CanvasTextElement();

      child.parentElement = parent;
      parent.children.push(child);

      child.remove();

      expect(parent.children).toEqual([]);
      expect(child.parentElement).toBeUndefined();
    });

    test('can traverse up using parentNode', () => {
      const grandparent = new CanvasFragment();
      const parent = new CanvasFragment();
      const child = new CanvasTextElement();

      parent.parentElement = grandparent;
      child.parentElement = parent;
      grandparent.children.push(parent);
      parent.children.push(child);

      expect(child.parentNode).toBe(parent);
      expect(parent.parentNode).toBe(grandparent);
      expect(grandparent.parentNode).toBeUndefined();
    });
  });

  describe('DESTROYED_NODES WeakSet', () => {
    test('tracks destroyed elements', () => {
      const element = new CanvasBaseElement();
      expect(DESTROYED_NODES.has(element)).toBe(false);

      element.remove();

      expect(DESTROYED_NODES.has(element)).toBe(true);
    });

    test('prevents double destruction', () => {
      const parent = new CanvasBaseElement();
      const child = new CanvasBaseElement();

      child.parentElement = parent;
      parent.children.push(child);
      child.isConnected = true;

      // First remove
      child.remove();
      expect(child.isConnected).toBe(false);

      // Reset and try again - should not process
      child.isConnected = true;
      parent.children.push(child);

      child.remove();

      // isConnected should still be true because element was already destroyed
      expect(child.isConnected).toBe(true);
    });
  });
});

describe('Canvas API factory function', () => {
  // Test for the standalone canvas API creation
  // This tests the API methods without requiring a real canvas element

  function createTestCanvasApi() {
    const nodes = new Set<CanvasBaseElement>();
    let rerenderScheduled = false;

    return {
      toString() {
        return 'canvas:dom-api';
      },
      createNode<T extends CanvasBaseElement>(
        klass: new () => T,
        debugName?: string,
      ): T {
        const node = new klass();
        // @ts-expect-error adding debug property
        node.debugName = debugName;
        return node;
      },
      destroy(el: CanvasBaseElement) {
        nodes.delete(el);
        el.remove();
        rerenderScheduled = true;
      },
      clearChildren(element: CanvasBaseElement) {
        element.children.forEach((child) => {
          this.destroy(child);
        });
        element.children.length = 0;
      },
      addEventListener() {
        return undefined;
      },
      prop(_element: CanvasBaseElement, _name: string, value: unknown) {
        return value;
      },
      nodes,
      parent(node: CanvasBaseElement) {
        return node.parentElement;
      },
      fragment() {
        return this.createNode(CanvasFragment);
      },
      element(tagName: string) {
        if (tagName === 'text') {
          return this.createNode(CanvasTextElement);
        } else {
          throw new Error(`Unknown canvas element: ${tagName}`);
        }
      },
      attr<T extends keyof CanvasTextElement['attrs']>(
        el: CanvasTextElement,
        attr: T,
        value: CanvasTextElement['attrs'][T],
      ) {
        el.attrs[attr] = value;
        rerenderScheduled = true;
      },
      text(text: string) {
        const textNode = this.createNode(CanvasTextElement);
        textNode.text = text;
        return textNode;
      },
      textContent(element: CanvasTextElement, text: string) {
        element.text = text;
        rerenderScheduled = true;
      },
      comment(debugName?: string) {
        return this.createNode(CanvasComment, debugName);
      },
      isNode(el: unknown) {
        return el instanceof CanvasBaseElement;
      },
      get wasRerenderScheduled() {
        return rerenderScheduled;
      },
      resetRerenderFlag() {
        rerenderScheduled = false;
      },
    };
  }

  describe('toString', () => {
    test('returns correct identifier', () => {
      const api = createTestCanvasApi();
      expect(api.toString()).toBe('canvas:dom-api');
    });
  });

  describe('createNode', () => {
    test('creates CanvasTextElement', () => {
      const api = createTestCanvasApi();
      const node = api.createNode(CanvasTextElement);
      expect(node).toBeInstanceOf(CanvasTextElement);
    });

    test('creates CanvasFragment', () => {
      const api = createTestCanvasApi();
      const node = api.createNode(CanvasFragment);
      expect(node).toBeInstanceOf(CanvasFragment);
    });

    test('creates CanvasComment', () => {
      const api = createTestCanvasApi();
      const node = api.createNode(CanvasComment);
      expect(node).toBeInstanceOf(CanvasComment);
    });

    test('sets debug name when provided', () => {
      const api = createTestCanvasApi();
      const node = api.createNode(CanvasComment, 'test-comment');
      // @ts-expect-error accessing debug property
      expect(node.debugName).toBe('test-comment');
    });
  });

  describe('element', () => {
    test('creates text element for "text" tag', () => {
      const api = createTestCanvasApi();
      const element = api.element('text');
      expect(element).toBeInstanceOf(CanvasTextElement);
    });

    test('throws for unknown tag names', () => {
      const api = createTestCanvasApi();
      expect(() => api.element('div')).toThrow('Unknown canvas element: div');
      expect(() => api.element('span')).toThrow('Unknown canvas element: span');
    });
  });

  describe('fragment', () => {
    test('creates CanvasFragment', () => {
      const api = createTestCanvasApi();
      const fragment = api.fragment();
      expect(fragment).toBeInstanceOf(CanvasFragment);
    });
  });

  describe('comment', () => {
    test('creates CanvasComment', () => {
      const api = createTestCanvasApi();
      const comment = api.comment();
      expect(comment).toBeInstanceOf(CanvasComment);
    });

    test('creates CanvasComment with debug name', () => {
      const api = createTestCanvasApi();
      const comment = api.comment('placeholder');
      // @ts-expect-error accessing debug property
      expect(comment.debugName).toBe('placeholder');
    });
  });

  describe('text', () => {
    test('creates text element with content', () => {
      const api = createTestCanvasApi();
      const textNode = api.text('Hello World');
      expect(textNode).toBeInstanceOf(CanvasTextElement);
      expect(textNode.text).toBe('Hello World');
    });
  });

  describe('textContent', () => {
    test('sets text content on element', () => {
      const api = createTestCanvasApi();
      const textNode = api.text('Initial');
      api.textContent(textNode, 'Updated');
      expect(textNode.text).toBe('Updated');
    });

    test('schedules rerender', () => {
      const api = createTestCanvasApi();
      const textNode = api.text('Test');
      api.resetRerenderFlag();
      api.textContent(textNode, 'New');
      expect(api.wasRerenderScheduled).toBe(true);
    });
  });

  describe('attr', () => {
    test('sets attribute on text element', () => {
      const api = createTestCanvasApi();
      const textNode = api.text('Test');

      api.attr(textNode, 'font', '24px Arial');
      api.attr(textNode, 'fillStyle', 'blue');
      api.attr(textNode, 'x', 100);
      api.attr(textNode, 'y', 200);

      expect(textNode.attrs.font).toBe('24px Arial');
      expect(textNode.attrs.fillStyle).toBe('blue');
      expect(textNode.attrs.x).toBe(100);
      expect(textNode.attrs.y).toBe(200);
    });

    test('schedules rerender', () => {
      const api = createTestCanvasApi();
      const textNode = api.text('Test');
      api.resetRerenderFlag();
      api.attr(textNode, 'x', 50);
      expect(api.wasRerenderScheduled).toBe(true);
    });
  });

  describe('parent', () => {
    test('returns parent element', () => {
      const api = createTestCanvasApi();
      const parent = api.fragment();
      const child = api.text('Child');
      child.parentElement = parent;
      expect(api.parent(child)).toBe(parent);
    });

    test('returns undefined for orphan elements', () => {
      const api = createTestCanvasApi();
      const orphan = api.text('Orphan');
      expect(api.parent(orphan)).toBeUndefined();
    });
  });

  describe('isNode', () => {
    test('returns true for canvas elements', () => {
      const api = createTestCanvasApi();
      expect(api.isNode(new CanvasBaseElement())).toBe(true);
      expect(api.isNode(new CanvasTextElement())).toBe(true);
      expect(api.isNode(new CanvasFragment())).toBe(true);
      expect(api.isNode(new CanvasComment())).toBe(true);
    });

    test('returns false for non-canvas elements', () => {
      const api = createTestCanvasApi();
      expect(api.isNode({})).toBe(false);
      expect(api.isNode(null)).toBe(false);
      expect(api.isNode(undefined)).toBe(false);
      expect(api.isNode('string')).toBe(false);
      expect(api.isNode(123)).toBe(false);
    });
  });

  describe('destroy', () => {
    test('removes element from nodes set', () => {
      const api = createTestCanvasApi();
      const element = api.text('Test');
      api.nodes.add(element);

      expect(api.nodes.has(element)).toBe(true);
      api.destroy(element);
      expect(api.nodes.has(element)).toBe(false);
    });

    test('calls remove on element', () => {
      const api = createTestCanvasApi();
      const element = api.text('Test');
      element.isConnected = true;

      api.destroy(element);

      expect(element.isConnected).toBe(false);
    });

    test('schedules rerender', () => {
      const api = createTestCanvasApi();
      const element = api.text('Test');
      api.resetRerenderFlag();
      api.destroy(element);
      expect(api.wasRerenderScheduled).toBe(true);
    });
  });

  describe('clearChildren', () => {
    test('destroys all children', () => {
      const api = createTestCanvasApi();
      const parent = api.fragment();
      const child1 = api.text('Child 1');
      const child2 = api.text('Child 2');

      parent.children.push(child1, child2);
      api.nodes.add(child1);
      api.nodes.add(child2);

      api.clearChildren(parent);

      expect(parent.children.length).toBe(0);
      expect(api.nodes.has(child1)).toBe(false);
      expect(api.nodes.has(child2)).toBe(false);
    });

    test('works on empty elements', () => {
      const api = createTestCanvasApi();
      const parent = api.fragment();

      expect(() => api.clearChildren(parent)).not.toThrow();
      expect(parent.children.length).toBe(0);
    });
  });

  describe('addEventListener', () => {
    test('returns undefined (canvas elements do not support events)', () => {
      const api = createTestCanvasApi();
      const result = api.addEventListener();
      expect(result).toBeUndefined();
    });
  });

  describe('prop', () => {
    test('returns the provided value', () => {
      const api = createTestCanvasApi();
      const element = api.text('Test');
      const result = api.prop(element, 'someProperty', 'someValue');
      expect(result).toBe('someValue');
    });
  });
});
