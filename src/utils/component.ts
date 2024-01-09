import { DestructorFn, Destructors } from '@/utils/destroyable';
import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';
import { api } from '@/utils/dom-api';
import { isFn, $template, $nodes, $node, $args, $fwProp, RENDER_TREE } from './shared';

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

// this is workaround for `if` case, where we don't have stable root, and to remove it properly we need to look into last rendered part
export const relatedRoots: WeakMap<DocumentFragment, GenericReturnType> =
  new WeakMap();

function renderNode(parent: Node, target: Node, placeholder: Node | Comment) {
  if (target === undefined) {
    console.warn(`Trying to render undefined`);
    return;
  }
  if (target.nodeType === FRAGMENT_TYPE) {
    if (target.childNodes.length) {
      api.insert(parent, target, placeholder);
    } else {
      const roots = relatedRoots.get(target as DocumentFragment);
      if (roots !== undefined) {
        renderElement(parent, roots, placeholder);
      }
    }
  } else {
    api.insert(parent, target, placeholder);
  }
}

export function renderElement(
  target: Node,
  el: GenericReturnType,
  placeholder: Comment | Node,
) {
  if (!Array.isArray(el)) {
    if (el === null) {
      return;
    }
    if ($nodes in el) {
      el[$nodes].forEach((node) => {
        renderNode(target, node, placeholder);
      });
    } else {
      renderNode(target, el[$node], placeholder);
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
): ComponentReturnType {
  const targetElement = targetFor(target);

  if ($template in component && isFn(component[$template])) {
    return renderComponent(component[$template](), targetElement);
  }
  component[$nodes].forEach((node) => {
    api.append(targetElement, node);
  });
  return component;
}

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;
export class Component<T extends Props = any> implements ComponentReturnType {
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
async function destroyNode(node: Node) {
  if (import.meta.env.DEV) {
    if (node === undefined) {
      console.warn(`Trying to destroy undefined`);
      return;
    } else if (node.nodeType === FRAGMENT_TYPE) {
      const roots = relatedRoots.get(node as DocumentFragment) ?? [];
      await destroyElement(roots);
      relatedRoots.delete(node as DocumentFragment);
      return;
    }
    const parent = node.parentNode;
    if (parent !== null) {
      parent.removeChild(node);
    } else {
      throw new Error(`Node is not in DOM`);
    }
  } else {
    if (node.nodeType === FRAGMENT_TYPE) {
      const roots = relatedRoots.get(node as DocumentFragment) ?? [];
      await destroyElement(roots);
      relatedRoots.delete(node as DocumentFragment);
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
      
      runDestructorsSync(component);
      // @ts-expect-error
      if (component.ctx) {
        // @ts-expect-error
        runDestructorsSync(component.ctx);
      }
      const nodes = component[$nodes];
      let startNode: null | Node = nodes[0];
      const endNode =
        nodes.length === 1 ? null : nodes[nodes.length - 1] || null;
      const nodesToDestroy = [startNode];
      while (true && endNode !== null) {
        startNode = startNode.nextSibling;
        if (startNode === null) {
          break;
        } else if (startNode === endNode) {
          nodesToDestroy.push(endNode);
          break;
        } else {
          nodesToDestroy.push(startNode);
        }
      }
      try {
        nodesToDestroy.map(destroyNode);
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
    const destructors: Array<Promise<void>> = [];
    if ($nodes in component) {
      runDestructors(component as ComponentReturnType, destructors);
      // @ts-expect-error
      if (component.ctx) {
        // @ts-expect-error
        runDestructors(component.ctx);
      }
      const nodes = component[$nodes];
      let startNode: null | Node = nodes[0];
      const endNode =
        nodes.length === 1 ? null : nodes[nodes.length - 1] || null;
      const nodesToDestroy = [startNode];
      while (true && endNode !== null) {
        startNode = startNode.nextSibling;
        if (startNode === null) {
          break;
        } else if (startNode === endNode) {
          nodesToDestroy.push(endNode);
          break;
        } else {
          nodesToDestroy.push(startNode);
        }
      }
      await Promise.all(destructors);
      try {
        await Promise.all(nodesToDestroy.map(destroyNode));
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

window['getDestructors'] = () => $newDestructors;

export function associateDestroyable(ctx: any, destructors: Destructors) {
  if (destructors.length === 0) {
    return;
  }
  const oldDestructors = $newDestructors.get(ctx) || [];
  $newDestructors.set(ctx, [...oldDestructors, ...destructors]);
}

export function removeDestructor(ctx: any, destructor: DestructorFn) {
  const oldDestructors = $newDestructors.get(ctx) || [];
  $newDestructors.set(
    ctx,
    oldDestructors.filter((fn) => fn !== destructor),
  );
}

function runDestructorsSync(targetNode: ComponentReturnType) {
  if ($newDestructors.has(targetNode)) {
    $newDestructors.get(targetNode)!.forEach((fn) => {
      fn();
    });
    $newDestructors.delete(targetNode);
  }
  RENDER_TREE.get(targetNode)?.forEach((node) => {
    if ($nodes in node) {
      runDestructorsSync(node);
    }
    RENDER_TREE.delete(node as any);
  });
  RENDER_TREE.delete(targetNode);
}
export function runDestructors(
  target: ComponentReturnType,
  promises: Array<Promise<void>> = [],
): Array<Promise<void>> {
  if (!($nodes in target)) {
    console.info(`Trying to run destructors on non-component`);
    return promises;
  }
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
  RENDER_TREE.get(target)?.forEach((node) => {
    if ($nodes in node) {
      runDestructors(node, promises);
    }
    RENDER_TREE.delete(node as any);
  });
  RENDER_TREE.delete(target);
  return promises;
}

export function targetFor(
  outlet: ComponentRenderTarget,
): HTMLElement | DocumentFragment {
  if (outlet instanceof HTMLElement || outlet instanceof DocumentFragment) {
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
