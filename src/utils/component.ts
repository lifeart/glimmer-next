import { destroy, DestructorFn, Destructors } from '@/utils/glimmer/destroyable';
import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';
import { api } from '@/utils/dom-api';
import {
  isFn,
  $template,
  $nodes,
  $args,
  $fwProp,
  RENDER_TREE,
  isPrimitive,
  isArray,
  isEmpty,
  FRAGMENT_TYPE,
  PARENT_GRAPH,
} from './shared';
import { addChild, getRoot, setRoot } from './dom';

export type ComponentRenderTarget =
  | HTMLElement
  | DocumentFragment
  | ComponentReturnType;

export type GenericReturnType =
  | ComponentReturnType
  | Node
  | Array<ComponentReturnType | Node>
  | null
  | null[];

function renderNode(parent: Node, target: Node, placeholder: Node | Comment) {
  if (import.meta.env.DEV) {
    if (isEmpty(target)) {
      console.warn(`Trying to render ${typeof target}`);
      return;
    }
    if (parent === null) {
      console.warn(`Trying to render null parent`);
      return;
    }
  }
  api.insert(parent, target, placeholder);
}

export function renderElement(
  target: Node,
  el: GenericReturnType | Node | string | number | null | undefined,
  placeholder: Comment | Node,
) {
  if (!isArray(el)) {
    if (isEmpty(el) || el === '') {
      return;
    }
    if (isPrimitive(el)) {
      renderNode(target, api.text(el), placeholder);
    } else if ($nodes in el) {
      el[$nodes].forEach((node) => {
        renderElement(target, node, placeholder);
      });
    } else if (isFn(el)) {
      renderElement(target, el(), placeholder);
    } else {
      renderNode(target, el, placeholder);
    }
  } else {
    el.forEach((item) => {
      renderElement(target, item, placeholder);
    });
  }
}

export function renderComponent(
  component: ComponentReturnType,
  target: ComponentRenderTarget,
  owner?: any,
  skipRoot?: boolean,
): ComponentReturnType {
  if (import.meta.env.DEV) {
    if (target === undefined) {
      throw new Error(`Trying to render undefined`);
    }
  }
  const targetElement = targetFor(target);
  const appRoot = getRoot();

  if (!skipRoot) {
    if (appRoot !== null && appRoot !== owner) {
      if (import.meta.env.DEV) {
        throw new Error(`Root already exists, it may lead to memory leaks, 
          at the moment we allow only one root. Let us know if you need more.
          To manually fix this issue you may save existing root reference and cleanup root.
          try "getRoot()" to resolve root reference for last rendered root component,
          and once you get it, call "resetRoot", and try to re-render component one more time.
        `);
      }
    } else {
      if (appRoot === null) {
        setRoot(owner || component.ctx || (component as any));
      }
    }
  }



  if ($template in component && isFn(component[$template])) {
    return renderComponent(component[$template](), targetElement, component, true);
  }

  const destructors: Destructors = [];
  const children = component[$nodes];

  if (TRY_CATCH_ERROR_HANDLING) {
    try {
      children.forEach((child, i) => {
        addChild(
          targetElement as unknown as HTMLElement,
          child as any,
          destructors,
          i,
        );
      });
      associateDestroyable(owner || component, destructors);
    } catch (e) {
      destructors.forEach((fn) => fn());
      runDestructorsSync(owner || component);
      throw e;
    }
  } else {
    children.forEach((child, i) => {
      addChild(
        targetElement as unknown as HTMLElement,
        child as any,
        destructors,
        i,
      );
    });
    associateDestroyable(owner || component, destructors);
  }

  return component;
}

export type Props = Record<string, unknown>;


type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;
export class Component<T extends Props = any>
  implements Omit<ComponentReturnType, 'ctx'>
{
  args!: Get<T, 'Args'>;
  declare [Context]: TemplateContext<
    this,
    Get<T, 'Args'>,
    Get<T, 'Blocks'>,
    Get<T, 'Element', null>
  >;
  declare [Invoke]: (
    args?: Get<T, 'Args'>,
  ) => ComponentReturn<Get<T, 'Blocks'>, Get<T, 'Element', null>>;
  nodes!: Node[];
  $fw: unknown;
  constructor(props: Get<T, 'Args'>, fw?: unknown) {
    this[$args] = props;
    this[$fwProp] = fw;
  }
  template!: ComponentReturnType;
}

export type TOC<S extends Props = {}>  = (args?: Get<S, 'Args'>) => ComponentReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>

function destroyNode(node: Node) {
  if (IS_DEV_MODE) {
    if (node === undefined) {
      console.warn(`Trying to destroy undefined`);
      return;
    } else if (node.nodeType === FRAGMENT_TYPE) {
      return;
    }
    const parent = node.parentNode;
    if (parent !== null) {
      parent.removeChild(node);
    } else {
      if (import.meta.env.SSR) {
        console.warn(`Node is not in DOM`, node.nodeType, node.nodeName);
        return;
      }
      throw new Error(`Node is not in DOM`);
    }
  } else {
    if (node.nodeType === FRAGMENT_TYPE) {
      return;
    }
    node.parentNode!.removeChild(node);
  }
}

export function destroyElementSync(
  component:
    | ComponentReturnType
    | Node
    | Array<ComponentReturnType | Node>
    | null
    | null[],
  skipDom = false
) {
  if (isArray(component)) {
    component.forEach((component) => destroyElementSync(component, skipDom));
  } else {
    if (isEmpty(component)) {
      return;
    }

    if ($nodes in component) {
      if (component.ctx !== null) {
        runDestructorsSync(component.ctx);
      }
      if (skipDom) {
        return;
      }
      try {
        destroyNodes(component[$nodes]);
      } catch (e) {
        console.warn(
          `Woops, looks like node we trying to destroy no more in DOM 1`,
          e,
        );
      }
    } else {
      destroyNode(component);
    }
  }
}

function internalDestroyNode(el: Node | ComponentReturnType) {
  if ('nodeType' in el) {
    destroyNode(el);
  } else {
    destroyNodes(el[$nodes]);
  }
}

function destroyNodes(
  roots: Node | ComponentReturnType | Array<Node | ComponentReturnType>,
) {
  if (isArray(roots)) {
    for (let i = 0; i < roots.length; i++) {
      internalDestroyNode(roots[i]);
    }
  } else {
    internalDestroyNode(roots);
  }
}

export async function destroyElement(
  component:
    | ComponentReturnType
    | Node
    | Array<ComponentReturnType | Node>
    | null
    | null[],
) {
  if (isArray(component)) {
    await Promise.all(component.map((component) => destroyElement(component)));
  } else {
    if (component === null) {
      return;
    }
    if ($nodes in component) {
      if (component.ctx) {
        const destructors: Array<Promise<void>> = [];
        runDestructors(component.ctx, destructors);
        await Promise.all(destructors);
      }
      try {
        destroyNodes(component[$nodes]);
      } catch (e) {
        console.warn(
          `Woops, looks like node we trying to destroy no more in DOM 2`,
          e,
        );
      }
    } else {
      await destroyNode(component);
    }
  }
}

var $newDestructors = new WeakMap<any, Destructors>();

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    window['getDestructors'] = () => $newDestructors;
  }
}

export function associateDestroyable(ctx: any, destructors: Destructors) {
  if (destructors.length === 0) {
    return;
  }

  if (IS_DEV_MODE) {
    if (ctx.ctx && ctx.ctx !== ctx) {
      throw new Error(`Invalid context`);
    }
  }
  const oldDestructors = $newDestructors.get(ctx) || [];
  oldDestructors.push(...destructors);
  $newDestructors.set(ctx, oldDestructors);
}

export function removeDestructor(ctx: any, destructor: DestructorFn) {
  if (IS_DEV_MODE) {
    if (ctx.ctx && ctx.ctx !== ctx) {
      throw new Error(`Invalid context`);
    }
  }
  const oldDestructors = $newDestructors.get(ctx) || [];
  $newDestructors.set(
    ctx,
    oldDestructors.filter((fn) => fn !== destructor),
  );
}

function runDestructorsSync(targetNode: Component<any>) {
  destroy(targetNode);
  if ($newDestructors.has(targetNode)) {
    $newDestructors.get(targetNode)!.forEach((fn) => {
      fn();
    });
    $newDestructors.delete(targetNode);
  }
  if (WITH_CONTEXT_API) {
    PARENT_GRAPH.delete(targetNode);
  }
  const nodesToRemove = RENDER_TREE.get(targetNode);
  if (nodesToRemove) {
    /*
      we need slice here because of search for it:
      @todo - case 42 (associateDestroyable)
      tldr list may be mutated during removal and forEach is stopped
    */
    Array.from(nodesToRemove).forEach((node) => {
      runDestructorsSync(node);
      // RENDER_TREE.delete(node as any);
    });
    // RENDER_TREE.delete(targetNode);
  }
}
export function runDestructors(
  target: Component<any>,
  promises: Array<Promise<void>> = [],
): Array<Promise<void>> {
  destroy(target);
  if ($newDestructors.has(target)) {
    $newDestructors.get(target)!.forEach((fn) => {
      const promise = fn();
      if (promise) {
        promises.push(promise);
      }
    });
    $newDestructors.delete(target);
  } else {
    // console.info(`No destructors found for component`);
  }
  if (WITH_CONTEXT_API) {
    PARENT_GRAPH.delete(target);
  }
  const nodesToRemove = RENDER_TREE.get(target);
  if (nodesToRemove) {
    /*
      we need slice here because of search for it:
      @todo - case 42 (associateDestroyable)
      tldr list may be mutated during removal and forEach is stopped
    */
    Array.from(nodesToRemove).forEach((node) => {
      runDestructors(node, promises);
      // RENDER_TREE.delete(node as any);
    });
    // RENDER_TREE.delete(target);
  }
  return promises;
}

export function targetFor(
  outlet: ComponentRenderTarget,
): HTMLElement | DocumentFragment {
  if ('nodeType' in outlet) {
    return outlet;
  } else {
    return outlet[$nodes][0] as HTMLElement;
  }
}

export type Slots = Record<
  string,
  (
    ...params: unknown[]
  ) => Array<ComponentReturnType | Node | Comment | string | number>
>;
export type ComponentReturnType = {
  nodes: Node[];
  ctx: Component<any> | null;
};