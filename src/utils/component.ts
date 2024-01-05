import { Destructors } from "@/utils/destroyable";
import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from "@glint/template/-private/integration";
import { api } from "@/utils/dom-api";

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
  if (target.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
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
  placeholder: Comment | Node
) {
  if (!Array.isArray(el)) {
    if (el === null) {
      return;
    }
    if ("nodes" in el) {
      el.nodes.forEach((node) => {
        renderNode(target, node, placeholder);
      });
    } else {
      renderNode(target, el.node, placeholder);
    }
  } else {
    el.forEach((item) => {
      renderElement(target, item, placeholder);
    });
  }
}

export function renderComponent(
  component: ComponentReturnType,
  target: ComponentRenderTarget
): ComponentReturnType {
  const targetElement = targetFor(target);
  component.nodes.forEach((node) => {
    api.append(targetElement, node);
  });
  return component;
}

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;
export class Component<T extends Props = any> implements ComponentReturnType {
  args!: Get<T, "Args">;
  declare [Context]: TemplateContext<
    this,
    Get<T, "Args">,
    Get<T, "Blocks">,
    Get<T, "Element", null>
  >;
  declare [Invoke]: (
    args: Get<T, "Args">
  ) => ComponentReturn<Get<T, "Blocks">, Get<T, "Element", null>>;
  nodes!: Node[];
  index!: number;
  slots!: Slots;
  $fw: unknown;
  constructor(props: Get<T, "Args">, fw?: unknown) {
    this.args = props;
    this.$fw = fw;
  }
  template!: ComponentReturnType;
}

export async function destroyElement(
  component:
    | ComponentReturnType
    | NodeReturnType
    | Array<ComponentReturnType | NodeReturnType>
    | null
    | null[]
) {
  if (Array.isArray(component)) {
    await Promise.all(component.map((component) => destroyElement(component)));
  } else {
    if (component === null) {
      return;
    }
    if ("nodes" in component) {
      const destructors: Array<Promise<void>> = [];
      component.nodes.forEach((node) => {
        runDestructors(node, destructors);
      });
      await Promise.all(destructors);
      try {
        component.nodes.forEach((node) => {
          if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            const roots = relatedRoots.get(node as DocumentFragment) ?? [];
            destroyElement(roots);
            relatedRoots.delete(node as DocumentFragment);
            return;
          }
          const parent = node.parentElement;
          if (parent !== null) {
            parent.removeChild(node);
          } else {
            throw new Error(`Node is not in DOM`);
          }
        });
      } catch (e) {
        console.warn(
          `Woops, looks like node we trying to destroy no more in DOM`,
          e
        );
      }
    } else {
      await Promise.all(runDestructors(component.node));
      if (component.node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        const roots =
          relatedRoots.get(component.node as DocumentFragment) ?? [];
        destroyElement(roots);
        relatedRoots.delete(component.node as DocumentFragment);
        return;
      }
      try {
        component.node.parentElement!.removeChild(component.node);
      } catch (e) {
        console.warn(
          `Woops, looks like node we trying to destroy no more in DOM`,
          e
        );
      }
    }
  }
}

var $destructors = new WeakMap<Node, Destructors>();

window["getDestructors"] = () => $destructors;

function getNode(el: Node): Node {
  if (el.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return (el as DocumentFragment).lastChild!;
  } else {
    return el;
  }
}

export function addDestructors(
  destructors: Destructors,
  source: ComponentReturnType | NodeReturnType | HTMLElement | Text | Comment
) {
  if (destructors.length === 0) {
    return;
  }
  let node: Node;
  if ("nodes" in source) {
    node = getNode(source.nodes[0]);
  } else if ("node" in source) {
    node = getNode(source.node);
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
      oldDestructors.filter((fn) => !destructors.includes(fn))
    );
  };
}

export function runDestructors(
  targetNode: Node,
  promises: Array<Promise<void>> = []
): Array<Promise<void>> {
  if ($destructors.has(targetNode)) {
    $destructors.get(targetNode)!.forEach((fn) => {
      const result = fn();
      if (result !== undefined && "then" in result) {
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
  outlet: ComponentRenderTarget
): HTMLElement | DocumentFragment {
  if (outlet instanceof HTMLElement || outlet instanceof DocumentFragment) {
    return outlet;
  } else {
    return outlet.nodes[0] as HTMLElement;
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

export function addEventListener(
  node: Node,
  eventName: string,
  fn: EventListener
) {
  node.addEventListener(eventName, fn);
  return () => {
    node.removeEventListener(eventName, fn);
  };
}
