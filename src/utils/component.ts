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
        runNestedDestructors(node);
        node.parentElement!.removeChild(node);
      });
    } else {
      runNestedDestructors(component.node);

      component.node.parentElement!.removeChild(component.node);
    }
  }
}

var $destructors = new WeakMap<Node, Destructors>();

// @ts-expect-error bla-bla
window["getDestructors"] = () => $destructors;

export function addDestructors(
  destructors: Destructors,
  source: ComponentReturnType | NodeReturnType | HTMLElement | Text | Comment
) {
  if (destructors.length) {
    if ("nodes" in source) {
      $destructors.set(source.nodes[0], destructors);
    } else if ("node" in source) {
      $destructors.set(source.node, destructors);
    } else {
      $destructors.set(source, destructors);
    }
  }
}

export function runNestedDestructors(targetNode: Node) {
  if ($destructors.has(targetNode)) {
    $destructors.get(targetNode)!.forEach((fn) => fn());
    $destructors.delete(targetNode);
  }
  targetNode.childNodes.forEach((node) => {
    runNestedDestructors(node);
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
