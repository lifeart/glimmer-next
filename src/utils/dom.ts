import {
  addEventListener,
  addDestructors,
  NodeReturnType,
  type ComponentReturnType,
  Slots,
  Component,
  renderElement,
  destroyElement,
} from '@/utils/component';
import {
  AnyCell,
  Cell,
  MergedCell,
  formula,
  isTag,
  deepFnValue,
} from '@/utils/reactive';
import { evaluateOpcode, opcodeFor } from '@/utils/vm';
import { ListComponent } from '@/utils/list';
import { ifCondition } from '@/utils/if';
import { DestructorFn, Destructors, executeDestructors } from './destroyable';
import { api } from '@/utils/dom-api';

// EMPTY DOM PROPS
export const $_edp = [[], [], []] as Props;

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
  destructors: DestructorFn[],
) {
  if (typeof value === 'function') {
    $prop(
      element,
      key,
      resolveRenderable(value, `${element.tagName}.${key}`),
      destructors,
    );
  } else if (value !== null && isTagLike(value)) {
    destructors.push(
      opcodeFor(value as AnyCell, (value) => {
        // @ts-expect-error types casting
        element[key] = value;
      }),
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
  destructors: Destructors,
) {
  if (typeof value === 'function') {
    $attr(
      element,
      key,
      resolveRenderable(value, `${element.tagName}.${key}`),
      destructors,
    );
  } else if (value !== null && isTagLike(value)) {
    destructors.push(
      opcodeFor(value as AnyCell, (value) => {
        // @ts-expect-error type casting
        api.attr(element, key, value);
      }),
    );
  } else {
    // @ts-expect-error type casting
    api.attr(element, key, value);
  }
}

function isPrimitive(value: unknown): value is string | number {
  return typeof value === 'string' || typeof value === 'number';
}

function isTagLike(child: unknown): child is AnyCell {
  return (child as AnyCell)[isTag];
}

type RenderableType = ComponentReturnType | NodeReturnType | string | number;

function resolveRenderable(
  child: Function,
  debugName = 'resolveRenderable',
): RenderableType | MergedCell | Cell {
  const f = formula(() => deepFnValue(child), debugName);
  let componentProps: RenderableType = '';
  evaluateOpcode(f, (value) => {
    componentProps = value as unknown as RenderableType;
  });
  if (f.isConst) {
    f.destroy();
    return componentProps;
  } else {
    if (isPrimitive(componentProps)) {
      return f;
    } else {
      throw new Error('invalid reactive type');
    }
  }
}

function addChild(
  element: HTMLElement,
  child: RenderableType | Cell | MergedCell | Function,
) {
  if (child === null || child === undefined) {
    return;
  }
  if (typeof child === 'object' && 'nodes' in child) {
    child.nodes.forEach((node) => {
      api.append(element, node);
    });
  } else if (typeof child === 'object' && 'node' in child) {
    api.append(element, child.node);
  } else if (isPrimitive(child)) {
    // @ts-expect-error number to string type casting
    api.append(element, api.text(child));
  } else if (isTagLike(child)) {
    api.append(element, cellToText(child));
  } else if (typeof child === 'function') {
    addChild(element, resolveRenderable(child));
  }
}

const EVENT_TYPE = {
  ON_CREATED: '0',
  TEXT_CONTENT: '1',
};

function $ev(
  element: HTMLElement,
  eventName: string,
  fn: EventListener | ModifierFn,
  destructors: DestructorFn[],
) {
  // textContent is a special case
  if (eventName === EVENT_TYPE.TEXT_CONTENT) {
    if (typeof fn === 'function') {
      const value = resolveRenderable(fn, `${element.tagName}.textContent`);
      if (isPrimitive(value)) {
        api.textContent(element, String(value));
      } else if (isTagLike(value)) {
        destructors.push(
          opcodeFor(value, (value) => {
            api.textContent(element, String(value));
          }),
        );
      } else {
        throw new Error('invalid textContent value');
      }
    } else {
      api.textContent(element, fn);
    }
    // modifier case
  } else if (eventName === EVENT_TYPE.ON_CREATED) {
    const destructor = (fn as ModifierFn)(element);
    if (typeof destructor === 'function') {
      destructors.push(destructor);
    }
  } else {
    // event case (on modifier)
    if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
      destructors.push(
        addEventListener(element, eventName, fn as EventListener),
      );
    } else {
      addEventListener(element, eventName, fn as EventListener);
    }
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
  )[],
): NodeReturnType {
  const element = api.element(tag);
  const destructors: Destructors = [];
  const props = tagProps[0];
  const attrs = tagProps[1];
  const _events = tagProps[2];
  const hasSplatAttrs = typeof tagProps[3] === 'object';
  const attributes = hasSplatAttrs ? [...tagProps[3]!.attrs, ...attrs] : attrs;
  const properties = hasSplatAttrs ? [...tagProps[3]!.props, ...props] : props;
  const events = hasSplatAttrs ? [...tagProps[3]!.events, ..._events] : _events;
  events.forEach(([eventName, fn]) => {
    $ev(element, eventName, fn, destructors);
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
    if (key === 'className') {
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
      $prop(element, 'className', classNameModifiers[0], destructors);
    } else {
      const formulas = classNameModifiers.map((modifier) => {
        if (typeof modifier === 'function') {
          return formula(() => deepFnValue(modifier), 'functional modifier');
        } else {
          return modifier;
        }
      });
      $prop(
        element,
        'className',
        formula(() => {
          return formulas.join(' ');
        }, element.tagName + '.className'),
        destructors,
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
  if ('template' in comp) {
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
  components: Array<
    ComponentReturnType | NodeReturnType | Node | string | number
  >,
) {
  const nodes: Array<Node> = [];
  components.forEach((component) => {
    if (import.meta.env.DEV) {
      if (typeof component === 'boolean' || typeof component === 'undefined') {
        throw new Error(`
          Woops, looks like we trying to render boolean or undefined to template, check used helpers.
          It's not allowed to render boolean or undefined to template.
        `);
      }
    }
    if (isPrimitive(component)) {
      nodes.push(api.text(String(component)));
    } else if ('index' in component) {
      if ('nodes' in component) {
        nodes.push(...component.nodes);
      } else if ('node' in component) {
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
            if (isPrimitive(el)) {
              return api.text(String(el));
            } else if (typeof el === 'function') {
              const value = resolveRenderable(el, `slot ${name} element fn`);
              if (isPrimitive(value)) {
                return api.text(String(value));
              } else if (isTagLike(value)) {
                return cellToText(value);
              } else {
                return value;
              }
            } else {
              return el;
            }
          }),
        );

        renderElement(
          slotPlaceholder.node.parentNode!,
          nodes,
          slotPlaceholder.node,
        );
        destroyElement(slotPlaceholder);
        isRendered = true;
      },
      get() {
        throw new Error('slot is not set');
      },
    });
    return slotPlaceholder;
  }
  const elements = $slot[name](...params());
  return mergeComponents(
    elements.map((el) => {
      if (isPrimitive(el)) {
        return api.text(String(el));
      } else if (typeof el === 'function') {
        // here likely el is as slot constructor
        // @ts-expect-error function signature
        return el();
      } else {
        return el;
      }
    }),
  );
}

function withSlots(
  component: ComponentReturnType,
  slots: Record<string, () => Array<ComponentReturnType | NodeReturnType>>,
) {
  Object.keys(slots).forEach((slotName) => {
    component.slots[slotName] = slots[slotName];
  });
  return component;
}

function cellToText(cell: Cell | MergedCell) {
  const textNode = api.text('');
  addDestructors(
    [
      opcodeFor(cell, (value) => {
        api.textContent(textNode, String(value ?? ''));
      }),
    ],
    textNode,
  );
  return textNode;
}
function text(
  text: string | number | null | Cell | MergedCell | Fn,
): NodeReturnType {
  if (isPrimitive(text)) {
    // @ts-expect-error number to string type casting
    return def(api.text(text));
  } else if (text !== null && isTagLike(text)) {
    return def(cellToText(text as AnyCell));
  } else if (typeof text === 'function') {
    // @todo update is const check here
    const maybeFormula = resolveRenderable(text as Fn);
    if (isPrimitive(maybeFormula)) {
      return def(api.text(String(maybeFormula)));
    } else if (isTagLike(maybeFormula)) {
      return def(cellToText(maybeFormula));
    } else {
      // @ts-expect-error 'ComponentReturnType | NodeReturnType' is not assignable to type 'string | number | null'
      return $_text(maybeFormula);
    }
  } else {
    throw new Error('invalid text');
  }
}

type BranchCb = () => ComponentReturnType | NodeReturnType;

function ifCond(
  cell: Cell<boolean>,
  trueBranch: BranchCb,
  falseBranch: BranchCb,
) {
  const outlet = api.fragment();
  ifCondition(cell, outlet, trueBranch, falseBranch);
  return def(outlet);
}

function each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | NodeReturnType>,
  key: string | null = null,
  isSync = false,
) {
  const outlet = api.fragment();
  new ListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      isSync,
      key,
    },
    outlet,
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
    throw new Error('args are readonly');
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
  ctx: unknown,
) {
  const nodes: Array<
    HTMLElement | ComponentReturnType | NodeReturnType | Text | Comment
  > = [];
  roots.forEach((root) => {
    if ('nodes' in root) {
      nodes.push(
        ...(root.nodes as unknown as Array<HTMLElement | Text | Comment>),
      );
    } else {
      nodes.push(root.node as unknown as HTMLElement | Text | Comment);
    }
  });
  if (!isStable) {
    if (import.meta.env.DEV) {
      nodes.unshift(
        api.comment(`unstable root enter node: ${ctx?.constructor.name}`),
      );
      nodes.push(
        api.comment(`unstable root exit node: ${ctx?.constructor.name}`),
      );
    } else {
      nodes.unshift(api.comment());
      nodes.push(api.comment());
    }
  }
  if (ctx !== null) {
    // no need to add destructors because component seems template-only and should not have `registerDestructor` flow.
    addDestructors(
      [
        () => {
          executeDestructors(ctx as unknown as object);
        },
      ],
      nodes[0],
    );
  }

  return {
    nodes,
    slots,
    index: 0,
  };
}
