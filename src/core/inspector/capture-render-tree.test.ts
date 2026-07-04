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
});
