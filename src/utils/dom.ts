import {
  addEventListener,
  addDestructors,
  NodeReturnType,
  type ComponentReturnType,
  type Destructors,
  DestructorFn,
} from "@/utils/component";
import { Cell, MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { ListComponent } from "@/utils/list";
import { ifCondition } from "@/utils/if";

type ModifierFn = (element: HTMLElement, ...args: unknown[]) => void | DestructorFn;

type Props = {
  attributes: [
    string,
    (
      | MergedCell
      | Cell
      | string
      | ((element: HTMLElement, attribute: string) => void)
    )
  ][];
  events: [string, EventListener | ModifierFn ][];
};

function $text(str: string) {
  return document.createTextNode(str);
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
  const attributes = props.attributes || [];
  const events = props.events || [];
  events.forEach(([eventName, fn]) => {
    if (eventName === 'onCreated') {
      const destructor = (fn as ModifierFn)(element);
      if (typeof destructor === "function") {
        destructors.push(destructor);
      }
    } else {
      destructors.push(addEventListener(element, eventName, fn as EventListener));
    }
  });
  attributes.forEach(([key, value]) => {
    if (value instanceof Function) {
      const destructor = value(element, key);
      if (typeof destructor === "function") {
        destructors.push(destructor);
      }
    } else if (value instanceof Cell || value instanceof MergedCell) {
      if (key === "class") {
        destructors.push(
          bindUpdatingOpcode(value, (value) => {
            const valueString = String(value ?? "");
            element.className = valueString;
          })
        );
      } else {
        destructors.push(
          bindUpdatingOpcode(value, (value) => {
            const valueString = String(value ?? "");
            element.setAttribute(key, valueString);
          })
        );
      }
    } else {
      element.setAttribute(key, value);
    }
  });
  children.forEach((child) => {
    if (child === null) {
      return;
    }
    if (typeof child === "object" && "nodes" in child) {
      child.nodes.forEach((node) => {
        element.appendChild(node);
      });
      addDestructors(child.destructors, child);
    } else if (typeof child === "object" && "node" in child) {
      element.appendChild(child.node);
      addDestructors(child.destructors, child);
    } else if (typeof child === "string" || typeof child === "number") {
      const text = $text(child);
      element.appendChild(text);
    } else if (child instanceof Cell || child instanceof MergedCell) {
      const text = $text("");
      addDestructors(
        [
          bindUpdatingOpcode(child, (value) => {
            text.textContent = String(value ?? "");
          }),
        ],
        text
      );
      element.appendChild(text);
    } else if (child instanceof Function) {
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
        addDestructors(componentProps.destructors, componentProps);
      } else {
        element.appendChild(componentProps.node);
        addDestructors(componentProps.destructors, componentProps);
      }
    }
  });

  addDestructors(destructors, element);
  return {
    node: element,
    destructors: [],
    index: 0,
  };
}

_DOM.each = each;
_DOM.if = ifCond;
_DOM.text = function (text: string) {
  return {
    node: $text(text),
    destructors: [],
    index: 0,
  };
};

type BranchCb = () => ComponentReturnType | NodeReturnType;

function ifCond(
  cell: Cell<boolean>,
  trueBranch: BranchCb,
  falseBranch: BranchCb
) {
  const outlet = document.createDocumentFragment();
  ifCondition(cell, outlet, trueBranch, falseBranch);
  return {
    node: outlet,
    destructors: [],
    index: 0,
  };
}

function each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => ComponentReturnType
) {
  const outlet = document.createDocumentFragment();
  const List = new ListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
    },
    outlet
  );

  return {
    node: outlet,
    destructors: List.destructors,
    index: 0,
  };
}

export const DOM = _DOM;

export function finalizeComponent(
  roots: Array<ComponentReturnType | NodeReturnType>,
  existingDestructors: Destructors
) {
  const dest = roots.reduce((acc, root) => {
    return [...acc, ...root.destructors];
  }, existingDestructors);
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
  addDestructors(dest, nodes[0]);
  return {
    nodes,
    destructors: [],
    index: 0,
  };
}
