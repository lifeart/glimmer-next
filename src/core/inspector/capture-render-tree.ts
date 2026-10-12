/**
 * captureRenderTree — serialize GXT's component TREE into the Ember
 * `captureRenderTree` node shape ({ id, type, name, args, instance, template,
 * bounds, children }) consumed by the Ember Inspector and `@ember/debug`.
 *
 * GXT already owns every input this needs:
 *   - the component TREE / CHILD / PARENT maps (src/core/tree.ts),
 *   - per-component DOM BOUNDS (getBounds → firstNode / lastNode /
 *     parentElement),
 *   - captured args ($args / $_debug_args),
 *   - name resolution (debugName, plus if / each / yield / svg mapping).
 *
 * This module is the single source of truth for that serialization: the dev
 * Ember Inspector shim (ember-inspector.ts `Ember._captureRenderTree`) and the
 * Ember dual-backend bridge both delegate here, so the bridge no longer needs
 * its own parallel hand-rolled `DebugRenderTree`.
 *
 * SCOPE / DIVERGENCE FROM CLASSIC EMBER: GXT models control flow
 * ({{#if}} / {{#each}} / yield) and the render Root as component nodes — there
 * is no separate outlet / route-template / engine / modifier node kind in
 * GXT's tree (those are Ember-routing / Glimmer-VM constructs GXT does not
 * own). The emitted `type` is therefore always `'component'`; the node `name`
 * carries the `'if'` / `'each'` / `'yield'` distinction. This matches exactly
 * what the Ember Inspector has always received from GXT.
 */
import {
  $args,
  $_debug_args,
  CHILD,
  COMPONENT_ID_PROPERTY,
  getBounds,
  isArray,
  PARENT,
  RENDERED_NODES_PROPERTY,
  TREE,
  type ComponentLike,
} from '../shared';
import { IfCondition } from '../control-flow/if';
import { AsyncListComponent, SyncListComponent } from '../control-flow/list';
import { HOST_HOOKS } from '../host-hooks';
import { isNativeRuntime } from '../native-content';

const ELEMENT_NODE = 1;

/**
 * The nearest ELEMENT ancestor of `node` (its enclosing element) — the value
 * Ember/`@glimmer/interfaces` `CapturedBounds.parentElement` must be a
 * `SimpleElement`. `node.parentNode` is usually already the containing element
 * (a comment/text/element marker attached to the DOM), but it can be a
 * `DocumentFragment` (a component staged in a fragment) or the `Document`, and
 * for a detached node it is `null`. Walking up to the first real element keeps
 * `bounds.parentElement` highlightable in the Inspector; returns `null` when
 * `node` has no element ancestor at all (fully detached).
 */
function nearestParentElement(node: Node): Node | null {
  let current: Node | null = node.parentNode;
  while (current && current.nodeType !== ELEMENT_NODE) {
    current = current.parentNode;
  }
  return current;
}

/**
 * DOM bounds for a captured node — the Ember `CapturedRenderNode['bounds']`
 * shape. `parentElement` is typed as `Node` (GXT does not depend on
 * `@simple-dom`); at runtime it is the parent element of `firstNode`.
 */
export interface CapturedRenderNodeBounds {
  parentElement: Node;
  firstNode: Node;
  lastNode: Node;
}

/**
 * The Ember `captureRenderTree` node shape (mirrors
 * `@glimmer/interfaces` `CapturedRenderNode`).
 */
export interface CapturedRenderNode {
  id: string;
  type:
    | 'outlet'
    | 'engine'
    | 'route-template'
    | 'component'
    | 'modifier'
    | 'keyword';
  name: string;
  args: {
    positional: unknown[];
    named: Record<string, unknown>;
  };
  instance: unknown;
  template: string | null;
  bounds: CapturedRenderNodeBounds | null;
  children: CapturedRenderNode[];
}

/**
 * Derive the DOM `bounds` of a component from the nodes GXT tracks for it
 * (`RENDERED_NODES_PROPERTY`, via {@link getBounds} — which also carries the
 * `BOUNDS` weakmap fallback). `firstNode` / `lastNode` are the first / last
 * rendered node; `parentElement` is the nearest ENCLOSING ELEMENT of
 * `firstNode` (see {@link nearestParentElement}).
 *
 * Returns `null` only when the component genuinely has no DOM to point at — it
 * rendered no nodes, OR its nodes are fully detached (no element ancestor and
 * no parent to anchor highlighting to). A single-node component collapses to
 * `firstNode === lastNode`.
 */
function boundsFor(component: ComponentLike): CapturedRenderNodeBounds | null {
  const possibleBounds = component ? getBounds(component) : [];
  if (possibleBounds.length === 0) {
    return null;
  }
  let firstNode = possibleBounds[0]!;
  let lastNode = possibleBounds[possibleBounds.length - 1]!;
  if (isNativeRuntime()) {
    // The rendered list may start / end with a nested COMPONENT (a route
    // template under an outlet, a content unit): its first / last DOM node.
    const first = edgeDomNode(possibleBounds, true);
    const last = edgeDomNode(possibleBounds, false);
    if (first === null || last === null) return null;
    firstNode = first as HTMLElement | Comment;
    lastNode = last as HTMLElement | Comment;
  }
  // Prefer the nearest real element ancestor (interface: `parentElement` is a
  // `SimpleElement`); fall back to the immediate parent (fragment / document)
  // so a component with attached-but-non-element-parented nodes still yields
  // bounds. `null` parent → fully detached → no bounds.
  const parentElement = nearestParentElement(firstNode) ?? firstNode.parentNode;
  if (!parentElement) {
    return null;
  }
  return { firstNode, lastNode, parentElement };
}

/**
 * The first (`fromStart`) / last DOM node of a rendered-nodes list, descending
 * into nested components' rendered nodes; `null` when it holds no DOM node.
 */
function edgeDomNode(items: ReadonlyArray<unknown>, fromStart: boolean): Node | null {
  const length = items.length;
  for (let i = 0; i < length; i++) {
    const item = items[fromStart ? i : length - 1 - i] as Record<PropertyKey, unknown> | null;
    if (item === null || typeof item !== 'object') continue;
    if (typeof (item as unknown as Node).nodeType === 'number') return item as unknown as Node;
    const nested = item[RENDERED_NODES_PROPERTY];
    if (Array.isArray(nested)) {
      const found = edgeDomNode(nested, fromStart);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Push a keyed-list's per-row body components (from its `keyMap`) as children.
 * Row entries can be a single component or an array of components; DOM nodes
 * (which carry `nodeType`) are skipped.
 */
function pushListRows(
  keyMap: Map<string, any>,
  children: CapturedRenderNode[],
  visited: Set<ComponentLike>,
): void {
  for (const el of keyMap.values()) {
    if (Array.isArray(el)) {
      el.forEach((e) => {
        if (e && !('nodeType' in (e as object))) {
          const node = componentToRenderTree(e as ComponentLike, visited);
          if (node) children.push(node);
        }
      });
    } else if (el && !('nodeType' in (el as object))) {
      const node = componentToRenderTree(el as ComponentLike, visited);
      if (node) children.push(node);
    }
  }
}

/**
 * Serialize a single GXT component (and its subtree) into a
 * {@link CapturedRenderNode}. Returns `null` for a nullish input.
 *
 * @param visited the set of components currently on the walk path — used to
 *   break cycles / back-edges (see the guard below). Callers normally omit
 *   this; {@link captureRenderTree} threads a shared set across roots.
 */
export function componentToRenderTree(
  component: ComponentLike,
  visited: Set<ComponentLike> = new Set(),
): CapturedRenderNode | null {
  if (!component) {
    return null;
  }
  // Cycle / back-edge guard.
  //
  // The bridged (Ember dual-backend) component graph is NOT a strict tree: a
  // CHILD set can point back at an ancestor, and an `{{#if}}`'s `prevComponent`
  // leaf-fallback (below) can follow a sibling/ancestor back-edge. A render-tree
  // walk must visit each node at most once on any given path; without this
  // guard the walk follows the back-edge and recurses until the JS stack
  // overflows (`RangeError: Maximum call stack size exceeded`). We add the node
  // to the path on entry and remove it before every return so that legitimate
  // sibling subtrees (a node reachable via two non-ancestor paths) are still
  // captured — only true cycles are pruned.
  if (visited.has(component)) {
    return null;
  }
  visited.add(component);

  const anyComponent = component as unknown as Record<string | symbol, any>;

  const childs = Array.from(
    CHILD.get(component[COMPONENT_ID_PROPERTY]) ?? new Set<number>(),
    (id) => TREE.get(id),
  );

  // `{{#if}}` with no tree children may still hold a rendered branch on
  // `prevComponent` (single component or array) — surface it as a child. Skip
  // any `prevComponent` that is already on the walk path: that back-edge is the
  // stack-overflow trigger described above.
  if (childs.length === 0 && component instanceof IfCondition) {
    if (isArray(component.prevComponent)) {
      component.prevComponent.forEach((c) => {
        if (
          c &&
          RENDERED_NODES_PROPERTY in (c as object) &&
          !visited.has(c as unknown as ComponentLike)
        ) {
          childs.push(c as ComponentLike);
        }
      });
    } else if (
      component.prevComponent &&
      RENDERED_NODES_PROPERTY in (component.prevComponent as object) &&
      !visited.has(component.prevComponent as unknown as ComponentLike)
    ) {
      childs.push(component.prevComponent as unknown as ComponentLike);
    }
  }

  // Name resolution, host-first. GXT core only has minification-fragile names
  // (`debugName` — DEV-only, itself `constructor.name` — and the minified
  // runtime `constructor.name`). The stable registered name (Ember's
  // `"hello-world"`) is host/registry-owned, so consult the host hook FIRST.
  // The hook returns `undefined` for GXT-internal control-flow/wrapper
  // instances, so their `debugName` prefixes below still reclassify them into
  // the `if` / `each` / `yield` / `svg` keyword names.
  const hostName = HOST_HOOKS.resolveComponentName
    ? HOST_HOOKS.resolveComponentName(component)
    : undefined;
  let componentName: string =
    hostName ||
    anyComponent.debugName ||
    component.constructor.name ||
    '(unknown)';

  const hasArgs = $args in component;
  const hasDebugArgs = $_debug_args in component;
  const hasArgsOrDebugArgs = hasArgs || hasDebugArgs;

  const argsToHide: string[] = [];
  const argsToAdd: Array<[string, unknown]> = [];
  const positional: unknown[] = [];

  const bounds = boundsFor(component);

  const children: CapturedRenderNode[] = childs
    .map((child) => (child ? componentToRenderTree(child, visited) : null))
    .filter((el): el is CapturedRenderNode => el !== null);

  // GXT's internal `UnstableChildWrapper` is a transparent single-child block
  // wrapper — collapse it so it is not a user-visible render node. Not under
  // the Ember native runtime: the host flattens every node it has no name for
  // itself, and keys what the wrapper's elements carry (their modifiers'
  // render nodes) by the wrapper, so it needs the wrapper's node.
  if (
    componentName.startsWith('UnstableChildWrapper') &&
    children.length === 1 &&
    !isNativeRuntime()
  ) {
    visited.delete(component);
    return children[0]!;
  }

  const allArgs = (): Record<string, any> => {
    if ($_debug_args in component) {
      return (anyComponent[$_debug_args] ?? {}) as Record<string, any>;
    }
    return (anyComponent[$args] ?? {}) as Record<string, any>;
  };

  if (componentName.startsWith('IfCondition')) {
    componentName = 'if';
    argsToHide.push('if');
    positional.push(allArgs()['if']);
  } else if (componentName.startsWith('AsyncListComponent')) {
    componentName = 'each';
    argsToAdd.push(['async', true]);
    argsToHide.push('list');
    positional.push(allArgs()['list']?.value);
    if (component instanceof AsyncListComponent) {
      pushListRows(component.keyMap, children, visited);
    }
  } else if (componentName.startsWith('ListComponent')) {
    componentName = 'each';
    argsToHide.push('list');
    positional.push(allArgs()['list']?.value);
    if (component instanceof SyncListComponent) {
      pushListRows(component.keyMap, children, visited);
    }
  }

  if (componentName.startsWith('slot:')) {
    positional.push(...anyComponent.debugInfo.params());
    if (positional.length) {
      componentName = 'yield';
      argsToAdd.push(['to', anyComponent.debugInfo.name]);
    } else {
      componentName = `:${anyComponent.debugInfo.name}`;
    }
  }

  if (componentName.startsWith('SVGProvider')) {
    componentName = 'svg';
    children.length = 0;
  }

  // Build a PLAIN, resolved named-args object. The Ember shape expects a
  // serializable map (deep-equal-able) — not a lazy getter — and we must never
  // mutate the live component args, so copy into a fresh object.
  const named: Record<string, unknown> = {};
  if (hasArgsOrDebugArgs) {
    const src = allArgs();
    for (const key of Object.keys(src)) {
      if (argsToHide.includes(key)) continue;
      named[key] = src[key];
    }
    for (const [key, value] of argsToAdd) {
      named[key] = value;
    }
  }

  // Done with this node — pop it off the walk path so genuine sibling
  // subtrees that reach a shared node via a non-ancestor path are not pruned.
  visited.delete(component);

  return {
    id: String(component[COMPONENT_ID_PROPERTY]),
    type: 'component',
    name: componentName,
    args: { positional, named },
    instance: component,
    template: null,
    bounds,
    children,
  };
}

/**
 * The render Root(s) are the tree nodes registered with a `null` parent
 * (`src/core/root.ts`). Mirrors the historical Inspector root-walk.
 */
function findRoots(): ComponentLike[] {
  const rootIds: number[] = [];
  PARENT.forEach((ref, id) => {
    if (ref === null) {
      rootIds.push(id);
    }
  });
  return rootIds
    .map((id) => TREE.get(id))
    .filter((c): c is ComponentLike => c !== undefined);
}

/**
 * Capture the current render tree in the Ember `CapturedRenderNode[]` shape.
 *
 * @param roots optional explicit root components; when omitted the render
 *   Root(s) are discovered from the tree ({@link findRoots}).
 */
export function captureRenderTree(
  roots?: ComponentLike[],
): CapturedRenderNode[] {
  const rootComponents = roots ?? findRoots();
  // Share one path-set across the roots. Roots are disjoint (each has a `null`
  // parent) and the set is emptied by backtracking between roots, so this only
  // serves to break cycles within any single root's subtree.
  const visited = new Set<ComponentLike>();
  return rootComponents
    .map((root) => componentToRenderTree(root, visited))
    .filter((el): el is CapturedRenderNode => el !== null);
}
