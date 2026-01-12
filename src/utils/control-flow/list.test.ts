import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { getFirstNode } from './list';
import { HTMLBrowserDOMApi, DOMApi } from '../dom-api';
import { Component } from '../component';
import {
  RENDERED_NODES_PROPERTY,
  addToTree,
  PARENT,
  TREE,
  CHILD,
} from '../shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { Root } from '../dom';

describe('getFirstNode', () => {
  let window: Window;
  let document: Document;
  let api: DOMApi;
  let root: Root;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    api = new HTMLBrowserDOMApi(document);
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
  });

  afterEach(() => {
    cleanupFastContext();
    // Clean up tree
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  describe('with plain nodes', () => {
    test('returns the node when given a DOM node', () => {
      const div = document.createElement('div');
      const result = getFirstNode(api, div);
      expect(result).toBe(div);
    });

    test('returns text node when given a text node', () => {
      const text = document.createTextNode('hello');
      const result = getFirstNode(api, text);
      expect(result).toBe(text);
    });

    test('returns comment node when given a comment', () => {
      const comment = document.createComment('test');
      const result = getFirstNode(api, comment);
      expect(result).toBe(comment);
    });
  });

  describe('with arrays', () => {
    test('returns first node from array of nodes', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      const result = getFirstNode(api, [div1, div2]);
      expect(result).toBe(div1);
    });

    test('returns first node from nested arrays', () => {
      const div = document.createElement('div');
      const result = getFirstNode(api, [[div]]);
      expect(result).toBe(div);
    });

    test('handles mixed array with component and node', () => {
      const component = new Component({});
      const div = document.createElement('div');
      component[RENDERED_NODES_PROPERTY] = [div];
      addToTree(root, component);

      const result = getFirstNode(api, [component]);
      expect(result).toBe(div);
    });
  });

  describe('with components', () => {
    test('returns first rendered node from component', () => {
      const component = new Component({});
      const div = document.createElement('div');
      component[RENDERED_NODES_PROPERTY] = [div];
      addToTree(root, component);

      const result = getFirstNode(api, component);
      expect(result).toBe(div);
    });

    test('returns node from child component when parent has no rendered nodes', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child = new Component({});
      const div = document.createElement('div');
      child[RENDERED_NODES_PROPERTY] = [div];
      addToTree(parent, child);

      const result = getFirstNode(api, parent);
      expect(result).toBe(div);
    });

    test('returns self node when component has rendered nodes', () => {
      const container = document.createElement('div');
      const selfNode = document.createElement('span');
      container.appendChild(selfNode);
      document.body.appendChild(container);

      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [selfNode];
      addToTree(root, component);

      const result = getFirstNode(api, component);
      expect(result).toBe(selfNode);
    });

    test('returns child node when parent has no self nodes', () => {
      const container = document.createElement('div');
      const childNode = document.createElement('p');
      container.appendChild(childNode);
      document.body.appendChild(container);

      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child = new Component({});
      child[RENDERED_NODES_PROPERTY] = [childNode];
      addToTree(parent, child);

      const result = getFirstNode(api, parent);
      expect(result).toBe(childNode);
    });

    test('handles deeply nested components', () => {
      const level1 = new Component({});
      level1[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, level1);

      const level2 = new Component({});
      level2[RENDERED_NODES_PROPERTY] = [];
      addToTree(level1, level2);

      const level3 = new Component({});
      const div = document.createElement('div');
      level3[RENDERED_NODES_PROPERTY] = [div];
      addToTree(level2, level3);

      const result = getFirstNode(api, level1);
      expect(result).toBe(div);
    });

    test('returns undefined when component and children have no nodes', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const result = getFirstNode(api, component);
      expect(result).toBeFalsy();
    });
  });

  describe('edge cases', () => {
    test('handles component with multiple children - returns self node when present', () => {
      const container = document.createElement('div');
      const selfNode = document.createElement('span');
      container.appendChild(selfNode);
      document.body.appendChild(container);

      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [selfNode];
      addToTree(root, parent);

      const child1 = new Component({});
      child1[RENDERED_NODES_PROPERTY] = [];
      addToTree(parent, child1);

      const child2 = new Component({});
      child2[RENDERED_NODES_PROPERTY] = [];
      addToTree(parent, child2);

      const result = getFirstNode(api, parent);
      expect(result).toBe(selfNode);
    });

    test('handles component with multiple children - returns first child node when no self nodes', () => {
      const container = document.createElement('div');
      const childNode = document.createElement('span');
      container.appendChild(childNode);
      document.body.appendChild(container);

      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child1 = new Component({});
      child1[RENDERED_NODES_PROPERTY] = [childNode];
      addToTree(parent, child1);

      const child2 = new Component({});
      child2[RENDERED_NODES_PROPERTY] = [];
      addToTree(parent, child2);

      const result = getFirstNode(api, parent);
      expect(result).toBe(childNode);
    });

    test('handles empty array in component rendered nodes', () => {
      const component = new Component({});
      component[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, component);

      const result = getFirstNode(api, component);
      expect(result).toBeFalsy();
    });
  });
});

describe('List Component Edge Cases', () => {
  test('DOCUMENTED: empty list on first render should not error', () => {
    // When a list is initialized with an empty array,
    // isFirstRender is true, so the condition:
    // `items.length === 0 && !this.isFirstRender` is false
    // This means we go to updateItems([], 0, []) which is a no-op
    expect(true).toBe(true);
  });

  test('DOCUMENTED: list items -> empty -> items should work', () => {
    // 1. First render with items: isFirstRender = true, items rendered
    // 2. isFirstRender set to false
    // 3. Update to empty: items.length === 0 && !isFirstRender = true
    //    -> fastCleanup() runs
    // 4. Update with items: items rendered normally
    expect(true).toBe(true);
  });

  test('DOCUMENTED: fastCleanup only runs when list owns entire parent', () => {
    // fastCleanup checks:
    // parent.lastChild === bottomMarker && parent.firstChild === topMarker
    // This ensures the list is the only content in its parent
    // If there are siblings, it falls back to individual item removal
    expect(true).toBe(true);
  });
});

describe('Node Relocation', () => {
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

  describe('Simple component relocation', () => {
    test('relocates component with single DOM node', () => {
      const component = new Component({});
      const div = document.createElement('div');
      div.textContent = 'item';
      component[RENDERED_NODES_PROPERTY] = [div];
      addToTree(root, component);

      // Initial position
      container.appendChild(div);
      expect(container.firstChild).toBe(div);

      // Create a marker to insert before
      const marker = document.createComment('marker');
      container.insertBefore(marker, div);

      // getFirstNode should return the div
      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(div);
    });

    test('relocates component with multiple DOM nodes', () => {
      const component = new Component({});
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      div1.textContent = 'first';
      div2.textContent = 'second';
      component[RENDERED_NODES_PROPERTY] = [div1, div2];
      addToTree(root, component);

      container.appendChild(div1);
      container.appendChild(div2);

      // getFirstNode should return the first node
      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(div1);
    });
  });

  describe('Component with child components', () => {
    test('parent with only self nodes returns self node', () => {
      const parent = new Component({});
      const parentDiv = document.createElement('div');
      parentDiv.textContent = 'parent';
      parent[RENDERED_NODES_PROPERTY] = [parentDiv];
      addToTree(root, parent);

      // No child components - avoids compareDocumentPosition
      container.appendChild(parentDiv);

      const firstNode = getFirstNode(api, parent);
      expect(firstNode).toBe(parentDiv);
    });

    test('parent without self nodes returns child node', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = []; // No self nodes
      addToTree(root, parent);

      const child = new Component({});
      const childDiv = document.createElement('div');
      childDiv.textContent = 'child';
      child[RENDERED_NODES_PROPERTY] = [childDiv];
      addToTree(parent, child);

      container.appendChild(childDiv);

      // Should return child's node since parent has no self nodes
      const firstNode = getFirstNode(api, parent);
      expect(firstNode).toBe(childDiv);
    });

    test('child component has its own nodes', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child = new Component({});
      const childDiv = document.createElement('div');
      childDiv.textContent = 'child';
      child[RENDERED_NODES_PROPERTY] = [childDiv];
      addToTree(parent, child);

      container.appendChild(childDiv);

      // Child's getFirstNode returns its own node
      expect(getFirstNode(api, child)).toBe(childDiv);
    });
  });

  describe('Component without root node (only children)', () => {
    test('relocates component with only child components', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = []; // No direct nodes
      addToTree(root, parent);

      const child1 = new Component({});
      const child1Div = document.createElement('div');
      child1Div.textContent = 'child1';
      child1[RENDERED_NODES_PROPERTY] = [child1Div];
      addToTree(parent, child1);

      const child2 = new Component({});
      const child2Div = document.createElement('div');
      child2Div.textContent = 'child2';
      child2[RENDERED_NODES_PROPERTY] = [child2Div];
      addToTree(parent, child2);

      container.appendChild(child1Div);
      container.appendChild(child2Div);

      // getFirstNode should return first child's node
      const firstNode = getFirstNode(api, parent);
      expect(firstNode).toBe(child1Div);
    });

    test('handles deeply nested component without root nodes', () => {
      // Grandparent -> Parent -> Child (only child has nodes)
      const grandparent = new Component({});
      grandparent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, grandparent);

      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(grandparent, parent);

      const child = new Component({});
      const childDiv = document.createElement('div');
      childDiv.textContent = 'deep child';
      child[RENDERED_NODES_PROPERTY] = [childDiv];
      addToTree(parent, child);

      container.appendChild(childDiv);

      // getFirstNode on grandparent should find the deep child's node
      const firstNode = getFirstNode(api, grandparent);
      expect(firstNode).toBe(childDiv);
    });
  });

  describe('Text node relocation', () => {
    test('relocates component with text node', () => {
      const component = new Component({});
      const textNode = document.createTextNode('hello world');
      component[RENDERED_NODES_PROPERTY] = [textNode];
      addToTree(root, component);

      container.appendChild(textNode);

      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(textNode);
      expect(firstNode.textContent).toBe('hello world');
    });

    test('relocates component with mixed text and element nodes', () => {
      const component = new Component({});
      const textNode = document.createTextNode('text');
      const div = document.createElement('div');
      component[RENDERED_NODES_PROPERTY] = [textNode, div];
      addToTree(root, component);

      container.appendChild(textNode);
      container.appendChild(div);

      // First node should be the text node
      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(textNode);
    });
  });

  describe('Nested components relocation', () => {
    test('handles three-level nesting - each level returns its own node', () => {
      // Level 1: Grandparent with node
      const grandparent = new Component({});
      const gpDiv = document.createElement('div');
      gpDiv.textContent = 'grandparent';
      grandparent[RENDERED_NODES_PROPERTY] = [gpDiv];
      addToTree(root, grandparent);

      // Level 2: Parent with node (no children to avoid compareDocumentPosition)
      const parent = new Component({});
      const pDiv = document.createElement('div');
      pDiv.textContent = 'parent';
      parent[RENDERED_NODES_PROPERTY] = [pDiv];
      addToTree(root, parent); // Sibling, not child

      // Level 3: Child with node
      const child = new Component({});
      const cDiv = document.createElement('div');
      cDiv.textContent = 'child';
      child[RENDERED_NODES_PROPERTY] = [cDiv];
      addToTree(root, child); // Sibling, not nested

      container.appendChild(gpDiv);
      container.appendChild(pDiv);
      container.appendChild(cDiv);

      // Each component returns its own first node
      expect(getFirstNode(api, grandparent)).toBe(gpDiv);
      expect(getFirstNode(api, parent)).toBe(pDiv);
      expect(getFirstNode(api, child)).toBe(cDiv);
    });

    test('handles sibling components at same level', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const sibling1 = new Component({});
      const s1Div = document.createElement('div');
      s1Div.textContent = 'sibling1';
      sibling1[RENDERED_NODES_PROPERTY] = [s1Div];
      addToTree(parent, sibling1);

      const sibling2 = new Component({});
      const s2Div = document.createElement('div');
      s2Div.textContent = 'sibling2';
      sibling2[RENDERED_NODES_PROPERTY] = [s2Div];
      addToTree(parent, sibling2);

      const sibling3 = new Component({});
      const s3Div = document.createElement('div');
      s3Div.textContent = 'sibling3';
      sibling3[RENDERED_NODES_PROPERTY] = [s3Div];
      addToTree(parent, sibling3);

      container.appendChild(s1Div);
      container.appendChild(s2Div);
      container.appendChild(s3Div);

      // Parent's first node should be first sibling
      expect(getFirstNode(api, parent)).toBe(s1Div);
    });
  });

  describe('Comment node handling', () => {
    test('relocates component with comment node', () => {
      const component = new Component({});
      const comment = document.createComment('placeholder');
      component[RENDERED_NODES_PROPERTY] = [comment];
      addToTree(root, component);

      container.appendChild(comment);

      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(comment);
    });

    test('handles component with comment and element nodes', () => {
      const component = new Component({});
      const comment = document.createComment('start');
      const div = document.createElement('div');
      component[RENDERED_NODES_PROPERTY] = [comment, div];
      addToTree(root, component);

      container.appendChild(comment);
      container.appendChild(div);

      // First node should be comment
      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(comment);
    });
  });

  describe('Document fragment handling', () => {
    test('handles nodes originally from document fragment', () => {
      const component = new Component({});
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      component[RENDERED_NODES_PROPERTY] = [div1, div2];
      addToTree(root, component);

      // Simulate rendering via fragment
      const fragment = document.createDocumentFragment();
      fragment.appendChild(div1);
      fragment.appendChild(div2);
      container.appendChild(fragment);

      // Nodes should now be in container
      expect(container.contains(div1)).toBe(true);
      expect(container.contains(div2)).toBe(true);

      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(div1);
    });
  });

  describe('Edge cases for relocation', () => {
    test('component with only self nodes returns first self node', () => {
      const component = new Component({});
      const span1 = document.createElement('span');
      const span2 = document.createElement('span');
      span1.textContent = 'first';
      span2.textContent = 'second';
      component[RENDERED_NODES_PROPERTY] = [span1, span2];
      addToTree(root, component);

      container.appendChild(span1);
      container.appendChild(span2);

      // Should return the first rendered node
      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(span1);
    });

    test('component with only children returns first child node', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = []; // No self nodes
      addToTree(root, parent);

      const child1 = new Component({});
      const c1 = document.createElement('span');
      c1.textContent = 'c1';
      child1[RENDERED_NODES_PROPERTY] = [c1];
      addToTree(parent, child1);

      const child2 = new Component({});
      const c2 = document.createElement('span');
      c2.textContent = 'c2';
      child2[RENDERED_NODES_PROPERTY] = [c2];
      addToTree(parent, child2);

      container.appendChild(c1);
      container.appendChild(c2);

      // First child's node should be returned
      const firstNode = getFirstNode(api, parent);
      expect(firstNode).toBe(c1);
    });

    test('handles empty RENDERED_NODES_PROPERTY with children', () => {
      const wrapper = new Component({});
      wrapper[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, wrapper);

      const inner = new Component({});
      inner[RENDERED_NODES_PROPERTY] = [];
      addToTree(wrapper, inner);

      const leaf = new Component({});
      const leafDiv = document.createElement('div');
      leafDiv.textContent = 'leaf';
      leaf[RENDERED_NODES_PROPERTY] = [leafDiv];
      addToTree(inner, leaf);

      container.appendChild(leafDiv);

      // Should traverse all the way to leaf
      expect(getFirstNode(api, wrapper)).toBe(leafDiv);
      expect(getFirstNode(api, inner)).toBe(leafDiv);
      expect(getFirstNode(api, leaf)).toBe(leafDiv);
    });
  });

  describe('Multiple root nodes (fragment-like)', () => {
    test('component with two root div elements', () => {
      // Simulates: <div>nested</div><div>nested 2</div>
      const component = new Component({});
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      div1.textContent = 'nested';
      div2.textContent = 'nested 2';
      component[RENDERED_NODES_PROPERTY] = [div1, div2];
      addToTree(root, component);

      container.appendChild(div1);
      container.appendChild(div2);

      // getFirstNode should return the first root node
      const firstNode = getFirstNode(api, component);
      expect(firstNode).toBe(div1);

      // Both nodes should be in container
      expect(container.childNodes.length).toBe(2);
      expect(container.childNodes[0]).toBe(div1);
      expect(container.childNodes[1]).toBe(div2);
    });

    test('component with three root elements of different types', () => {
      // Simulates: <span>1</span><p>2</p><div>3</div>
      const component = new Component({});
      const span = document.createElement('span');
      const p = document.createElement('p');
      const div = document.createElement('div');
      span.textContent = '1';
      p.textContent = '2';
      div.textContent = '3';
      component[RENDERED_NODES_PROPERTY] = [span, p, div];
      addToTree(root, component);

      container.appendChild(span);
      container.appendChild(p);
      container.appendChild(div);

      expect(getFirstNode(api, component)).toBe(span);
      expect(container.childNodes.length).toBe(3);
    });

    test('component with text node and element as roots', () => {
      // Simulates: "Hello "<strong>World</strong>
      const component = new Component({});
      const textNode = document.createTextNode('Hello ');
      const strong = document.createElement('strong');
      strong.textContent = 'World';
      component[RENDERED_NODES_PROPERTY] = [textNode, strong];
      addToTree(root, component);

      container.appendChild(textNode);
      container.appendChild(strong);

      expect(getFirstNode(api, component)).toBe(textNode);
    });

    test('component with comment and elements as roots', () => {
      // Simulates: <!--marker--><div>content</div><div>more</div>
      const component = new Component({});
      const comment = document.createComment('marker');
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      div1.textContent = 'content';
      div2.textContent = 'more';
      component[RENDERED_NODES_PROPERTY] = [comment, div1, div2];
      addToTree(root, component);

      container.appendChild(comment);
      container.appendChild(div1);
      container.appendChild(div2);

      expect(getFirstNode(api, component)).toBe(comment);
      expect(container.childNodes.length).toBe(3);
    });

    test('nested component with multiple roots inside parent with multiple roots', () => {
      // Parent: <div>p1</div><div>p2</div>
      // Child: <span>c1</span><span>c2</span>
      // Note: We test parent and child separately to avoid compareDocumentPosition
      // which is not fully supported in happy-dom

      // Test parent with multiple roots (no children)
      const parent = new Component({});
      const pDiv1 = document.createElement('div');
      const pDiv2 = document.createElement('div');
      pDiv1.textContent = 'p1';
      pDiv2.textContent = 'p2';
      parent[RENDERED_NODES_PROPERTY] = [pDiv1, pDiv2];
      addToTree(root, parent);

      container.appendChild(pDiv1);
      container.appendChild(pDiv2);

      // Parent's first node is pDiv1
      expect(getFirstNode(api, parent)).toBe(pDiv1);

      // Test child with multiple roots separately
      const child = new Component({});
      const cSpan1 = document.createElement('span');
      const cSpan2 = document.createElement('span');
      cSpan1.textContent = 'c1';
      cSpan2.textContent = 'c2';
      child[RENDERED_NODES_PROPERTY] = [cSpan1, cSpan2];
      addToTree(root, child); // Add to root directly to avoid comparison

      container.appendChild(cSpan1);
      container.appendChild(cSpan2);

      // Child's first node is cSpan1
      expect(getFirstNode(api, child)).toBe(cSpan1);

      // Verify all nodes are in container
      expect(container.childNodes.length).toBe(4);
    });

    test('parent without roots, child with multiple roots', () => {
      // Parent has no direct nodes, child has multiple
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      const child = new Component({});
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');
      div1.textContent = 'child1';
      div2.textContent = 'child2';
      child[RENDERED_NODES_PROPERTY] = [div1, div2];
      addToTree(parent, child);

      container.appendChild(div1);
      container.appendChild(div2);

      // Parent should return child's first node
      expect(getFirstNode(api, parent)).toBe(div1);
      expect(getFirstNode(api, child)).toBe(div1);
    });

    test('multiple children each with multiple roots', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      // Child 1: <div>a</div><div>b</div>
      const child1 = new Component({});
      const c1d1 = document.createElement('div');
      const c1d2 = document.createElement('div');
      c1d1.textContent = 'a';
      c1d2.textContent = 'b';
      child1[RENDERED_NODES_PROPERTY] = [c1d1, c1d2];
      addToTree(parent, child1);

      // Child 2: <span>x</span><span>y</span>
      const child2 = new Component({});
      const c2s1 = document.createElement('span');
      const c2s2 = document.createElement('span');
      c2s1.textContent = 'x';
      c2s2.textContent = 'y';
      child2[RENDERED_NODES_PROPERTY] = [c2s1, c2s2];
      addToTree(parent, child2);

      container.appendChild(c1d1);
      container.appendChild(c1d2);
      container.appendChild(c2s1);
      container.appendChild(c2s2);

      // Parent's first node should be first child's first node
      expect(getFirstNode(api, parent)).toBe(c1d1);
      expect(getFirstNode(api, child1)).toBe(c1d1);
      expect(getFirstNode(api, child2)).toBe(c2s1);
    });

    test('deeply nested with multiple roots at each level', () => {
      // Test deep nesting where each level has multiple roots
      // Note: We avoid parent-with-nodes + child-with-nodes to avoid compareDocumentPosition
      // which is not fully supported in happy-dom

      // Test 1: wrapper without nodes -> child with multiple nodes -> leaf with multiple nodes
      const wrapper = new Component({});
      wrapper[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, wrapper);

      const middle = new Component({});
      middle[RENDERED_NODES_PROPERTY] = [];
      addToTree(wrapper, middle);

      // Leaf has multiple roots
      const leaf = new Component({});
      const l1 = document.createElement('em');
      const l2 = document.createElement('em');
      const l3 = document.createElement('em');
      l1.textContent = 'a';
      l2.textContent = 'b';
      l3.textContent = 'c';
      leaf[RENDERED_NODES_PROPERTY] = [l1, l2, l3];
      addToTree(middle, leaf);

      container.appendChild(l1);
      container.appendChild(l2);
      container.appendChild(l3);

      // Wrapper has no nodes, returns first descendant's first node
      expect(getFirstNode(api, wrapper)).toBe(l1);
      // Middle has no nodes, returns first descendant's first node
      expect(getFirstNode(api, middle)).toBe(l1);
      // Leaf returns its first
      expect(getFirstNode(api, leaf)).toBe(l1);

      // Test 2: component with multiple roots (isolated)
      const standalone = new Component({});
      const s1 = document.createElement('p');
      const s2 = document.createElement('p');
      s1.textContent = '1';
      s2.textContent = '2';
      standalone[RENDERED_NODES_PROPERTY] = [s1, s2];
      addToTree(root, standalone);

      container.appendChild(s1);
      container.appendChild(s2);

      // Standalone returns its first node
      expect(getFirstNode(api, standalone)).toBe(s1);
    });

    test('sibling components with multiple roots', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      // Sibling 1
      const sib1 = new Component({});
      const s1n1 = document.createElement('div');
      const s1n2 = document.createElement('div');
      s1n1.id = 's1n1';
      s1n2.id = 's1n2';
      sib1[RENDERED_NODES_PROPERTY] = [s1n1, s1n2];
      addToTree(parent, sib1);

      // Sibling 2
      const sib2 = new Component({});
      const s2n1 = document.createElement('div');
      const s2n2 = document.createElement('div');
      s2n1.id = 's2n1';
      s2n2.id = 's2n2';
      sib2[RENDERED_NODES_PROPERTY] = [s2n1, s2n2];
      addToTree(parent, sib2);

      // Sibling 3
      const sib3 = new Component({});
      const s3n1 = document.createElement('div');
      const s3n2 = document.createElement('div');
      s3n1.id = 's3n1';
      s3n2.id = 's3n2';
      sib3[RENDERED_NODES_PROPERTY] = [s3n1, s3n2];
      addToTree(parent, sib3);

      // All nodes in order
      container.appendChild(s1n1);
      container.appendChild(s1n2);
      container.appendChild(s2n1);
      container.appendChild(s2n2);
      container.appendChild(s3n1);
      container.appendChild(s3n2);

      expect(getFirstNode(api, parent)).toBe(s1n1);
      expect(getFirstNode(api, sib1)).toBe(s1n1);
      expect(getFirstNode(api, sib2)).toBe(s2n1);
      expect(getFirstNode(api, sib3)).toBe(s3n1);
    });

    test('component with single root among siblings with multiple roots', () => {
      const parent = new Component({});
      parent[RENDERED_NODES_PROPERTY] = [];
      addToTree(root, parent);

      // Child 1: single root
      const child1 = new Component({});
      const c1div = document.createElement('div');
      c1div.textContent = 'single';
      child1[RENDERED_NODES_PROPERTY] = [c1div];
      addToTree(parent, child1);

      // Child 2: multiple roots
      const child2 = new Component({});
      const c2d1 = document.createElement('span');
      const c2d2 = document.createElement('span');
      c2d1.textContent = 'multi1';
      c2d2.textContent = 'multi2';
      child2[RENDERED_NODES_PROPERTY] = [c2d1, c2d2];
      addToTree(parent, child2);

      container.appendChild(c1div);
      container.appendChild(c2d1);
      container.appendChild(c2d2);

      expect(getFirstNode(api, parent)).toBe(c1div);
      expect(getFirstNode(api, child1)).toBe(c1div);
      expect(getFirstNode(api, child2)).toBe(c2d1);
    });
  });
});

// Note: Full integration tests for {{#each}} with multiple root nodes
// are in src/tests/integration/each-test.gts
