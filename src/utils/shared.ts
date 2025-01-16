import {
  type GenericReturnType,
  type Component,
  type ComponentReturnType,
} from '@/utils/component';
import type { Cell, AnyCell } from './reactive';
import { type BasicListComponent } from './control-flow/list';
import { registerDestructor } from './glimmer/destroyable';

export const isTag = Symbol('isTag');
export const RENDERING_CONTEXT_PROPERTY = Symbol('rendering-context');
export const RENDERED_NODES_PROPERTY = Symbol('nodes');
export const COMPONENT_ID_PROPERTY = Symbol('id');

let componentIdCounter = 1;
export function cId() {
  return componentIdCounter++;
}

export const $template = 'template' as const;
export const $context = '_context' as const;
export const $nodes = 'nodes' as const;
export const $args = 'args' as const;
export const $_debug_args = '_debug_args' as const;
export const $fwProp = '$fw' as const;
export const noop = () => {};
export const FRAGMENT_TYPE = 11; // Node.DOCUMENT_FRAGMENT_NODE

export const IN_SSR_ENV =
  import.meta.env.SSR || location.pathname === '/tests.html';
export const $DEBUG_REACTIVE_CONTEXTS: string[] = [];

export function debugContext(debugName?: string) {
  return [
    ...$DEBUG_REACTIVE_CONTEXTS.filter((el) => el !== 'UnstableChildWrapper'),
    debugName,
  ].join(' > ');
}
export function isArray(value: unknown): value is Array<any> {
  return Array.isArray(value);
}
export function isFn(value: unknown): value is Function {
  return typeof value === 'function';
}
export function isEmpty(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}
export function isPrimitive(value: unknown): value is string | number {
  const vType = typeof value;
  return (
    vType === 'string' ||
    vType === 'number' ||
    vType === 'boolean' ||
    vType === 'bigint'
  );
}

export function isTagLike(child: unknown): child is AnyCell {
  return (child as AnyCell)[isTag];
}


export const BOUNDS = new WeakMap<
  Component<any>,
  Array<HTMLElement | Comment>
>();

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    window['getRenderTree'] = () => {
      return {
        TREE,
        CHILD,
        PARENT,
      }
    };
    window['getParentGraph'] = () => PARENT;
  }
}

export function getBounds(ctx: Component<any>) {
  if (ctx[RENDERED_NODES_PROPERTY].length) {
    return ctx[RENDERED_NODES_PROPERTY].slice(0);
  }
  return BOUNDS.get(ctx) ?? [];
}
export function setBounds(component: ComponentReturnType) {
  if (import.meta.env.SSR) {
    return;
  }
  const ctx = component.ctx;
  if (!ctx) {
    return;
  }
  const maybeBounds: Array<HTMLElement | Comment> = component[$nodes].map(
    (node) => {
      const isHTMLElement = node instanceof HTMLElement;
      if (!isHTMLElement) {
        if (node instanceof Comment) {
          return [node, node.nextSibling];
        } else if (node instanceof DocumentFragment) {
          return [];
        }
      }
      if (isHTMLElement) {
        return [node];
      }
      return [];
    },
  ) as unknown as HTMLElement[];

  const flattenBounds = maybeBounds
    .flat(Infinity)
    .filter((node) => node !== null);
  if (flattenBounds.length === 0) {
    return;
  }
  BOUNDS.set(ctx, flattenBounds);
  registerDestructor(ctx, () => {
    BOUNDS.delete(ctx);
  });
}
const SEEN_TREE_NODES = new WeakSet();
export const TREE: Map<number, Component<any>> = new Map();
export const CHILD: Map<number, Array<number> | undefined> = new Map();
export const PARENT: Map<number, number> = new Map();

export function addToTree(
  ctx: Component<any>,
  node: Component<any>,
  debugName?: string,
) {
  if (SEEN_TREE_NODES.has(node)) {
    if (IS_DEV_MODE) {
      // console.log('node is already added to tree in:', node._debugName, '| and now in |', debugName);
    }
    // GET_ARGS may re-add node to tree (depending on component type)
    return;
    // throw new Error('Node is already added to tree');
  }
  const ID = node[COMPONENT_ID_PROPERTY];
  const PARENT_ID = ctx[COMPONENT_ID_PROPERTY];
  let ch = CHILD.get(PARENT_ID);
  if (ch === undefined) {
    ch = [ID];
    CHILD.set(PARENT_ID, ch);
  } else {
    ch.push(ID);
  }
  TREE.set(ID, node);
  if (WITH_CONTEXT_API) {
    PARENT.set(ID, PARENT_ID);
  }
  SEEN_TREE_NODES.add(node);
  // REF.add(ID);
  // if (node.toString() === '[object Object]') {
  //   debugger;
  // }
  if (IS_DEV_MODE) {
    if ('nodeType' in node) {
      throw new Error('invalid node');
    } else if ('ctx' in node && node.ctx === null) {
      // if it's simple node without context, no needs to add it to the tree as well
      // for proper debug this logic need to be removed
      // it's error prone approach because if we had complex component as child will see memory leak
      throw new Error('invalid node');
    }
    if (debugName) {
      Object.defineProperty(node, '_debugName', {
        value: debugName,
        enumerable: false,
      });
    }
    if (!node) {
      throw new Error('invalid node');
    }
    if (!ctx) {
      throw new Error('invalid ctx');
    }
  }

  // @todo - case 42
  registerDestructor(node, 
    () => {
      // debugger;
      if (IS_DEV_MODE) {
        SEEN_TREE_NODES.delete(node);
      }
      // console.log('deleting', ID);
      // REF.delete(ID);
      CHILD.delete(ID);
      TREE.delete(ID);
      if (WITH_CONTEXT_API) {
        PARENT.delete(ID);
      }
    },
  );
}

/*
HMR stuff
*/

export const LISTS_FOR_HMR: Set<BasicListComponent<any>> = new Set();
export const IFS_FOR_HMR: Set<
  () => { item: GenericReturnType; set: (item: GenericReturnType) => void }
> = new Set();
export const COMPONENTS_HMR = new WeakMap<
  Component | ComponentReturnType,
  Set<{
    parent: any;
    instance: ComponentReturnType;
    args: Record<string, unknown>;
    tags: Cell[];
  }>
>();
