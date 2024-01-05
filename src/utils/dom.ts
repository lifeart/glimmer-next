import {
  addEventListener,
  addDestructors,
  NodeReturnType,
  type ComponentReturnType,
  Slots,
  Component,
  renderElement,
  destroyElement,
} from "@/utils/component";
import { AnyCell, Cell, MergedCell, formula, isTag } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { ListComponent } from "@/utils/list";
import { ifCondition } from "@/utils/if";
import { DestructorFn, Destructors, executeDestructors } from "./destroyable";
import { api } from "@/utils/dom-api";

type ModifierFn = (
  element: HTMLElement,
  ...args: unknown[]
) => void | DestructorFn;

type Attr =
  | MergedCell
  | Cell
  | string
  | ((element: HTMLElement, attribute: string) => void);

type TagAttr = [string, Attr];
type TagProp = [string, Attr];
type TagEvent = [string, EventListener | ModifierFn];
type FwType = {
  props: TagProp[];
  attrs: TagAttr[];
  events: TagEvent[];
};
type Props = [TagProp[], TagAttr[], TagEvent[], FwType?];

function $prop(
  element: HTMLElement,
  key: string,
  value: unknown,
  destructors: DestructorFn[]
) {
  if (typeof value === "function") {
    $prop(
      element,
      key,
      formula(value,`${element.tagName}.${key}`),
      destructors
    );
  } else if (value !== null && (value as AnyCell)[isTag]) {
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
  if (typeof value === "function") {
    $attr(
      element,
      key,
      formula(value as unknown as () => unknown, `${element.tagName}.${key}`),
      destructors
    );
  } else if (value !== null && (value as AnyCell)[isTag]) {
    destructors.push(
      bindUpdatingOpcode(value as AnyCell, (value) => {
        // @ts-expect-error type casting
        api.attr(element, key, value);
      })
    );
  } else {
    // @ts-expect-error type casting
    api.attr(element, key, value);
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
      api.append(element, node);
    });
  } else if (typeof child === "object" && "node" in child) {
    api.append(element, child.node);
  } else if (typeof child === "string" || typeof child === "number") {
    api.append(element, api.text(child));
  } else if (child !== null &&  (child as AnyCell)[isTag]) {
    api.append(element, cellToText(child as AnyCell));
  } else if (typeof child === "function") {
    // looks like a component
    const f = formula(child as unknown as () => unknown, `${element.tagName}.child.fn`);
    let componentProps:
      | ComponentReturnType
      | NodeReturnType
      | string
      | number = ''
    const dest = bindUpdatingOpcode(f, (value) => {
      componentProps = value as unknown as ComponentReturnType | NodeReturnType | string | number;
    });
    if (componentProps !== null && (componentProps as unknown as AnyCell)[isTag]) {
      return addChild(element, componentProps as unknown as AnyCell);
    } else if (typeof componentProps === 'function') {
      return addChild(element, formula(() => {
        return child()();
      }, `${element.tagName}.child.fn`) as unknown as AnyCell);
    } 
    if (typeof componentProps !== "object") {
      if (f.isConst) {
        const text = api.text(String(componentProps));
        api.append(element, text);
      } else {
        const text = api.text("");
        addDestructors(
          [
            bindUpdatingOpcode(f, (value) => {
              api.textContent(text, String(value));
            }),
          ],
          text
        );
        api.append(element, text);
      }
    } else if ("nodes" in componentProps) {
      // @ts-expect-error never
      componentProps.nodes.forEach((node) => {
        api.append(element, node);
      });
    }else {
      // @ts-expect-error never
      api.append(element, componentProps.node);
    }
    dest();
  }
}
function _DOM(
  tag: string,
  tagProps: Props,
  children: (
    | NodeReturnType
    | ComponentReturnType
    | string
    | Cell
    | MergedCell
    | Function
  )[]
): NodeReturnType {
  const element = api.element(tag);
  const destructors: Destructors = [];
  const props = tagProps[0];
  const attrs = tagProps[1];
  const _events = tagProps[2];
  const hasSplatAttrs = typeof tagProps[3] === 'object';
  const attributes = hasSplatAttrs
    ? [...tagProps[3]!.attrs, ...attrs]
    : attrs;
  const properties = hasSplatAttrs
    ? [...tagProps[3]!.props, ...props]
    : props;
  const events = hasSplatAttrs
    ? [...tagProps[3]!.events, ..._events]
    : _events;
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
    if (classNameModifiers.length === 1) {
      $prop(
        element,
        "className",
        classNameModifiers[0],
        destructors
      );
    } else {
      const formulas = classNameModifiers.map((modifier) => {
        if (typeof modifier === "function") {
          return formula(modifier as unknown as () => unknown, 'functional modifier');
        } else {
          return modifier;
        }
      });
      $prop(
        element,
        "className",
        formula(() => {
          return formulas.join(" ");
        }, element.tagName + '.className'),
        destructors
      );
    }
   
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
  components: Array<ComponentReturnType | NodeReturnType | Node | string | number>
) {
  const nodes: Array<Node> = [];
  components.forEach((component) => {
    if (typeof component === "string" || typeof component === "number") {
      nodes.push(api.text(String(component)));
    } else if ("index" in component) {
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
    slots: {},
    index: 0,
  };
}

function slot(name: string, params: () => unknown[], $slot: Slots) {
  if (!(name in $slot)) {
    const slotPlaceholder: NodeReturnType = def(api.comment());
    let isRendered = false;
    Object.defineProperty($slot, name, {
      set(value: Slots[string]) {
        if (isRendered) {
          throw new Error(`Slot ${name} is already rendered`);
        }
        const elements = value(...params());
        const nodes = mergeComponents(
          elements.map((el) => {
            if (typeof el === "string" || typeof el === "number") {
              return api.text(String(el));
            } else if (typeof el === "function") {
              // here likely el is as slot constructor
              // @ts-expect-error function signature
              return el();
            } else {
              return el;
            }
          })
        );

        renderElement(
          slotPlaceholder.node.parentNode!,
          nodes,
          slotPlaceholder.node
        );
        destroyElement(slotPlaceholder);
        isRendered = true;
      },
      get() {
        throw new Error("slot is not set");
      },
    });
    return slotPlaceholder;
  }
  const elements = $slot[name](...params());
  return mergeComponents(
    elements.map((el) => {
      if (typeof el === "string" || typeof el === "number") {
        return api.text(String(el));
      } else if (typeof el === "function") {
        // here likely el is as slot constructor
        // @ts-expect-error function signature
        return el();
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
  const textNode = api.text("");
  addDestructors(
    [
      bindUpdatingOpcode(cell, (value) => {
        api.textContent(textNode, String(value ?? ""));
      }),
    ],
    textNode
  );
  return textNode;
}
function text(text: string | Cell | MergedCell | Fn): NodeReturnType {
  if (typeof text === "string") {
    return def(api.text(text));
  } else if (text !== null && (text as AnyCell)[isTag]) {
    return def(cellToText(text as AnyCell));
  } else if (typeof text === "function") {
    const maybeFormula = formula(text, 'textNode');
    if (maybeFormula.isConst) {
      try {
        return def(api.text(String(maybeFormula.value)));
      } finally {
        maybeFormula.destroy();
      }
    } else {
      return $_text(maybeFormula);
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
  const outlet = api.fragment();
  ifCondition(cell, outlet, trueBranch, falseBranch);
  return def(outlet);
}

function each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | NodeReturnType>,
  key: string | null = null
) {
  const outlet = api.fragment();
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
const ArgProxyHandler = {
  get(target: Record<string, () => unknown>, prop: string) {
    if (prop in target) {
      return target[prop]();
    }
    return undefined;
  },
  set() {
    throw new Error("args are readonly");
  },
};
export function $_args(args: Record<string, unknown>) { 
  if (IS_GLIMMER_COMPAT_MODE) {
    return new Proxy(args, ArgProxyHandler);
  } else {
    return args;
  }
}
export const $_if = ifCond;
export const $_each = each;
export const $_slot = slot;
export const $_c = component;
export const $_withSlots = withSlots;
export const $_text = text;
export const $_tag = _DOM;
export function $_fin(
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
    nodes.unshift(api.comment());
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
