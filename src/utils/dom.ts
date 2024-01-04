import {
  addEventListener,
  addDestructors,
  NodeReturnType,
  type ComponentReturnType,
  Slots,
  Component,
} from "@/utils/component";
import { AnyCell, Cell, MergedCell, formula, tags } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { ListComponent } from "@/utils/list";
import { ifCondition } from "@/utils/if";
import { DestructorFn, Destructors, executeDestructors } from "./destroyable";

type ModifierFn = (
  element: HTMLElement,
  ...args: unknown[]
) => void | DestructorFn;

type Attr =
  | MergedCell
  | Cell
  | string
  | ((element: HTMLElement, attribute: string) => void);

type Props = {
  fw?: {
    props: Array<[string, Attr]>;
    attrs: Array<[string, Attr]>;
    events: Array<[string, EventListener | ModifierFn]>;
  };
  properties: [string, Attr][];
  attributes: [string, Attr][];
  events: [string, EventListener | ModifierFn][];
};

function $text(str: string) {
  return document.createTextNode(str);
}

function $prop(
  element: HTMLElement,
  key: string,
  value: unknown,
  destructors: DestructorFn[]
) {
  if (typeof value === "function") {
    $attr(
      element,
      key,
      formula(value as unknown as () => unknown, `${element.tagName}.${key}`),
      destructors
    );
  } else if (tags.has(value as AnyCell)) {
    destructors.push(
      bindUpdatingOpcode(value as AnyCell, (value) => {
        // @ts-expect-error types casting
        element[key] = value;
      })
    );
  } else {
    // @ts-expect-error never ever
    element[key] = value;
  }
}

function $attr(
  element: HTMLElement,
  key: string,
  value: unknown,
  destructors: Destructors
) {
  if (key === "...attributes") {
    return;
  }
  if (typeof value === "function") {
    $attr(
      element,
      key,
      formula(value as unknown as () => unknown, `${element.tagName}.${key}`),
      destructors
    );
  } else if (tags.has(value as AnyCell)) {
    destructors.push(
      bindUpdatingOpcode(value as AnyCell, (value) => {
        // @ts-expect-error type casting
        element.setAttribute(key, value);
      })
    );
  } else {
    element.setAttribute(key, value as string);
  }
}

function addChild(
  element: HTMLElement,
  child:
    | NodeReturnType
    | ComponentReturnType
    | string
    | Cell
    | MergedCell
    | Function
) {
  if (child === null) {
    return;
  }
  if (typeof child === "object" && "nodes" in child) {
    child.nodes.forEach((node) => {
      element.appendChild(node);
    });
  } else if (typeof child === "object" && "node" in child) {
    element.appendChild(child.node);
  } else if (typeof child === "string" || typeof child === "number") {
    const text = $text(child);
    element.appendChild(text);
  } else if (tags.has(child as AnyCell)) {
    element.appendChild(cellToText(child as AnyCell));
  } else if (typeof child === "function") {
    // looks like a component
    const componentProps:
      | ComponentReturnType
      | NodeReturnType
      | string
      | number = child();
    if (typeof componentProps !== "object") {
      const text = $text(String(componentProps));
      element.appendChild(text);
    } else if ("nodes" in componentProps) {
      componentProps.nodes.forEach((node) => {
        element.appendChild(node);
      });
    } else {
      element.appendChild(componentProps.node);
    }
  }
}
function _DOM(
  tag: string,
  props: Props,
  ...children: (
    | NodeReturnType
    | ComponentReturnType
    | string
    | Cell
    | MergedCell
    | Function
  )[]
): NodeReturnType {
  const element = document.createElement(tag);
  const destructors: Destructors = [];
  const hasSplatAttrs =
    props.attributes.find((el) => el[0] === "...attributes") &&
    typeof props.fw !== undefined;
  const attributes = hasSplatAttrs
    ? [...props.fw!.attrs, ...props.attributes]
    : props.attributes;
  const properties = hasSplatAttrs
    ? [...props.fw!.props, ...props.properties]
    : props.properties;
  const events = hasSplatAttrs
    ? [...props.fw!.events, ...props.events]
    : props.events;
  events.forEach(([eventName, fn]) => {
    if (eventName === "onCreated") {
      const destructor = (fn as ModifierFn)(element);
      if (typeof destructor === "function") {
        destructors.push(destructor);
      }
    } else {
      destructors.push(
        addEventListener(element, eventName, fn as EventListener)
      );
    }
  });
  const seenKeys = new Set<string>();
  attributes.forEach(([key, value]) => {
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    $attr(element, key, value, destructors);
  });
  const classNameModifiers: Attr[] = [];
  properties.forEach(([key, value]) => {
    if (key === "className") {
      classNameModifiers.push(value);
      return;
    }
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    $prop(element, key, value, destructors);
  });
  if (classNameModifiers.length > 0) {
    const formulas = classNameModifiers.map((modifier) => {
      if (typeof modifier === "function") {
        return formula(modifier as unknown as () => unknown);
      } else {
        return modifier;
      }
    });
    $prop(
      element,
      "className",
      formula(() => {
        return formulas.join(" ");
      }),
      destructors
    );
  }
  children.forEach((child) => {
    addChild(element, child);
  });

  addDestructors(destructors, element);
  return def(element);
}

function component(comp: ComponentReturnType | Component) {
  if ("template" in comp) {
    return (comp.template as unknown as () => ComponentReturnType)();
  }
  return comp;
}
type Fn = () => unknown;
function def(node: Node) {
  return {
    node,
    index: 0,
  };
}

function mergeComponents(
  components: Array<ComponentReturnType | NodeReturnType | Node>
) {
  const nodes: Array<Node> = [];
  components.forEach((component) => {
    if ("index" in component) {
      if ("nodes" in component) {
        nodes.push(...component.nodes);
      } else if ("node" in component) {
        nodes.push(component.node);
      }
    } else {
      nodes.push(component);
    }
  });
  return {
    nodes,
    index: 0,
  };
}

function slot(name: string, params: () => unknown[], $slot: Slots) {
  const elements = $slot[name](...params());
  return mergeComponents(
    elements.map((el) => {
      if (typeof el === "string" || typeof el === "number") {
        return $text(String(el));
      } else {
        return el;
      }
    })
  );
}

function withSlots(
  component: ComponentReturnType,
  slots: Record<string, () => Array<ComponentReturnType | NodeReturnType>>
) {
  Object.keys(slots).forEach((slotName) => {
    component.slots[slotName] = slots[slotName];
  });
  return component;
}

function cellToText(cell: Cell | MergedCell) {
  const textNode = $text("");
  addDestructors(
    [
      bindUpdatingOpcode(cell, (value) => {
        textNode.textContent = String(value ?? "");
      }),
    ],
    textNode
  );
  return textNode;
}
function text(text: string | Cell | MergedCell | Fn): NodeReturnType {
  if (typeof text === "string") {
    return def($text(text));
  } else if (tags.has(text as AnyCell)) {
    return def(cellToText(text as AnyCell));
  } else if (typeof text === "function") {
    const maybeFormula = formula(text);
    if (maybeFormula.isConst) {
      try {
        return def($text(String(maybeFormula.value)));
      } finally {
        maybeFormula.destroy();
      }
    } else {
      return DOM.text(maybeFormula);
    }
  } else {
    throw new Error("invalid text");
  }
}

type BranchCb = () => ComponentReturnType | NodeReturnType;

function ifCond(
  cell: Cell<boolean>,
  trueBranch: BranchCb,
  falseBranch: BranchCb
) {
  const outlet = document.createDocumentFragment();
  ifCondition(cell, outlet, trueBranch, falseBranch);
  return def(outlet);
}

function each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => ComponentReturnType,
  key: string | null = null
) {
  const outlet = document.createDocumentFragment();
  new ListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      key,
    },
    outlet
  );
  return def(outlet);
}

_DOM.each = each;
_DOM.if = ifCond;
_DOM.slot = slot;
_DOM.c = component;
_DOM.withSlots = withSlots;
_DOM.text = text;

export const DOM = _DOM;

export function $fin(
  roots: Array<ComponentReturnType | NodeReturnType>,
  slots: Slots,
  isStable: boolean,
  ctx: unknown
) {
  const nodes: Array<
    HTMLElement | ComponentReturnType | NodeReturnType | Text | Comment
  > = [];
  roots.forEach((root) => {
    if ("nodes" in root) {
      nodes.push(
        ...(root.nodes as unknown as Array<HTMLElement | Text | Comment>)
      );
    } else {
      nodes.push(root.node as unknown as HTMLElement | Text | Comment);
    }
  });
  if (!isStable) {
    nodes.unshift(document.createComment(""));
  }
  addDestructors(
    [
      () => {
        executeDestructors(ctx as unknown as object);
      },
    ],
    nodes[0]
  );
  return {
    nodes,
    slots,
    index: 0,
  };
}
