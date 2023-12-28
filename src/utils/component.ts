export type ComponentRenderTarget = HTMLElement | DocumentFragment | ComponentReturnType;

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

export function destroyElement(component: ComponentReturnType | NodeReturnType  ) {
  component.destructors.forEach((fn) => fn());
  if ('nodes' in component) {
    component.nodes.forEach((node) => {
      node.parentElement!.removeChild(node);
    });
  } else {
    component.node.parentElement!.removeChild(component.node);
  }
}

export function targetFor(outlet: ComponentRenderTarget): HTMLElement | DocumentFragment {
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

export function addEventListener(node: Node, eventName: string, fn: EventListener) {
  node.addEventListener(eventName, fn);
  return () => {
    node.removeEventListener(eventName, fn);
  };
}
