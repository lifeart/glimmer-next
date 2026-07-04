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

function boundsFor(component: ComponentLike): CapturedRenderNodeBounds | null {
  const possibleBounds = component ? getBounds(component) : [];
  if (possibleBounds.length === 1) {
    const node = possibleBounds[0]!;
    return { firstNode: node, lastNode: node, parentElement: node.parentNode! };
  } else if (possibleBounds.length > 1) {
    const first = possibleBounds[0]!;
    const last = possibleBounds[possibleBounds.length - 1]!;
    return {
      firstNode: first,
      lastNode: last,
      parentElement: first.parentNode!,
    };
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
): void {
  for (const el of keyMap.values()) {
    if (Array.isArray(el)) {
      el.forEach((e) => {
        if (e && !('nodeType' in (e as object))) {
          const node = componentToRenderTree(e as ComponentLike);
          if (node) children.push(node);
        }
      });
    } else if (el && !('nodeType' in (el as object))) {
      const node = componentToRenderTree(el as ComponentLike);
      if (node) children.push(node);
    }
  }
}

/**
 * Serialize a single GXT component (and its subtree) into a
 * {@link CapturedRenderNode}. Returns `null` for a nullish input.
 */
export function componentToRenderTree(
  component: ComponentLike,
): CapturedRenderNode | null {
  if (!component) {
    return null;
  }
  const anyComponent = component as unknown as Record<string | symbol, any>;

  const childs = Array.from(
    CHILD.get(component[COMPONENT_ID_PROPERTY]) ?? new Set<number>(),
    (id) => TREE.get(id),
  );

  // `{{#if}}` with no tree children may still hold a rendered branch on
  // `prevComponent` (single component or array) — surface it as a child.
  if (childs.length === 0 && component instanceof IfCondition) {
    if (isArray(component.prevComponent)) {
      component.prevComponent.forEach((c) => {
        if (c && RENDERED_NODES_PROPERTY in (c as object)) {
          childs.push(c as ComponentLike);
        }
      });
    } else if (
      component.prevComponent &&
      RENDERED_NODES_PROPERTY in (component.prevComponent as object)
    ) {
      childs.push(component.prevComponent as unknown as ComponentLike);
    }
  }

  let componentName: string =
    anyComponent.debugName || component.constructor.name || '(unknown)';

  const hasArgs = $args in component;
  const hasDebugArgs = $_debug_args in component;
  const hasArgsOrDebugArgs = hasArgs || hasDebugArgs;

  const argsToHide: string[] = [];
  const argsToAdd: Array<[string, unknown]> = [];
  const positional: unknown[] = [];

  const bounds = boundsFor(component);

  const children: CapturedRenderNode[] = childs
    .map((child) => (child ? componentToRenderTree(child) : null))
    .filter((el): el is CapturedRenderNode => el !== null);

  // GXT's internal `UnstableChildWrapper` is a transparent single-child block
  // wrapper — collapse it so it is not a user-visible render node.
  if (
    componentName.startsWith('UnstableChildWrapper') &&
    children.length === 1
  ) {
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
      pushListRows(component.keyMap, children);
    }
  } else if (componentName.startsWith('ListComponent')) {
    componentName = 'each';
    argsToHide.push('list');
    positional.push(allArgs()['list']?.value);
    if (component instanceof SyncListComponent) {
      pushListRows(component.keyMap, children);
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
  return rootComponents
    .map((root) => componentToRenderTree(root))
    .filter((el): el is CapturedRenderNode => el !== null);
}
