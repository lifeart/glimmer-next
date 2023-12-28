import { addEventListener, type ComponentReturnType, type Destructors } from "@/utils/component";
import { Cell, MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { ListComponent } from "@/components/list";
import { Application } from "@/components/Application";
import type { Item } from "@/utils/data";

type Props = {
  attributes: [
    string,
    MergedCell | Cell | string | ((element: HTMLElement, attribute: string) => void)
  ][];
  events: [string, EventListener][];
};

type NodeReturnType = {
  node: Node;
  destructors: Destructors;
  index: number;
};

function _DOM(
  tag: string,
  props: Props,
  ...children: (NodeReturnType | ComponentReturnType | string | Cell | MergedCell | Function)[]
): NodeReturnType {
  const element = document.createElement(tag);
  const destructors: Destructors = [];
  const attributes = props.attributes || [];
  const events = props.events || [];
  events.forEach(([eventName, fn]) => {
    const destructor = addEventListener(element, eventName, fn);
    destructors.push(destructor);
  });
  attributes.forEach(([key, value]) => {
    if (value instanceof Function) {
      const destructor = value(element, key);
      if (typeof destructor === "function") {
        destructors.push(destructor);
      }
    } else if (value instanceof Cell || value instanceof MergedCell) {
        const destructor = bindUpdatingOpcode(value, (value) => {
            element.setAttribute(key, String(value));
        });
        destructors.push(destructor);
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
        destructors.push(...child.destructors);
    } else if (typeof child === "object" && "node" in child) {
      element.appendChild(child.node);
      destructors.push(...child.destructors);
    } else if (typeof child === "string" || typeof child === "number") {
      const text = document.createTextNode(child);
      element.appendChild(text);
    } else if (child instanceof Cell || child instanceof MergedCell) {
      const text = document.createTextNode("");
      element.appendChild(text);
      destructors.push(
        bindUpdatingOpcode(child, (value) => {
          text.textContent = String(value ?? "");
        })
      );
    } else if (child instanceof Function) {
      // looks like a component
      const componentProps: ComponentReturnType | NodeReturnType = child();
      if ("nodes" in componentProps) {
        componentProps.nodes.forEach((node) => {
          element.appendChild(node);
        });
      } else {
        element.appendChild(componentProps.node);
      }
      destructors.push(...componentProps.destructors);
    }
  });

  return {
    node: element,
    destructors,
    index: 0,
  };
}

_DOM.each = each;

function each<T extends Record<string, unknown>>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => ComponentReturnType
) {
  const outlet = document.createElement("div");
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