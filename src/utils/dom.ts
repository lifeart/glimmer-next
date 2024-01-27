import {
  addEventListener,
  associateDestroyable,
  type ComponentReturnType,
  type Slots,
  type Component,
  renderElement,
  destroyElement,
  runDestructors,
} from '@/utils/component';
import {
  AnyCell,
  Cell,
  MergedCell,
  formula,
  deepFnValue,
} from '@/utils/reactive';
import { checkOpcode, opcodeFor } from '@/utils/vm';
import {
  SyncListComponent,
  AsyncListComponent,
  getFirstNode,
} from '@/utils/list';
import { ifCondition } from '@/utils/if';
import {
  DestructorFn,
  Destructors,
  executeDestructors,
  registerDestructor,
} from './destroyable';
import { api } from '@/utils/dom-api';
import {
  isFn,
  isPrimitive,
  isTagLike,
  $template,
  $nodes,
  $attrsProp,
  $propsProp,
  $eventsProp,
  addToTree,
  RENDER_TREE,
  setBounds,
  $args,
  $fwProp,
  $DEBUG_REACTIVE_CONTEXTS,
} from './shared';
import { isRehydrationScheduled } from './rehydration';

// EMPTY DOM PROPS
export const $_edp = [[], [], []] as Props;
export const $_emptySlot = Object.seal(Object.freeze({}));

const $_className = 'className';

let ROOT: Component<any> | null = null;

export function resetRoot() {
  ROOT = null;
}
export function setRoot(root: Component<any>) {
  ROOT = root;
}
export function getRoot() {
  return ROOT;
}

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
  if (isFn(value)) {
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
    if (isRehydrationScheduled()) {
      // we should have all static keys settled
      return;
    } else {
      // @ts-expect-error never ever
      element[key] = value;
    }
  }
}

function $attr(
  element: HTMLElement,
  key: string,
  value: unknown,
  destructors: Destructors,
) {
  if (isFn(value)) {
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

type RenderableType = Node | ComponentReturnType | string | number;
type ShadowRootMode = 'open' | 'closed' | null;
function resolveRenderable(
  child: Function,
  debugName = 'resolveRenderable',
): RenderableType | MergedCell | Cell {
  const f = formula(() => deepFnValue(child), debugName);
  let componentProps: RenderableType = '';
  checkOpcode(f, (value) => {
    componentProps = value as unknown as RenderableType;
  });
  if (f.isConst) {
    f.destroy();
    return componentProps;
  } else {
    if (isPrimitive(componentProps)) {
      return f;
    } else {
      // looks like a component
      return componentProps;
    }
  }
}

export function addChild(
  element: HTMLElement | ShadowRoot,
  child: RenderableType | Cell | MergedCell | Function,
  destructors: Destructors = [],
  index = 0,
) {
  if (child === null || child === undefined) {
    return;
  }
  const isObject = typeof child === 'object';
  if (isObject && $nodes in child) {
    child[$nodes].forEach((node, i) => {
      addChild(element, node, destructors, index + i);
    });
  } else if (isPrimitive(child)) {
    // @ts-expect-error number to string type casting
    api.append(element, api.text(child), index);
  } else if (isTagLike(child)) {
    api.append(element, cellToText(child, destructors), index);
  } else if (isFn(child)) {
    addChild(
      element,
      resolveRenderable(child, `element.child[${index}]`),
      destructors,
      index,
    );
  } else {
    // renderComponent case
    api.append(element, child, index);
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
    if (isFn(fn)) {
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
        return value; // objet
        // throw new Error('invalid textContent value');
      }
    } else {
      if (IS_GLIMMER_COMPAT_MODE) {
        api.textContent(element, fn);
      } else {
        if (isPrimitive(fn)) {
          api.textContent(element, String(fn));
        } else if (isTagLike(fn)) {
          destructors.push(
            opcodeFor(fn, (value) => {
              api.textContent(element, String(value));
            }),
          );
        }
      }
    }
    // modifier case
  } else if (eventName === EVENT_TYPE.ON_CREATED) {
    const destructor = (fn as ModifierFn)(element);
    if (isFn(destructor)) {
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

let NODE_COUNTER = 0;

export function incrementNodeCounter() {
  NODE_COUNTER++;
}

export function resetNodeCounter() {
  NODE_COUNTER = 0;
}

export function getNodeCounter() {
  return NODE_COUNTER;
}
const IN_SSR_ENV = import.meta.env.SSR || location.pathname === '/tests.html';
export function $_hasBlock(slots: Record<string, unknown>, name = 'default') {
  return name in slots;
}
export function $_hasBlockParams(
  slots: Record<string, unknown>,
  slotName = 'default',
) {
  return slots[`${slotName}_`];
}

function _DOM(
  tag: string,
  tagProps: Props,
  children: (ComponentReturnType | string | Cell | MergedCell | Function)[],
  ctx: any,
): Node {
  NODE_COUNTER++;
  const element = api.element(tag);
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.push(`${tag}`);
  }
  if (IN_SSR_ENV) {
    // todo - ssr mode here, we need to do it only in 2 cases:
    // 1. We running SSR tests in QUNIT
    // 1. We inside SSR mode
    element.setAttribute('data-node-id', String(NODE_COUNTER));
  }
  const destructors: Destructors = [];
  const props = tagProps[0];
  const attrs = tagProps[1];
  const _events = tagProps[2];
  const hasSplatAttrs = typeof tagProps[3] === 'object';
  const attributes = hasSplatAttrs
    ? [...tagProps[3]![$attrsProp], ...attrs]
    : attrs;
  const properties = hasSplatAttrs
    ? [...tagProps[3]![$propsProp], ...props]
    : props;
  const events = hasSplatAttrs
    ? [...tagProps[3]![$eventsProp], ..._events]
    : _events;
  events.forEach(([eventName, fn]) => {
    $ev(element, eventName, fn, destructors);
  });
  const seenKeys = new Set<string>();
  attributes.forEach(([key, value]) => {
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[${key}]`);
    }
    $attr(element, key, value, destructors);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  });
  const classNameModifiers: Attr[] = [];
  let hasShadowMode: ShadowRootMode = null;
  properties.forEach(([key, value]) => {
    if (key === $_className) {
      classNameModifiers.push(value);
      return;
    } else if (key === 'shadowrootmode') {
      hasShadowMode = value as NonNullable<ShadowRootMode>;
      return;
    }
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[${key}]`);
    }
    $prop(element, key, value, destructors);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  });
  if (classNameModifiers.length > 0) {
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[class]`);
    }
    if (classNameModifiers.length === 1) {
      $prop(element, $_className, classNameModifiers[0], destructors);
    } else {
      const formulas = classNameModifiers.map((modifier) => {
        if (isFn(modifier)) {
          return formula(
            () => deepFnValue(modifier),
            'functional modifier for className',
          );
        } else {
          return modifier;
        }
      });
      $prop(
        element,
        $_className,
        formula(() => {
          return formulas.join(' ');
        }, element.tagName + '.className'),
        destructors,
      );
    }
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  }
  const appendRef =
    hasShadowMode !== null
      ? element.attachShadow({ mode: hasShadowMode }) || element.shadowRoot
      : element;
  children.forEach((child, index) => {
    addChild(appendRef, child, destructors, index);
  });

  associateDestroyable(ctx, destructors);
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
  }
  return element;
}
let unstableWrapperId = 0;

type InElementFnArg = () => HTMLElement;
export function $_inElement(
  elementRef: HTMLElement | Cell<HTMLElement> | InElementFnArg,
  roots: (context: Component<any>) => (Node | ComponentReturnType)[],
  ctx: any,
) {
  return component(
    function UnstableChildWrapper(this: Component<any>) {
      if (IS_DEV_MODE) {
        // @ts-expect-error construct signature
        this.debugName = `InElement-${unstableWrapperId++}`;
      }
      let appendRef!: HTMLElement;
      if (isFn(elementRef)) {
        appendRef = elementRef();
      } else if (isTagLike(elementRef)) {
        appendRef = elementRef.value;
      } else {
        appendRef = elementRef;
      }
      const destructors: Destructors = [];
      roots(ctx).forEach((child, index) => {
        addChild(appendRef, child, destructors, index);
      });
      destructors.push(() => {
        appendRef.innerHTML = '';
      });
      associateDestroyable(ctx, destructors);
      return $_fin([], {}, false, this);
    } as unknown as Component<any>,
    {},
    { attrs: [], props: [], events: [] },
    ctx,
  );
}

// $_ unstableChildComponentWrapper
export function $_ucw(
  roots: (context: Component<any>) => (Node | ComponentReturnType)[],
  ctx: any,
) {
  return component(
    function UnstableChildWrapper(this: Component<any>) {
      if (IS_DEV_MODE) {
        // @ts-expect-error construct signature
        this.debugName = `UnstableChildWrapper-${unstableWrapperId++}`;
      }
      return $_fin(roots(this), {}, false, this);
    } as unknown as Component<any>,
    {},
    { attrs: [], props: [], events: [] },
    ctx,
  );
}

if (IS_DEV_MODE) {
  function buildGraph(
    obj: Record<string, unknown>,
    root: any,
    children: Set<any>,
  ) {
    if (root === null) {
      console.info('root is null', RENDER_TREE);
      return obj;
    }
    const name =
      root.debugName || root?.constructor?.name || root?.tagName || 'unknown';
    if (children.size === 0) {
      obj[name] = null;
      return obj;
    }
    obj[name] = Array.from(children).map((child) => {
      return buildGraph({}, child, RENDER_TREE.get(child) ?? new Set());
    });
    return obj;
  }

  function drawTreeToConsole() {
    const ref = buildGraph(
      {} as Record<string, unknown>,
      ROOT,
      RENDER_TREE.get(ROOT!) ?? new Set(),
    );
    console.log(JSON.stringify(ref, null, 2));
    console.log(RENDER_TREE);
  }
  if (!import.meta.env.SSR) {
    window.drawTreeToConsole = drawTreeToConsole;
  }
}

const COMPONENTS_HMR = new WeakMap<
  Component | ComponentReturnType,
  Set<{
    parent: any;
    instance: ComponentReturnType;
    args: Record<string, unknown>;
    fw: FwType;
  }>
>();

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    // @ts-expect-error global
    window.utils = {
      getRoot,
      runDestructors,
    };
    window.hotReload = function hotReload(
      oldklass: Component | ComponentReturnType,
      newKlass: Component | ComponentReturnType,
    ) {
      const renderedInstances = COMPONENTS_HMR.get(oldklass);
      if (!renderedInstances) {
        return;
      }
      const renderedBuckets = Array.from(renderedInstances);
      // we need to append new instances before first element of rendered bucket and later remove all rendered buckets;

      renderedBuckets.forEach(({ parent, instance, args, fw }) => {
        const newCmp = component(newKlass, args, fw, parent);
        const firstElement = getFirstNode(instance);
        const parentElement = firstElement.parentNode!;
        renderElement(parentElement, newCmp, firstElement);
        destroyElement(instance);
      });
      COMPONENTS_HMR.delete(oldklass);
    };
  }
}
function component(
  comp: ComponentReturnType | Component,
  args: Record<string, unknown>,
  fw: FwType,
  ctx: Component<any>,
  // slots: false | Record<string, () => Array<ComponentReturnType | Node>> = false,
) {
  let label = IS_DEV_MODE
    ? `${
        // @ts-expect-error debugName may not exist
        comp.debugName || comp.name || comp.constructor.name
      }`
    : '';
  try {
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(label);
      label = `<${label} ${JSON.stringify(args)} />`;
    }
    return _component(comp, args, fw, ctx);
  } catch (e) {
    if (import.meta.env.SSR) {
      throw e;
    }
    if (IS_DEV_MODE) {
      let ErrorOverlayClass = customElements.get('vite-error-overlay');
      let errorOverlay!: Element;
      // @ts-expect-error message may not exit
      e.message = `${label}\n${e.message}`;
      if (!ErrorOverlayClass) {
        errorOverlay = api.element('pre');
        // @ts-expect-error stack may not exit
        errorOverlay.textContent = `${label}\n${e.stack ?? e}`;
        errorOverlay.setAttribute(
          'style',
          'color:red;border:1px solid red;padding:10px;background-color:#333;',
        );
      } else {
        errorOverlay = new ErrorOverlayClass(e, true);
      }
      console.error(label, e);

      return {
        ctx: null,
        slots: {},
        nodes: [errorOverlay],
      };
    } else {
      return {
        ctx: null,
        slots: {},
        // @ts-expect-error message may not exit
        nodes: [api.text(String(e.message))],
      };
    }
  } finally {
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  }
}
// hello, basic component manager
function _component(
  comp: ComponentReturnType | Component,
  args: Record<string, unknown>,
  fw: FwType,
  ctx: Component<any>,
  // slots: false | Record<string, () => Array<ComponentReturnType | Node>> = false,
) {
  if (IS_DEV_MODE) {
    if (!COMPONENTS_HMR.has(comp)) {
      COMPONENTS_HMR.set(comp, new Set());
    }
  }
  if (IS_GLIMMER_COMPAT_MODE) {
  } else {
    if (isTagLike(comp)) {
      comp = comp.value;
    }
  }
  // @ts-expect-error construct signature
  const instance = new (comp as unknown as Component<any>)(args, fw);
  // todo - fix typings here
  if ($template in instance) {
    const result = (
      instance[$template] as unknown as () => ComponentReturnType
    )();
    if (IS_DEV_MODE) {
      // @ts-expect-error new
      instance.debugName = comp.name;
      const bucket = {
        parent: ctx,
        instance: result,
        args,
        fw,
      };
      COMPONENTS_HMR.get(comp)?.add(bucket);
      registerDestructor(ctx, () => {
        COMPONENTS_HMR.get(comp)?.delete(bucket);
      });
    }
    if (result.ctx !== null) {
      // here is workaround for simple components @todo - figure out how to show context-less components in tree
      // for now we don't adding it
      addToTree(ctx, result.ctx);
      if (IS_DEV_MODE) {
        setBounds(result);
      }
    }
    return result;
  }
  if (instance.ctx !== null) {
    // for now we adding only components with context
    addToTree(ctx, instance.ctx);
    if (IS_DEV_MODE) {
      setBounds(instance);
    }
  }
  if (IS_DEV_MODE) {
    COMPONENTS_HMR.get(comp)?.add({
      parent: ctx,
      instance: instance,
      args,
      fw,
    });
  }
  return instance;
}
type Fn = () => unknown;

function mergeComponents(
  components: Array<ComponentReturnType | Node | string | number>,
) {
  const nodes: Array<Node> = [];
  const contexts: Array<Component> = [];
  components.forEach((component) => {
    if (IS_DEV_MODE) {
      if (typeof component === 'boolean' || typeof component === 'undefined') {
        throw new Error(`
          Woops, looks like we trying to render boolean or undefined to template, check used helpers.
          It's not allowed to render boolean or undefined to template.
        `);
      }
    }
    if (isPrimitive(component)) {
      nodes.push(api.text(String(component)));
    } else if ($nodes in component) {
      if (component.ctx !== null) {
        contexts.push(component.ctx);
      }
      nodes.push(...component[$nodes]);
    } else {
      nodes.push(component);
    }
  });
  return {
    [$nodes]: nodes,
    // @todo - fix proper ctx merging here;
    ctx: contexts.length > 0 ? contexts[0] : null,
  };
}

function fnToText(fn: Function, destructors: Destructors = []) {
  const value = resolveRenderable(fn, `fnToText`);
  if (isPrimitive(value)) {
    return api.text(String(value));
  } else if (isTagLike(value)) {
    // @todo - fix destructors in slots;
    return cellToText(value, destructors);
  } else if (value === null || value === undefined) {
    return api.text('');
  } else if (typeof value === 'object') {
    return value;
  } else {
    return api.text(String(value));
  }
}

function createSlot(
  value: Slots[string],
  params: () => unknown[],
  // @ts-expect-error unused
  name: string,
) {
  // @todo - figure out destructors for slot (shoud work, bu need to be tested)
  const elements = value(...params());
  const nodes = mergeComponents(
    elements.map((el) => {
      if (isPrimitive(el)) {
        return api.text(String(el));
      } else if (isFn(el)) {
        return fnToText(el);
      } else {
        return el;
      }
    }),
  );
  return nodes;
}

function slot(name: string, params: () => unknown[], $slot: Slots, ctx: any) {
  // console.log(ctx, ctx);
  const $destructors: Destructors = [];
  if (ctx) {
    // TODO: ctx should always exist, fix `element` helper to be control node
    associateDestroyable(ctx, [
      () => {
        $destructors.forEach((fn) => fn());
      },
    ]);
  }

  if (!(name in $slot)) {
    const slotPlaceholder: Comment = api.comment(
      `slot-{{${name}}}-placeholder`,
    );
    let isRendered = false;
    let isSettled = false;
    let slotValue: Slots[string] = () => [];
    Object.defineProperty($slot, name, {
      set(value: Slots[string]) {
        isSettled = true;
        if (isRendered) {
          throw new Error(`Slot ${name} is already rendered`);
        }
        slotValue = value;
        const slotRoots = createSlot(slotValue, params, name);
        $destructors.push(() => {
          destroyElement(slotRoots);
        });
        renderElement(slotPlaceholder.parentNode!, slotRoots, slotPlaceholder);
        isRendered = true;
      },
      get() {
        if (isSettled) {
          return slotValue;
        }
        throw new Error(`Slot ${name} is not set`);
      },
    });
    return slotPlaceholder;
  }
  const slotRoot = createSlot($slot[name], params, name);
  $destructors.push(() => {
    destroyElement(slotRoot);
  });
  return slotRoot;
}

function cellToText(cell: Cell | MergedCell, destructors: Destructors) {
  const textNode = api.text('');
  destructors.push(
    opcodeFor(cell, (value) => {
      api.textContent(textNode, String(value ?? ''));
    }),
  );
  return textNode;
}
function text(
  text: string | number | null | Cell | MergedCell | Fn,
  destructors: Destructors,
): Text {
  if (isPrimitive(text)) {
    // @ts-expect-error number to string type casting
    return api.text(text);
  } else if (text !== null && isTagLike(text)) {
    return cellToText(text as AnyCell, destructors);
  } else if (isFn(text)) {
    // @ts-expect-error return type
    return fnToText(text as unknown as Function, destructors);
  } else {
    throw new Error('invalid text');
  }
}

type BranchCb = () => ComponentReturnType | Node;

function ifCond(
  cell: Cell<boolean>,
  trueBranch: BranchCb,
  falseBranch: BranchCb,
  ctx: Component<any>,
) {
  const ifPlaceholder = api.comment('if-entry-placeholder');
  const outlet = isRehydrationScheduled()
    ? ifPlaceholder.parentElement!
    : api.fragment();
  if (!ifPlaceholder.isConnected) {
    api.append(outlet, ifPlaceholder);
  }
  // @ts-expect-error new
  const instance = new ifCondition(
    ctx,
    cell,
    outlet,
    trueBranch,
    falseBranch,
    ifPlaceholder,
  );
  addToTree(ctx, instance);
  return outlet;
}
export function $_eachSync<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const eachPlaceholder = api.comment('sync-each-placeholder');
  const outlet = isRehydrationScheduled()
    ? eachPlaceholder.parentElement!
    : api.fragment();
  if (!eachPlaceholder.isConnected) {
    api.append(outlet, eachPlaceholder);
  }
  const instance = new SyncListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      ctx,
      key,
    },
    outlet,
  );
  addToTree(ctx, instance as unknown as Component<any>);
  return outlet;
}
export function $_each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const eachPlaceholder = api.comment('async-each-placeholder');
  const outlet = isRehydrationScheduled()
    ? eachPlaceholder.parentElement!
    : api.fragment();
  if (!eachPlaceholder.isConnected) {
    api.append(outlet, eachPlaceholder);
  }
  const instance = new AsyncListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      key,
      ctx,
    },
    outlet,
  );
  addToTree(ctx, instance as unknown as Component<any>);
  return outlet;
}
const ArgProxyHandler = {
  get(target: Record<string, () => unknown>, prop: string) {
    if (prop in target) {
      if (!isFn(target[prop])) {
        return target[prop];
      }
      return target[prop]();
    }
    return undefined;
  },
  set() {
    throw new Error('args are readonly');
  },
};
export function $_GET_ARGS(ctx: any, args: any) {
  ctx[$args] = ctx[$args] || args[0] || {};
}
export function $_GET_SLOTS(ctx: any, args: any) {
  return (args[0] || {})[$SLOTS_SYMBOL] || ctx[$args][$SLOTS_SYMBOL] || {};
}
export function $_GET_FW(ctx: any, args: any) {
  return ctx[$fwProp] || args[1];
}
export const $SLOTS_SYMBOL = Symbol('slots');
export function $_args(
  args: Record<string, unknown>,
  slots: Record<string, () => Array<ComponentReturnType | Node>> | false,
) {
  if (IS_GLIMMER_COMPAT_MODE) {
    if (IS_DEV_MODE) {
      const newArgs: Record<string, () => unknown> = {
        [$SLOTS_SYMBOL]: slots ?? {},
      };
      Object.keys(args).forEach((key) => {
        try {
          Object.defineProperty(newArgs, key, {
            get() {
              if (!isFn(args[key])) {
                return args[key];
              }
              // @ts-expect-error function signature
              return args[key]();
            },
            enumerable: true,
          });
        } catch (e) {
          console.error(e);
        }
      });
      return newArgs;
    } else {
      Object.defineProperty(args, $SLOTS_SYMBOL, {
        value: slots ?? {},
        enumerable: false,
      });
      return new Proxy(args, ArgProxyHandler);
    }
  } else {
    Object.defineProperty(args, $SLOTS_SYMBOL, {
      value: slots ?? {},
      enumerable: false,
    });
    return args;
  }
}
export const $_if = ifCond;
export const $_slot = slot;
export const $_c = component;
export const $_text = text;
export const $_tag = _DOM;

type TextReturnFn = () => string | number | boolean | null | undefined;

export function $_fin(
  roots: Array<ComponentReturnType | Node>,
  slots: Slots,
  isStable: boolean,
  ctx: Component<any> | null,
) {
  const nodes: Array<
    HTMLElement | ComponentReturnType | Node | Text | Comment | TextReturnFn
  > = [];
  if (!isStable) {
    if (IS_DEV_MODE) {
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

    associateDestroyable(ctx, [
      () => {
        executeDestructors(ctx as unknown as object);
      },
    ]);
  }

  return {
    [$nodes]: roots.map((item) => {
      if (isFn(item)) {
        // here may be component or text or node
        const value = resolveRenderable(item, `component child fn`);
        if (value === null || value === undefined) {
          return api.text('');
        } else if (isPrimitive(value)) {
          return api.text(String(value));
        } else if (isTagLike(value)) {
          // @todo - fix destructors in slots;
          return cellToText(value, []);
        } else {
          return value;
        }
      } else {
        return item;
      }
    }),
    ctx,
  };
}
