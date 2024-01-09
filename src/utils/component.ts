import { Destructors } from '@/utils/destroyable';
import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';
import { api } from '@/utils/dom-api';
import { isFn, $template, $nodes, $node, $args, $fwProp } from './shared';

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
      const nodes = component[$nodes];
      let startNode: null | Node = nodes[0];
      const endNode =
        nodes.length === 1 ? null : nodes[nodes.length - 1] || null;
      const nodesToDestroy = [startNode];
      runDestructorsSync(startNode);
      while (true && endNode !== null) {
        startNode = startNode.nextSibling;
        if (startNode === null) {
          break;
        } else if (startNode === endNode) {
          nodesToDestroy.push(endNode);
          runDestructorsSync(endNode);
          break;
        } else {
          nodesToDestroy.push(startNode);
          runDestructorsSync(startNode);
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
      runDestructorsSync(component[$node]);
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
    if ($nodes in component) {
      const destructors: Array<Promise<void>> = [];
      const nodes = component[$nodes];
      let startNode: null | Node = nodes[0];
      const endNode =
        nodes.length === 1 ? null : nodes[nodes.length - 1] || null;
      const nodesToDestroy = [startNode];
      runDestructors(startNode, destructors);
      while (true && endNode !== null) {
        startNode = startNode.nextSibling;
        if (startNode === null) {
          break;
        } else if (startNode === endNode) {
          nodesToDestroy.push(endNode);
          runDestructors(endNode, destructors);
          break;
        } else {
          nodesToDestroy.push(startNode);
          runDestructors(startNode, destructors);
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
      await Promise.all(runDestructors(component[$node]));
      await destroyNode(component[$node]);
    }
  }
}

var $destructors = new WeakMap<Node, Destructors>();

window['getDestructors'] = () => $destructors;

function getNode(el: Node): Node {
  if (el.nodeType === FRAGMENT_TYPE) {
    return (el as DocumentFragment).lastChild!;
  } else {
    return el;
  }
}

export function addDestructors(
  destructors: Destructors,
  source: ComponentReturnType | NodeReturnType | HTMLElement | Text | Comment,
) {
  if (destructors.length === 0) {
    return;
  }
  let node: Node;
  if ($nodes in source) {
    node = getNode(source[$nodes][0]);
  } else if ($node in source) {
    node = getNode(source[$node]);
  } else {
    node = getNode(source);
  }
  const oldDestructors = $destructors.get(node) || [];
  $destructors.set(node, [...oldDestructors, ...destructors]);
  return () => {
    // remove added destructors
    const oldDestructors = $destructors.get(node) || [];
    $destructors.set(
      node,
      oldDestructors.filter((fn) => !destructors.includes(fn)),
    );
  };
}
function runDestructorsSync(targetNode: Node) {
  if ($destructors.has(targetNode)) {
    $destructors.get(targetNode)!.forEach((fn) => {
      fn();
    });
    $destructors.delete(targetNode);
  }
  targetNode.childNodes.forEach((node) => {
    runDestructorsSync(node);
  });
}
export function runDestructors(
  targetNode: Node,
  promises: Array<Promise<void>> = [],
): Array<Promise<void>> {
  if (targetNode === undefined) {
    console.warn(`Trying to run destructors on undefined`);
    return promises;
  }
  if ($destructors.has(targetNode)) {
    $destructors.get(targetNode)!.forEach((fn) => {
      const result = fn();
      if (result !== undefined && 'then' in result) {
        promises.push(result);
      }
    });
    $destructors.delete(targetNode);
  }
  targetNode.childNodes.forEach((node) => {
    runDestructors(node, promises);
  });
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
