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

export function renderElement(
    target: Node,
    el: GenericReturnType,
    placeholder: Comment
  ) {
    if (!Array.isArray(el)) {
      if (el === null) {
        return;
      }
      if ("nodes" in el) {
        el.nodes.forEach((node) => {
          target.insertBefore(node, placeholder);
        });
      } else {
        target.insertBefore(el.node, placeholder);
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
    targetElement.appendChild(node);
  });
  return component;
}

export function destroyElement(
  component:
    | ComponentReturnType
    | NodeReturnType
    | Array<ComponentReturnType | NodeReturnType>
    | null
    | null[]
) {
  if (Array.isArray(component)) {
    component.forEach((component) => {
      destroyElement(component);
    });
  } else {
    if (component === null) {
      return;
    }
    component.destructors.forEach((fn) => fn());
    if ("nodes" in component) {
      component.nodes.forEach((node) => {
        runDestructors(node);
        node.parentElement!.removeChild(node);
      });
    } else {
      runDestructors(component.node);

      component.node.parentElement!.removeChild(component.node);
    }
  }
}

var $destructors = new WeakMap<Node, Destructors>();

// @ts-expect-error bla-bla
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
  if (destructors.length) {
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
  }
}

export function runDestructors(targetNode: Node) {
  if ($destructors.has(targetNode)) {
    $destructors.get(targetNode)!.forEach((fn) => fn());
    $destructors.delete(targetNode);
  }
  targetNode.childNodes.forEach((node) => {
    runDestructors(node);
  });
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

export type DestructorFn = () => void;
export type Slots = Record<string, (...params: unknown[]) => Array<ComponentReturnType|NodeReturnType|Comment|string|number>>;
export type Destructors = Array<DestructorFn>;
export type ComponentReturnType = {
  nodes: Node[];
  destructors: Destructors;
  index: number;
  slots: Slots;
};
export type NodeReturnType = {
  node: Node;
  destructors: Destructors;
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
