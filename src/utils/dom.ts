import {
  addEventListener,
  addDestructors,
  NodeReturnType,
  type ComponentReturnType,
  type Destructors,
} from "@/utils/component";
import { Cell, MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { ListComponent } from "@/utils/list";
import { ifCondition } from "@/utils/if";

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
  events: [string, EventListener][];
};

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
    destructors.push(addEventListener(element, eventName, fn));
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
      const text = document.createTextNode(child);
      element.appendChild(text);
    } else if (child instanceof Cell || child instanceof MergedCell) {
      const text = document.createTextNode("");
      element.appendChild(text);
      addDestructors(
        [
          bindUpdatingOpcode(child, (value) => {
            text.textContent = String(value ?? "");
          }),
        ],
        text
      );
    } else if (child instanceof Function) {
      // looks like a component
      const componentProps:
        | ComponentReturnType
        | NodeReturnType
        | string
        | number = child();
      if (typeof componentProps !== "object") {
        const text = document.createTextNode(String(componentProps));
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
    node: document.createTextNode(text),
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

function maybeReactiveAttr(value: Cell | MergedCell | string) {
  return (element: HTMLElement, attribute: string) => {
    if (value instanceof Cell || value instanceof MergedCell) {
      return bindUpdatingOpcode(value, (value) => {
        element.setAttribute(attribute, String(value));
      });
    } else {
      element.setAttribute(attribute, value);
    }
  };
}

_DOM.maybeReactiveAttr = maybeReactiveAttr;

export const DOM = _DOM;
