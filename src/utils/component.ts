import { DestructorFn, Destructors } from '@/utils/destroyable';
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
  $node,
  $args,
  $fwProp,
  RENDER_TREE,
  isPrimitive,
} from './shared';
import { addChild, getRoot, setRoot } from './dom';

const FRAGMENT_TYPE = 11; // Node.DOCUMENT_FRAGMENT_NODE

export type ComponentRenderTarget =
  | HTMLElement
  | DocumentFragment
  | ComponentReturnType;

export type GenericReturnType =
  | ComponentReturnType
  | NodeReturnType
  | Array<ComponentReturnType | NodeReturnType>
  | null
  | null[];

function renderNode(parent: Node, target: Node, placeholder: Node | Comment) {
  if (import.meta.env.DEV) {
    if (target === undefined || target === null) {
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
  if (!Array.isArray(el)) {
    if (el === null || el === undefined || el === '') {
      return;
    }
    if (isPrimitive(el)) {
      // @ts-expect-error
      renderNode(target, api.text(el), placeholder);
    } else if ($node in el) {
      renderNode(target, el[$node], placeholder);
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
  ctx?: any,
): ComponentReturnType {
  if (import.meta.env.DEV) {
    if (target === undefined) {
      throw new Error(`Trying to render undefined`);
    }
  }
  const targetElement = targetFor(target);

  if ($template in component && isFn(component[$template])) {
    return renderComponent(component[$template](), targetElement, component);
  }
  if (getRoot() !== null) {
    if (import.meta.env.DEV) {
      throw new Error(`Root already exists, it may lead to memory leaks, 
        at the moment we allow only one root. Let us know if you need more.
        To manually fix this issue you may save existing root reference and cleanup root.
        try "getRoot()" to resolve root reference for last rendered root component,
        and once you get it, call "resetRoot", and try to re-render component one more time.
      `);
    }
  } else {
    setRoot(component.ctx || (component as any));
  }

  const destructors: Destructors = [];
  const children = component[$nodes];
  try {
    children.forEach((child, i) => {
      addChild(
        targetElement as unknown as HTMLElement,
        child as any,
        destructors,
        i,
      );
    });
    associateDestroyable(ctx || component, destructors);
  } catch (e) {
    destructors.forEach((fn) => fn());
    runDestructorsSync(ctx || component);
    throw e;
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
    args: Get<T, 'Args'>,
  ) => ComponentReturn<Get<T, 'Blocks'>, Get<T, 'Element', null>>;
  nodes!: Node[];
  index!: number;
  slots!: Slots;
  $fw: unknown;
  constructor(props: Get<T, 'Args'>, fw?: unknown) {
    this[$args] = props;
    this[$fwProp] = fw;
  }
  template!: ComponentReturnType;
}

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
    | NodeReturnType
    | Array<ComponentReturnType | NodeReturnType>
    | null
    | null[],
) {
  if (Array.isArray(component)) {
    component.map((component) => destroyElementSync(component));
  } else {
    if (component === null) {
      return;
    }

    if ($nodes in component) {
      if (component.ctx !== null) {
        runDestructorsSync(component.ctx);
      }
      try {
        destroyNodes(component[$nodes]);
      } catch (e) {
        console.warn(
          `Woops, looks like node we trying to destroy no more in DOM`,
          e,
        );
      }
    } else {
      destroyNode(component[$node]);
    }
  }
}

function internalDestroyNode(el: Node | ComponentReturnType | NodeReturnType) {
  if ('nodeType' in el) {
    destroyNode(el);
  } else if ($nodes in el) {
    destroyNodes(el[$nodes]);
  } else {
    destroyNode(el[$node]);
  }
}

function destroyNodes(
  roots:
    | Node
    | ComponentReturnType
    | NodeReturnType
    | Array<Node | ComponentReturnType | NodeReturnType>,
) {
  if (Array.isArray(roots)) {
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
    | NodeReturnType
    | Array<ComponentReturnType | NodeReturnType>
    | null
    | null[],
) {
  if (Array.isArray(component)) {
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
          `Woops, looks like node we trying to destroy no more in DOM`,
          e,
        );
      }
    } else {
      await destroyNode(component[$node]);
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
  if ($newDestructors.has(targetNode)) {
    $newDestructors.get(targetNode)!.forEach((fn) => {
      fn();
    });
    $newDestructors.delete(targetNode);
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
  ) => Array<ComponentReturnType | NodeReturnType | Comment | string | number>
>;
export type ComponentReturnType = {
  nodes: Node[];
  index: number;
  ctx: Component<any> | null;
  slots: Slots;
};
export type NodeReturnType = {
  node: Node;
  index: number;
};
const noop = () => {};

export function addEventListener(
  node: Node,
  eventName: string,
  fn: EventListener,
) {
  node.addEventListener(eventName, fn);
  if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
    return () => {
      node.removeEventListener(eventName, fn);
    };
  } else {
    return noop;
  }
}
