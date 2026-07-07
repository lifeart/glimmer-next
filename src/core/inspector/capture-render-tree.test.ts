import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import {
  TREE,
  CHILD,
  PARENT,
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
  $args,
  type ComponentLike,
} from '../shared';
import {
  captureRenderTree,
  componentToRenderTree,
  type CapturedRenderNode,
} from './capture-render-tree';
import { IfCondition } from '../control-flow/if';
import { HOST_HOOKS, registerHostHooks } from '../host-hooks';

/**
 * These tests pin the Ember `captureRenderTree` node shape produced from GXT's
 * component TREE. The serializer is exercised in isolation by wiring a small
 * TREE / CHILD / PARENT graph of component-like objects (mirroring what the
 * runtime writes), so the shape contract is verified without the full render
 * pipeline.
 */
describe('captureRenderTree — Ember-shaped render tree from GXT TREE', () => {
  let window: Window;
  let document: Document;
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    container = document.createElement('div');
  });

  afterEach(() => {
    TREE.clear();
    CHILD.clear();
    PARENT.clear();
    // HOST_HOOKS is a module-local singleton; drop any hook a test installed so
    // it can't leak into the next test.
    delete (HOST_HOOKS as { resolveComponentName?: unknown }).resolveComponentName;
    window.close();
  });

  function makeComponent(
    id: number,
    props: {
      debugName: string;
      renderedNodes?: Node[];
      args?: Record<string, unknown>;
    },
  ): ComponentLike {
    const comp: Record<string | symbol, unknown> = {
      [COMPONENT_ID_PROPERTY]: id,
      [RENDERED_NODES_PROPERTY]: props.renderedNodes ?? [],
      debugName: props.debugName,
    };
    if (props.args) {
      comp[$args] = props.args;
    }
    return comp as unknown as ComponentLike;
  }

  test('root → component: id/type/name/args/instance/template/bounds/children shape', () => {
    // <span> is the child's single rendered node → derives bounds.
    const childEl = document.createElement('span');
    container.appendChild(childEl);

    const child = makeComponent(2, {
      debugName: 'HelloWorld',
      renderedNodes: [childEl],
      args: { name: 'first' },
    });
    const root = makeComponent(1, { debugName: 'Root' });

    TREE.set(1, root);
    TREE.set(2, child);
    CHILD.set(1, new Set([2]));
    CHILD.set(2, new Set());
    // Root registers with a `null` parent (src/core/root.ts) — this is how
    // findRoots() discovers roots when no explicit roots are passed.
    PARENT.set(1, null as unknown as number);
    PARENT.set(2, 1);

    const tree = captureRenderTree();

    expect(tree.length).toBe(1);
    const rootNode = tree[0]!;

    // Root node.
    expect(rootNode.id).toBe('1');
    expect(rootNode.type).toBe('component');
    expect(rootNode.name).toBe('Root');
    expect(rootNode.args).toEqual({ positional: [], named: {} });
    expect(rootNode.instance).toBe(root);
    expect(rootNode.template).toBe(null);
    expect(rootNode.bounds).toBe(null); // no rendered nodes → no bounds
    expect(rootNode.children.length).toBe(1);

    // Child component node.
    const childNode = rootNode.children[0]!;
    expect(childNode.id).toBe('2');
    expect(childNode.type).toBe('component');
    expect(childNode.name).toBe('HelloWorld');
    expect(childNode.instance).toBe(child);
    expect(childNode.template).toBe(null);
    expect(childNode.children).toEqual([]);

    // args: PLAIN resolved object — NOT the legacy `__ARGS__` getter wrapper.
    expect(childNode.args.positional).toEqual([]);
    expect(childNode.args.named).toEqual({ name: 'first' });
    expect(Object.keys(childNode.args.named)).toEqual(['name']);
    expect('__ARGS__' in childNode.args.named).toBe(false);

    // bounds: firstNode / lastNode / parentElement from the rendered node.
    expect(childNode.bounds).not.toBe(null);
    expect(childNode.bounds!.firstNode).toBe(childEl);
    expect(childNode.bounds!.lastNode).toBe(childEl);
    expect(childNode.bounds!.parentElement).toBe(container);
  });

  test('multi-node component derives bounds from first/last rendered node', () => {
    const a = document.createElement('a');
    const b = document.createElement('b');
    container.append(a, b);

    const comp = makeComponent(5, {
      debugName: 'MultiNode',
      renderedNodes: [a, b],
    });

    const node = componentToRenderTree(comp)!;
    expect(node.bounds!.firstNode).toBe(a);
    expect(node.bounds!.lastNode).toBe(b);
    expect(node.bounds!.parentElement).toBe(container);
  });

  test('{{#if}} keyword: name "if", condition hoisted to positional, hidden from named', () => {
    const ifComp = makeComponent(3, {
      debugName: 'IfCondition-1',
      args: { if: true },
    });

    const [node] = captureRenderTree([ifComp]);
    expect(node!.name).toBe('if');
    expect(node!.args.positional).toEqual([true]);
    // `if` is hidden from named args.
    expect(node!.args.named).toEqual({});
  });

  test('{{#each}} async keyword: name "each", list.value → positional, async flag added', () => {
    const eachComp = makeComponent(4, {
      debugName: 'AsyncListComponent-1',
      args: { list: { value: [1, 2, 3] } },
    });

    const [node] = captureRenderTree([eachComp]);
    expect(node!.name).toBe('each');
    expect(node!.args.positional).toEqual([[1, 2, 3]]);
    // `list` hidden, `async` synthesized.
    expect(node!.args.named).toEqual({ async: true });
  });

  test('explicit roots argument bypasses findRoots()', () => {
    const solo = makeComponent(9, { debugName: 'Solo', args: { x: 1 } });
    // Not wired into PARENT, so findRoots() would not see it.
    const tree: CapturedRenderNode[] = captureRenderTree([solo]);
    expect(tree.length).toBe(1);
    expect(tree[0]!.name).toBe('Solo');
    expect(tree[0]!.args.named).toEqual({ x: 1 });
  });

  test('captureRenderTree() returns [] when the tree is empty', () => {
    expect(captureRenderTree()).toEqual([]);
  });

  /**
   * Cycle / back-edge guard.
   *
   * The bridged (Ember dual-backend) component graph is NOT a strict tree: it
   * can contain back-edges — e.g. a keyed subtree whose CHILD set points back
   * at an ancestor, or an `{{#if}}` whose `prevComponent` leaf-fallback points
   * at a sibling/ancestor already on the walk stack. Without a visited guard
   * `componentToRenderTree` follows that back-edge and recurses until the
   * JS stack overflows (`RangeError: Maximum call stack size exceeded`).
   *
   * These tests pin that the walk now TERMINATES and returns a finite tree,
   * while the acyclic tests above pin that legitimate parent→child structure
   * (shape + child counts) is unchanged.
   */
  describe('cycle / back-edge guard', () => {
    test('CHILD back-edge to an ancestor terminates (no stack overflow)', () => {
      // 1 → 2 → 1 → 2 → …  (CHILD(2) points back at its ancestor 1)
      const root = makeComponent(1, { debugName: 'Root' });
      const child = makeComponent(2, { debugName: 'Child' });

      TREE.set(1, root);
      TREE.set(2, child);
      CHILD.set(1, new Set([2]));
      CHILD.set(2, new Set([1])); // back-edge → cycle
      PARENT.set(1, null as unknown as number);
      PARENT.set(2, 1);

      const tree = captureRenderTree();

      // Root is walked once; its child (2) is walked once; the back-edge from
      // 2 → 1 is skipped because 1 is already on the walk path.
      expect(tree.length).toBe(1);
      const rootNode = tree[0]!;
      expect(rootNode.id).toBe('1');
      expect(rootNode.children.length).toBe(1);
      const childNode = rootNode.children[0]!;
      expect(childNode.id).toBe('2');
      // The back-edge from child → root is NOT re-descended.
      expect(childNode.children).toEqual([]);
    });

    test('self-referential CHILD set terminates', () => {
      // 1 → 1 (a node listed as its own child).
      const root = makeComponent(1, { debugName: 'SelfRef' });
      TREE.set(1, root);
      CHILD.set(1, new Set([1])); // self-loop
      PARENT.set(1, null as unknown as number);

      const [node] = captureRenderTree();
      expect(node!.id).toBe('1');
      expect(node!.children).toEqual([]);
    });

    test('{{#if}} prevComponent leaf-fallback pointing at an ancestor terminates', () => {
      // Root → IfCondition(3); the if has no tree children, so the walker
      // consults `prevComponent` — which here points BACK at the root (an
      // ancestor already on the walk). Without the guard this recurses:
      //   root → if → prevComponent(root) → if → prevComponent(root) → …
      const root = makeComponent(1, {
        debugName: 'Root',
        renderedNodes: [],
      });

      // A minimal real IfCondition instance (so `instanceof IfCondition`
      // triggers the prevComponent leaf-fallback) without invoking the heavy
      // constructor.
      const ifComp = Object.create(IfCondition.prototype) as Record<
        string | symbol,
        unknown
      >;
      ifComp[COMPONENT_ID_PROPERTY] = 3;
      ifComp[RENDERED_NODES_PROPERTY] = [];
      ifComp.debugName = 'IfCondition-backedge';
      ifComp.prevComponent = root; // sibling/ancestor back-edge

      TREE.set(1, root);
      TREE.set(3, ifComp as unknown as ComponentLike);
      CHILD.set(1, new Set([3]));
      CHILD.set(3, new Set()); // empty → prevComponent fallback engages
      PARENT.set(1, null as unknown as number);
      PARENT.set(3, 1);

      const tree = captureRenderTree();

      expect(tree.length).toBe(1);
      const rootNode = tree[0]!;
      expect(rootNode.id).toBe('1');
      expect(rootNode.children.length).toBe(1);
      const ifNode = rootNode.children[0]!;
      expect(ifNode.id).toBe('3');
      expect(ifNode.name).toBe('if');
      // The prevComponent back-edge to the ancestor is NOT re-descended.
      expect(ifNode.children).toEqual([]);
    });

    test('legitimate deep nested tree still captures fully (child counts unchanged)', () => {
      // 1 → 2 → 3 → 4 (a genuine chain — the guard must NOT prune it).
      const a = makeComponent(1, { debugName: 'A' });
      const b = makeComponent(2, { debugName: 'B' });
      const c = makeComponent(3, { debugName: 'C' });
      const d = makeComponent(4, { debugName: 'D' });

      TREE.set(1, a);
      TREE.set(2, b);
      TREE.set(3, c);
      TREE.set(4, d);
      CHILD.set(1, new Set([2]));
      CHILD.set(2, new Set([3]));
      CHILD.set(3, new Set([4]));
      CHILD.set(4, new Set());
      PARENT.set(1, null as unknown as number);
      PARENT.set(2, 1);
      PARENT.set(3, 2);
      PARENT.set(4, 3);

      const [node] = captureRenderTree();
      expect(node!.id).toBe('1');
      expect(node!.children.length).toBe(1);
      expect(node!.children[0]!.id).toBe('2');
      expect(node!.children[0]!.children.length).toBe(1);
      expect(node!.children[0]!.children[0]!.id).toBe('3');
      expect(node!.children[0]!.children[0]!.children.length).toBe(1);
      expect(node!.children[0]!.children[0]!.children[0]!.id).toBe('4');
      expect(node!.children[0]!.children[0]!.children[0]!.children).toEqual([]);
    });

    test('a node with two distinct real children keeps both (no over-pruning)', () => {
      // 1 → {2, 3}: sibling subtrees must both survive the visited guard.
      const root = makeComponent(1, { debugName: 'Root' });
      const left = makeComponent(2, { debugName: 'Left' });
      const right = makeComponent(3, { debugName: 'Right' });

      TREE.set(1, root);
      TREE.set(2, left);
      TREE.set(3, right);
      CHILD.set(1, new Set([2, 3]));
      CHILD.set(2, new Set());
      CHILD.set(3, new Set());
      PARENT.set(1, null as unknown as number);
      PARENT.set(2, 1);
      PARENT.set(3, 1);

      const [node] = captureRenderTree();
      expect(node!.children.map((c) => c.id).sort()).toEqual(['2', '3']);
    });
  });

  /**
   * `bounds` derivation from RENDERED_NODES (via getBounds) + `parentElement`
   * hardening. The Ember Inspector uses `bounds`
   * (`{ parentElement, firstNode, lastNode }`) to HIGHLIGHT a component's DOM,
   * so `parentElement` must be the enclosing element and `bounds` must stay
   * `null` (not a malformed object) when the component has no highlightable DOM.
   */
  describe('bounds derivation — parentElement / empty-DOM', () => {
    test('single attached node → parentElement is the enclosing element', () => {
      const el = document.createElement('span');
      container.appendChild(el);
      const comp = makeComponent(1, {
        debugName: 'Single',
        renderedNodes: [el],
      });

      const node = componentToRenderTree(comp)!;
      expect(node.bounds).not.toBe(null);
      expect(node.bounds!.firstNode).toBe(el);
      expect(node.bounds!.lastNode).toBe(el);
      // firstNode.parentNode is already an element → used directly.
      expect(node.bounds!.parentElement).toBe(container);
      expect((node.bounds!.parentElement as Node).nodeType).toBe(1);
    });

    test('comment-marker firstNode → parentElement walks to the enclosing element', () => {
      // GXT roots/branches are typically comment markers; their parentNode is
      // the containing element, which is what highlighting needs.
      const marker = document.createComment('gxt-marker');
      const tail = document.createElement('i');
      container.append(marker, tail);
      const comp = makeComponent(7, {
        debugName: 'Marked',
        renderedNodes: [marker, tail],
      });

      const node = componentToRenderTree(comp)!;
      expect(node.bounds!.firstNode).toBe(marker);
      expect(node.bounds!.lastNode).toBe(tail);
      expect(node.bounds!.parentElement).toBe(container);
      expect((node.bounds!.parentElement as Node).nodeType).toBe(1);
    });

    test('genuinely empty component (no rendered nodes) keeps bounds null', () => {
      const comp = makeComponent(1, { debugName: 'Empty', renderedNodes: [] });
      const node = componentToRenderTree(comp)!;
      expect(node.bounds).toBe(null);
    });

    test('fully detached firstNode (no parent) → bounds null (no shape violation)', () => {
      // A rendered node that is not attached anywhere: it cannot be highlighted
      // and has no parentElement, so bounds must be null rather than a
      // malformed `{ parentElement: null, … }`.
      const orphan = document.createElement('div'); // never appended
      const comp = makeComponent(8, {
        debugName: 'Detached',
        renderedNodes: [orphan],
      });
      const node = componentToRenderTree(comp)!;
      expect(node.bounds).toBe(null);
    });

    test('nodes parented by a DocumentFragment fall back to that parent', () => {
      // Staged-in-fragment component: no element ancestor exists, so
      // parentElement falls back to the immediate (fragment) parent — still a
      // non-null bounds the caller can reason about.
      const frag = document.createDocumentFragment();
      const el = document.createElement('p');
      frag.appendChild(el);
      const comp = makeComponent(9, {
        debugName: 'Fragmented',
        renderedNodes: [el],
      });
      const node = componentToRenderTree(comp)!;
      expect(node.bounds).not.toBe(null);
      expect(node.bounds!.firstNode).toBe(el);
      expect(node.bounds!.parentElement).toBe(
        frag as unknown as Node,
      );
    });
  });

  /**
   * `name` resolution. GXT core only has minification-fragile names
   * (`debugName` / `constructor.name`); the stable registered name is
   * host/registry-owned. The `resolveComponentName` host hook lets the host
   * supply it, consulted BEFORE the gxt fallbacks.
   */
  describe('name resolution — resolveComponentName host hook', () => {
    test('host hook name wins over debugName', () => {
      registerHostHooks({
        resolveComponentName: (c) =>
          (c as { debugName?: string }).debugName === 'MinifiedXe'
            ? 'hello-world'
            : undefined,
      });
      const comp = makeComponent(1, {
        debugName: 'MinifiedXe',
        args: { name: 'a' },
      });
      const node = componentToRenderTree(comp)!;
      expect(node.name).toBe('hello-world');
    });

    test('host hook returning undefined falls back to debugName', () => {
      registerHostHooks({ resolveComponentName: () => undefined });
      const comp = makeComponent(1, { debugName: 'FromDebugName' });
      const node = componentToRenderTree(comp)!;
      expect(node.name).toBe('FromDebugName');
    });

    test('host hook does NOT mask control-flow keyword names (returns undefined for internals)', () => {
      // A host owns real components, not gxt internals — it returns undefined
      // for an IfCondition, so the `if` keyword mapping still applies.
      registerHostHooks({
        resolveComponentName: (c) =>
          (c as { debugName?: string }).debugName?.startsWith('IfCondition')
            ? undefined
            : 'should-not-appear',
      });
      const ifComp = makeComponent(3, {
        debugName: 'IfCondition-1',
        args: { if: true },
      });
      const [node] = captureRenderTree([ifComp]);
      expect(node!.name).toBe('if');
      expect(node!.args.positional).toEqual([true]);
    });
  });
});
