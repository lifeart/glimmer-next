export type ComponentRenderTarget =
  | HTMLElement
  | DocumentFragment
  | ComponentReturnType;

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
    | ComponentReturnType[]
    | NodeReturnType[]
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
export type Destructors = Array<DestructorFn>;
export type ComponentReturnType = {
  nodes: Node[];
  destructors: Destructors;
  index: number;
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
