import {
  type ComponentReturnType,
  type Slots,
  type Component,
  renderElement,
  runDestructors,
  destroyElementSync,
  unregisterFromParent,
} from '@/utils/component';
import {
  AnyCell,
  Cell,
  MergedCell,
  formula,
  deepFnValue,
  getTagId,
  tagsFromRange,
} from '@/utils/reactive';
import { checkOpcode, opcodeFor } from '@/utils/vm';
import {
  SyncListComponent,
  AsyncListComponent,
} from '@/utils/control-flow/list';
import {
  DestructorFn,
  Destructors,
  registerDestructor,
} from './glimmer/destroyable';
import type { DOMApi } from '@/utils/dom-api';
import {
  isFn,
  isPrimitive,
  isTagLike,
  $template,
  $nodes,
  addToTree,
  setBounds,
  $args,
  $DEBUG_REACTIVE_CONTEXTS,
  IN_SSR_ENV,
  COMPONENTS_HMR,
  isEmpty,
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  cId,
  CHILD,
  TREE,
  PARENT,
  SEEN_TREE_NODES,
} from './shared';
import { isRehydrationScheduled } from './ssr/rehydration';
import { createHotReload } from './hmr';
import { IfCondition } from './control-flow/if';
import { CONSTANTS } from '../../plugins/symbols';
import { initDOM, provideContext, ROOT_CONTEXT } from './context';
import { SVGProvider, HTMLProvider, MathMLProvider } from './provider';

type RenderableType = Node | ComponentReturnType | string | number;
type ShadowRootMode = 'open' | 'closed' | null;
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
type FwType = [TagProp[], TagAttr[], TagEvent[]];
type Props = [TagProp[], TagAttr[], TagEvent[], FwType?];

type InElementFnArg = () => HTMLElement;
type BranchCb = () => ComponentReturnType | Node;

// EMPTY DOM PROPS
export const $_edp = [[], [], []] as Props;
export const $_emptySlot = Object.seal(Object.freeze({}));

export const $SLOTS_SYMBOL = Symbol('slots');
export const $PROPS_SYMBOL = Symbol('props');
export const $_SVGProvider = SVGProvider;
export const $_HTMLProvider = HTMLProvider;
export const $_MathMLProvider = MathMLProvider;

const $_className = 'className';

let unstableWrapperId: number = 0;
/* 
  Root is basically owner in ember naming.
  Referencing to top-level application context,
  Acting as main DI container and metadata storage.
*/
export class Root {
  [RENDERED_NODES_PROPERTY] = [];
  [COMPONENT_ID_PROPERTY] = cId();
  [RENDERING_CONTEXT_PROPERTY]: undefined | DOMApi = undefined;
  declare document: Document;
  constructor(document: Document = globalThis.document) {
    this.document = document;
    provideContext(this, ROOT_CONTEXT, this);
    const id = this[COMPONENT_ID_PROPERTY];
    CHILD.set(id, []);
    // @ts-expect-error
    TREE.set(id, this);
    if (WITH_CONTEXT_API) {
      // @ts-expect-error
      PARENT.set(id, null);
    }
    registerDestructor(this, () => {
      CHILD.delete(id);
      TREE.delete(id);
      if (WITH_CONTEXT_API) {
        PARENT.delete(id);
      }
    });
  }
}

export const $_MANAGERS = {
  component: {
    // @ts-expect-error unused
    canHandle(component: any) {
      return false;
    },
    handle(
      // @ts-expect-error unused

      component: any,
      // @ts-expect-error unused

      args: any,
      // @ts-expect-error unused

      fw: any,
      // @ts-expect-error unused

      ctx: any,
    ): ComponentReturnType | Component {
      // @ts-expect-error unused
      return;
    },
  },
  modifier: {
    // @ts-expect-error unused
    canHandle(modifier: any) {
      return false;
    },
    handle(
      // @ts-expect-error unused

      modifier: any,
      // @ts-expect-error unused

      element: Element,
      // @ts-expect-error unused

      props: unknown[],
      // @ts-expect-error unused

      args: () => Record<string, unknown>,
    ) {
      return;
    },
  },
  helper: {
    // @ts-expect-error unused
    canHandle(helper: any) {
      return false;
    },
    // @ts-expect-error unused
    handle(helper: any, params: any, hash: any) {
      return;
    },
  },
};

export function $_TO_VALUE(reference: unknown) {
  if (isFn(reference)) {
    return resolveRenderable(reference as Function);
  } else {
    return reference;
  }
}

export function $_componentHelper(params: any, hash: any) {
  const componentFn = params.shift();

  return function wrappedComponent(args: any) {
    console.log('patching component args', args, hash);
    Object.keys(hash).forEach((key) => {
      args[key] = hash[key];
    });
    return new componentFn(...arguments);
  };
}
export function $_modifierHelper(params: any, hash: any) {
  const modifierFn = params.shift();
  // @ts-expect-error undefined
  if (EmberFunctionalModifiers.has(modifierFn)) {
    function wrappedModifier(node: any, _params: any, _hash: any) {
      console.log('callingWrapperModifier', {
        params,
        _params,
        hash,
        _hash,
      });
      return $_maybeModifier(modifierFn, node, [...params, ..._params], {
        ...hash,
        ..._hash,
      });
    }
    // @ts-expect-error undefined
    EmberFunctionalModifiers.add(wrappedModifier);
    return wrappedModifier;
  } else {
    throw new Error('Unable to use modifier helper with non-ember modifiers');
  }
}
export function $_helperHelper(params: any, hash: any) {
  const helperFn = params.shift();
  console.log('helper-helper', params, hash);
  // @ts-expect-error undefined
  if (EmberFunctionalHelpers.has(helperFn)) {
    function wrappedHelper(_params: any, _hash: any) {
      console.log('callingWrapperHelper', {
        params,
        _params,
        hash,
        _hash,
      });
      return $_maybeHelper(helperFn, [...params, ..._params], {
        ...hash,
        ..._hash,
      });
    }
    // @ts-expect-error undefined
    EmberFunctionalHelpers.add(wrappedHelper);
    return wrappedHelper;
  } else {
    if (WITH_EMBER_INTEGRATION) {
      if ($_MANAGERS.helper.canHandle(helperFn)) {
        return $_MANAGERS.helper.handle(helperFn, params, hash);
      }
    }
    throw new Error('Unable to use helper with non-ember helpers');
  }
}
export function createRoot() {
  const root = new Root();
  return root;
}

function $prop(
  api: DOMApi,
  element: Node,
  key: string,
  value: unknown,
  destructors: DestructorFn[],
) {
  const result = $_TO_VALUE(value);
  if (isEmpty(result)) {
    return;
  }
  if (isPrimitive(result)) {
    if (isRehydrationScheduled()) {
      return;
    }
    api.prop(element, key, result);
  } else {
    let prevPropValue: any = undefined;
    destructors.push(
      opcodeFor(result as AnyCell, (value) => {
        if (value === prevPropValue) {
          return;
        }
        prevPropValue = api.prop(element, key, value);
      }),
    );
  }
}

function $attr(
  api: DOMApi,
  element: HTMLElement,
  key: string,
  value: unknown,
  destructors: Destructors,
) {
  const result = $_TO_VALUE(value);
  if (isEmpty(result)) {
    return;
  }
  if (isPrimitive(result)) {
    api.attr(element, key, result as string);
  } else {
    destructors.push(
      opcodeFor(result as AnyCell, (value) => {
        // @ts-expect-error type casting
        api.attr(element, key, value);
      }),
    );
  }
}

export function resolveRenderable(
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
    if (isPrimitive(componentProps) || isEmpty(componentProps)) {
      return f;
    } else {
      // looks like a component
      return componentProps;
    }
  }
}

const EVENT_TYPE = {
  ON_CREATED: '0',
  TEXT_CONTENT: '1',
};

function $ev(
  api: DOMApi,
  element: HTMLElement,
  eventName: string,
  fn: EventListener | ModifierFn,
  destructors: DestructorFn[],
) {
  // textContent is a special case
  if (eventName === EVENT_TYPE.TEXT_CONTENT) {
    const result = $_TO_VALUE(fn);
    if (isEmpty(result)) {
      return;
    }
    if (isPrimitive(result)) {
      api.textContent(element, result as string);
    } else {
      destructors.push(
        opcodeFor(result as AnyCell, (value) => {
          api.textContent(element, String(value));
        }),
      );
    }
    // modifier case
  } else if (eventName === EVENT_TYPE.ON_CREATED) {
    if (REACTIVE_MODIFIERS) {
      let destructor = () => void 0;
      const updatingCell = formula(() => {
        destructor();
        return (fn as ModifierFn)(element);
      }, `${element.tagName}.modifier`);
      const opcodeDestructor = opcodeFor(updatingCell, (dest: any) => {
        if (isFn(dest)) {
          destructor = dest as any;
        }
      });
      if (updatingCell.isConst) {
        updatingCell.destroy();
        opcodeDestructor();
        destructors.push(() => {
          return destructor();
        });
      } else {
        destructors.push(
          opcodeDestructor,
          () => {
            updatingCell.destroy();
          },
          () => {
            return destructor();
          },
        );
      }
    } else {
      const destructor = (fn as ModifierFn)(element);
      if (isFn(destructor)) {
        destructors.push(destructor);
      }
    }
  } else {
    // event case (on modifier)
    if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
      destructors.push(
        api.addEventListener(element, eventName, fn as EventListener)!,
      );
    } else {
      api.addEventListener(element, eventName, fn as EventListener);
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
export function $_hasBlock(slots: Record<string, unknown>, name = 'default') {
  return name in slots && slots[name] !== undefined;
}
export function $_hasBlockParams(
  slots: Record<string, unknown>,
  slotName = 'default',
) {
  return slots[`${slotName}_`];
}

function addAttrs(
  api: DOMApi,
  arr: TagAttr[],
  element: HTMLElement,
  seenKeys: Set<string>,
  destructors: Destructors,
) {
  for (let i = 0; i < arr.length; i++) {
    const key = arr[i][0];
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[${key}]`);
    }
    $attr(api, element, key, arr[i][1], destructors);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  }
}

function addProperties(
  api: DOMApi,
  properties: TagProp[],
  element: Node,
  seenKeys: Set<string>,
  destructors: Destructors,
  classNameModifiers: Attr[],
  setShadowMode: (value: NonNullable<ShadowRootMode>) => void,
) {
  for (let i = 0; i < properties.length; i++) {
    const key = properties[i][0];
    const value = properties[i][1];
    if (key === '') {
      classNameModifiers.push(value);
      continue;
    }
    if (SUPPORT_SHADOW_DOM) {
      if (key === 'shadowrootmode') {
        setShadowMode(value as NonNullable<ShadowRootMode>);
        continue;
      }
    }
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[${key}]`);
    }
    $prop(api, element, key, value, destructors);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
  }
}

function _DOM(
  tag: string,
  tagProps: Props,
  children: (ComponentReturnType | string | Cell | MergedCell | Function)[],
  ctx: any,
): Node {
  NODE_COUNTER++;
  const api = initDOM(ctx);
  if (import.meta.env.DEV) {
    if (!api) {
      console.error('Unable to resolve root rendering context');
    }
  }
  if (import.meta.env.DEV) {
    if (!api) {
      console.error('Unable to resolve rendering context');
    }
  }
  const element = api.element(tag) as HTMLElement;
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.push(`${tag}`);
  }
  if (IN_SSR_ENV) {
    // todo - ssr mode here, we need to do it only in 2 cases:
    // 1. We running SSR tests in QUNIT
    // 1. We inside SSR mode
    api.attr(element, 'data-node-id', String(NODE_COUNTER));
  }
  const destructors: Destructors = [];
  const seenKeys = new Set<string>();
  const classNameModifiers: Attr[] = [];
  let hasShadowMode: ShadowRootMode = null;

  const setShadowNode = (value: ShadowRootMode) => {
    hasShadowMode = value;
  };

  if ($_edp !== tagProps) {
    const hasSplatAttrs = typeof tagProps[3] === 'object';

    if (hasSplatAttrs === true) {
      for (let i = 0; i < tagProps[3]![2].length; i++) {
        $ev(
          api,
          element,
          tagProps[3]![2][i][0],
          tagProps[3]![2][i][1],
          destructors,
        );
      }
    }

    for (let i = 0; i < tagProps[2].length; i++) {
      $ev(api, element, tagProps[2][i][0], tagProps[2][i][1], destructors);
    }

    if (hasSplatAttrs === true) {
      addAttrs(api, tagProps[3]![1], element, seenKeys, destructors);
    }
    addAttrs(api, tagProps[1], element, seenKeys, destructors);

    if (hasSplatAttrs === true) {
      addProperties(
        api,
        tagProps[3]![0],
        element,
        seenKeys,
        destructors,
        classNameModifiers,
        setShadowNode,
      );
    }
    addProperties(
      api,
      tagProps[0],
      element,
      seenKeys,
      destructors,
      classNameModifiers,
      setShadowNode,
    );
  }

  if (classNameModifiers.length > 0) {
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`[class]`);
    }
    if (classNameModifiers.length === 1) {
      $prop(api, element, $_className, classNameModifiers[0], destructors);
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
        api,
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

  if (SUPPORT_SHADOW_DOM) {
    let appendRef =
      hasShadowMode !== null
        ? isRehydrationScheduled()
          ? element.shadowRoot
          : element.attachShadow({ mode: hasShadowMode }) || element.shadowRoot
        : element;
    if (import.meta.env.SSR) {
      if (hasShadowMode) {
        const tpl = api.element('template');
        api.attr(tpl, 'shadowrootmode', 'open');
        api.insert(element, tpl);
        // @ts-expect-error children type mismatch
        renderElement(api, ctx, tpl, children);
      } else {
        // @ts-expect-error children type mismatch
        renderElement(api, ctx, appendRef!, children);
      }
    } else {
      for (let i = 0; i < children.length; i++) {
        // @ts-expect-error children type mismatch
        renderElement(api, ctx, appendRef!, children[i], null, true);
      }
    }
  } else {
    for (let i = 0; i < children.length; i++) {
      // @ts-expect-error children type mismatch
      renderElement(api, ctx, element, children[i], null, true);
    }
  }

  if (destructors.length) {
    registerDestructor(ctx, ...destructors);
  }

  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
  }
  return element;
}

export function $_inElement(
  elementRef: HTMLElement | Cell<HTMLElement> | InElementFnArg,
  roots: (context: Component<any>) => (Node | ComponentReturnType)[],
  ctx: any,
) {
  const api = initDOM(ctx);
  return component(
    function UnstableChildWrapper(this: Component<any>) {
      $_GET_ARGS(this, arguments);
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
      const nodes = roots(ctx);
      renderElement(api, ctx, appendRef, nodes);
      registerDestructor(ctx, () => {
        unregisterFromParent(nodes);
        appendRef.innerHTML = '';
      });
      return $_fin([], this);
    } as unknown as Component<any>,
    {},
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
      $_GET_ARGS(this, arguments);
      // debugger;
      if (IS_DEV_MODE) {
        // @ts-expect-error construct signature
        this.debugName = `UnstableChildWrapper-${unstableWrapperId++}`;
      }
      return $_fin(roots(this), this);
    } as unknown as Component<any>,
    {},
    ctx,
  );
}

if (IS_DEV_MODE) {
  function buildGraph(
    obj: Record<string, unknown>,
    root: any,
    children: Set<number>,
  ) {
    if (root === null) {
      console.info('root is null', TREE);
      return obj;
    }
    const name =
      root.debugName || root?.constructor?.name || root?.tagName || 'unknown';
    if (children.size === 0) {
      obj[name] = null;
      return obj;
    }
    obj[name] = Array.from(children).map((child) => {
      return buildGraph({}, child, new Set(CHILD.get(child) ?? []));
    });
    return obj;
  }

  function drawTreeToConsole() {
    const rootIds: number[] = [];
    PARENT.forEach((ref, id) => {
      if (ref === null) {
        rootIds.push(id);
      }
    });
    const roots = rootIds.map((id) => TREE.get(id)!);
    const ref = buildGraph(
      {} as Record<string, unknown>,
      roots[0],
      new Set(CHILD.get(roots[0]![COMPONENT_ID_PROPERTY]) ?? []),
    );
    console.log(JSON.stringify(ref, null, 2));
  }
  if (!import.meta.env.SSR) {
    window.drawTreeToConsole = drawTreeToConsole;
  }
}

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    // @ts-expect-error global
    window.utils = {
      runDestructors,
    };
    window.hotReload = createHotReload(component);
  }
}

export function $_GET_SCOPES(hash: Record<string, unknown>) {
  // @ts-expect-error typings
  return hash[CONSTANTS.SCOPE_KEY]?.() || [];
}

export const $_maybeHelper = (
  value: any,
  args: any[],
  _hash: Record<string, unknown>,
) => {
  // @ts-expect-error amount of args
  const hash = $_args(_hash, false);
  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.helper.canHandle(value)) {
      return $_MANAGERS.helper.handle(value, args, _hash);
    }
  }
  // helper manager
  if (isPrimitive(value)) {
    const scopes = $_GET_SCOPES(hash);
    const needleScope = scopes.find((scope: Record<string, unknown>) => {
      return value in scope;
    });

    if (needleScope) {
      return needleScope[value](...args);
    } else {
      return value;
    }
    // @ts-expect-error
  } else if (EmberFunctionalHelpers.has(value)) {
    return (...args: any[]) => {
      return value(args, hash);
    };
  } else if (value.helperType === 'ember') {
    const helper = new value();
    return (...args: any[]) => {
      return helper.compute.call(helper, args, hash);
    };
  }

  return value;
};

let parentContext: Array<number> = [];
let parentContextIndex = -1;

export const setParentContext = (value: Root | Component<any> | null) => {
  if (value === null) {
    parentContextIndex--;
    parentContext.pop();
  } else {
    parentContextIndex++;
    parentContext.push(value[COMPONENT_ID_PROPERTY]!);
  }
};
export const getParentContext = () => {
  if (IS_DEV_MODE) {
    if (!TREE.get(parentContext[parentContextIndex]!)) {
      throw new Error('unable to get parent context before set');
    }
  }
  return TREE.get(parentContext[parentContextIndex]!);
};

function component(
  comp: ComponentReturnType | Component | typeof Component,
  args: Record<string, unknown>,
  ctx: Component<any> | Root,
) {
  let label = IS_DEV_MODE
    ? `${
        // @ts-expect-error debugName may not exist
        comp.debugName || comp.name || comp.constructor.name
      }`
    : '';
  if (TRY_CATCH_ERROR_HANDLING) {
    try {
      if (IS_DEV_MODE) {
        $DEBUG_REACTIVE_CONTEXTS.push(label);
        const getCircularReplacer = () => {
          const seen = new WeakSet();
          return (_: string, value: unknown) => {
            if (typeof value === 'object' && value !== null) {
              if (seen.has(value)) {
                return;
              }
              seen.add(value);
            }
            return value;
          };
        };
        label = `<${label} ${JSON.stringify(args, getCircularReplacer)} />`;
      }
      // @ts-expect-error uniqSymbol as index
      const fw = args[$PROPS_SYMBOL] as unknown as FwType;
      setParentContext(ctx);
      return _component(comp, args, fw, ctx);
    } catch (e) {
      if (import.meta.env.SSR) {
        throw e;
      }
      if (isRehydrationScheduled()) {
        throw e;
      }
      if (IS_DEV_MODE) {
        let ErrorOverlayClass = customElements.get('vite-error-overlay');
        let errorOverlay!: HTMLElement;
        // @ts-expect-error message may not exit
        e.message = `${label}\n${e.message}`;
        if (!ErrorOverlayClass) {
          errorOverlay = document.createElement('pre');
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
          ctx: {
            [RENDERED_NODES_PROPERTY]: [],
          },
          nodes: [errorOverlay],
        };
      } else {
        return {
          ctx: {
            [RENDERED_NODES_PROPERTY]: [],
          },
          // @ts-expect-error message may not exit
          nodes: [HTMLAPI.text(String(e.message))],
        };
      }
    } finally {
      setParentContext(null);
      if (IS_DEV_MODE) {
        $DEBUG_REACTIVE_CONTEXTS.pop();
      }
    }
  } else {
    // @ts-expect-error uniqSymbol as index
    const fw = args[$PROPS_SYMBOL] as unknown as FwType;
    try {
      setParentContext(ctx);
      return _component(comp, args, fw, ctx);
    } finally {
      setParentContext(null);
    }
  }
}
// hello, basic component manager
function _component(
  _comp: ComponentReturnType | Component | typeof Component,
  args: Record<string, unknown>,
  fw: FwType,
  ctx: Component<any> | Root,
) {
  let startTagId = 0;
  if (IS_DEV_MODE) {
    startTagId = getTagId();
  }
  let comp = _comp;
  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.component.canHandle(_comp)) {
      comp = $_MANAGERS.component.handle(_comp, args, fw, ctx);
    }
  }
  if (IS_GLIMMER_COMPAT_MODE) {
  } else {
    if (isTagLike(comp)) {
      comp = comp.value;
    }
  }
  if (IS_DEV_MODE) {
    if (!COMPONENTS_HMR.has(comp)) {
      COMPONENTS_HMR.set(comp, new Set());
    }
  }
  let instance =
    // @ts-expect-error construct signature
    comp.prototype === undefined
      ? // @ts-expect-error construct signature
        comp(args, fw)
      : // @ts-expect-error construct signature
        new (comp as unknown as Component<any>)(args, fw);
  if (isFn(instance)) {
    instance = new instance(args, fw);
  }
  // todo - fix typings here
  if ($template in instance) {
    addToTree(ctx, instance, 'from $template');
    const result = (
      instance[$template] as unknown as () => ComponentReturnType
    )(
      // @ts-expect-error
      args,
    );
    if (IS_DEV_MODE) {
      // @ts-expect-error new
      instance.debugName = comp.name;
      const bucket = {
        parent: ctx,
        instance: result,
        args,
        tags: tagsFromRange(startTagId),
      };
      COMPONENTS_HMR.get(comp)?.add(bucket);
      registerDestructor(ctx, () => {
        COMPONENTS_HMR.get(comp)?.delete(bucket);
      });
      if (!result.ctx || result.ctx !== instance) {
        throw new Error('Invalid context');
      }
      setBounds(result);
    }
    return result;
  } else if (instance.ctx !== null) {
    // for now we adding only components with context
    // debugger;
    addToTree(ctx, instance.ctx, 'from !$template');
    // addToTree(ctx, instance);

    if (IS_DEV_MODE) {
      setBounds(instance);
    }
  } else {
    if (IS_DEV_MODE) {
      throw new Error(`Unknown Instance`);
    }
  }
  if (IS_DEV_MODE) {
    COMPONENTS_HMR.get(comp)?.add({
      parent: ctx,
      instance: instance,
      args,
      tags: tagsFromRange(startTagId),
    });
  }
  return instance;
}

function createSlot(
  value: Slots[string],
  params: () => unknown[],
  name: string,
  ctx: any,
) {
  // @todo - figure out destructors for slot (shoud work, bu need to be tested)
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.push(`:${name}`);
  }
  const slotContext = {
    [$args]: {},
    [RENDERED_NODES_PROPERTY]: [],
    [COMPONENT_ID_PROPERTY]: cId(),
    [RENDERING_CONTEXT_PROPERTY]: null,
  };
  // @ts-expect-error slot return type
  addToTree(ctx, slotContext);
  // @TODO: params to reactive cells (or getters)
  const paramsArray = params().map((_, i) => {
    const v = formula(() => params()[i], `slot:param:${i}`);
    const value = v.value;
    if (v.isConst || typeof value === 'object') {
      return value;
    } else {
      return v;
    }
  });
  const elements = value ? value(...[slotContext, ...paramsArray]) : [];
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
    // @ts-expect-error
    slotContext.debugName = `slot:${name}`;
    // @ts-expect-error
    slotContext.debugInfo = {
      parent: ctx,
      params,
      name,
    };
  }

  // @ts-expect-error slot return type
  return $_fin(elements, slotContext);
}

function slot(name: string, params: () => unknown[], $slot: Slots, ctx: any) {
  if (!(name in $slot)) {
    const api = initDOM(ctx);
    const slotPlaceholder: Comment = IS_DEV_MODE
      ? api.comment(`slot-{{${name}}}-placeholder`)
      : api.comment('');
    let isRendered = false;
    let isSettled = false;
    let slotValue: Slots[string] = () => [];
    Object.defineProperty($slot, name, {
      set(value: Slots[string]) {
        isSettled = true;
        if (IS_DEV_MODE) {
          if (isRendered) {
            throw new Error(`Slot ${name} is already rendered`);
          }
        }
        slotValue = value;

        const slotRoots = createSlot(slotValue, params, name, ctx);
        renderElement(
          api,
          ctx,
          slotPlaceholder.parentNode!,
          // @ts-expect-error
          slotRoots,
          slotPlaceholder,
        );
        isRendered = true;
      },
      get() {
        if (isSettled) {
          return slotValue;
        }
        return undefined;
      },
    });
    return slotPlaceholder;
  }
  return createSlot($slot[name], params, name, ctx);
}

function getRenderTargets(api: DOMApi, debugName: string) {
  const ifPlaceholder = IS_DEV_MODE ? api.comment(debugName) : api.comment('');
  let outlet = isRehydrationScheduled()
    ? ifPlaceholder.parentElement || api.fragment()
    : api.fragment();

  if (!ifPlaceholder.isConnected) {
    api.insert(outlet, ifPlaceholder);
  }

  return {
    placeholder: ifPlaceholder,
    outlet,
  };
}

function toNodeReturnType(
  outlet: HTMLElement | DocumentFragment,
  ctx: AsyncListComponent<any> | SyncListComponent<any> | IfCondition,
) {
  // we assume we render items to some kind of container,
  // and this container may be app root
  // to exclude root from being part of the rendered nodes
  // we need to filter it out (taking only children)
  return $_fin(Array.from(outlet.childNodes), ctx);
}

function ifCond(
  cell: Cell<boolean>,
  trueBranch: BranchCb,
  falseBranch: BranchCb,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(api, 'if-entry-placeholder');
  const instance = new IfCondition(
    ctx,
    cell,
    outlet,
    placeholder,
    trueBranch,
    falseBranch,
  );
  return toNodeReturnType(outlet, instance);
}
export function $_eachSync<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(
    api,
    'sync-each-placeholder',
  );
  const instance = new SyncListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      ctx,
      key,
    },
    outlet,
    placeholder,
  );
  return toNodeReturnType(outlet, instance);
}
export function $_each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(
    api,
    'async-each-placeholder',
  );
  const instance = new AsyncListComponent(
    {
      tag: items as Cell<T[]>,
      ItemComponent: fn,
      key,
      ctx,
    },
    outlet,
    placeholder,
  );
  return toNodeReturnType(outlet, instance);
}
const ArgProxyHandler: ProxyHandler<{}> = {
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
    if (IS_DEV_MODE) {
      throw new Error('args are readonly');
    }
    return false;
  },
};
export function $_GET_ARGS(ctx: Component<any>, args: IArguments) {
  ctx[$args] = ctx[$args] || args[0] || {};
  ctx[RENDERED_NODES_PROPERTY] = ctx[RENDERED_NODES_PROPERTY] ?? [];
  ctx[COMPONENT_ID_PROPERTY] = ctx[COMPONENT_ID_PROPERTY] ?? cId();
  if (!SEEN_TREE_NODES.has(ctx)) {
    addToTree(getParentContext()!, ctx);
  }
}
export function $_GET_SLOTS(ctx: any, args: any) {
  return (args[0] || {})[$SLOTS_SYMBOL] || ctx[$args]?.[$SLOTS_SYMBOL] || {};
}
export function $_GET_FW(ctx: any, args: any) {
  return (
    (args[0] || {})[$PROPS_SYMBOL] || ctx[$args]?.[$PROPS_SYMBOL] || undefined
  );
}
export function $_args(
  args: Record<string, unknown>,
  slots: Record<string, () => Array<ComponentReturnType | Node>> | false,
  props: FwType,
) {
  if (IS_GLIMMER_COMPAT_MODE) {
    if (IS_DEV_MODE) {
      const newArgs: Record<string, () => unknown> = {
        [$SLOTS_SYMBOL]: slots ?? {},
        [$PROPS_SYMBOL]: props ?? {},
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
      Object.defineProperty(args, $PROPS_SYMBOL, {
        value: props ?? {},
        enumerable: false,
      });
      return new Proxy(args, ArgProxyHandler);
    }
  } else {
    Object.defineProperty(args, $PROPS_SYMBOL, {
      value: props ?? {},
      enumerable: false,
    });
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
export function $_dc(
  comp: () => ComponentReturnType | Component,
  args: Record<string, unknown>,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const _cmp = formula(comp, 'dynamic-component');
  let result: ComponentReturnType | null = null;
  let ref: unknown = null;
  const destructor = opcodeFor(_cmp, (value: any) => {
    if (typeof value !== 'function') {
      result = value;
      // @ts-expect-error typings error
      addToTree(ctx, result, 'from Dynamic component opcode');
      return;
    }
    if (value !== ref) {
      ref = value;
    } else {
      return;
    }
    if (result) {
      const target = result.ctx![RENDERED_NODES_PROPERTY].pop();
      const newTarget = IS_DEV_MODE
        ? api.comment('placeholder')
        : api.comment();
      api.insert(target!.parentNode!, newTarget, target);
      unregisterFromParent(result);
      destroyElementSync(result);
      result = component(value, args, ctx);
      result![$nodes].push(newTarget!);
      renderElement(api, ctx, newTarget!.parentNode!, result, newTarget!);
    } else {
      result = component(value, args, ctx);
    }
  });
  if (!_cmp.isConst) {
    result!.nodes.push(
      IS_DEV_MODE ? api.comment('placeholder') : api.comment(),
    );
    registerDestructor(ctx, destructor);
  } else {
    _cmp.destroy();
    destructor();
  }
  return {
    get ctx() {
      return result!.ctx;
    },
    get [$nodes]() {
      return result![$nodes];
    },
    set [$nodes](value) {
      result![$nodes] = value;
    },
  };
}
export const $_component = (component: any) => {
  console.log('component', component);
  return component;
};
export const $_maybeModifier = (
  modifier: any,
  element: HTMLElement,
  props: any[],
  hashArgs: () => Record<string, unknown>,
) => {
  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.modifier.canHandle(modifier)) {
      return $_MANAGERS.modifier.handle(modifier, element, props, hashArgs);
    }
  }
  if ('emberModifier' in modifier) {
    const instance = new modifier();
    instance.modify = instance.modify.bind(instance);
    const destructors: Destructors = [];
    return () => {
      console.log('running class-based  modifier');
      requestAnimationFrame(() => {
        const f = formula(() => {
          instance.modify(element, props, hashArgs());
        }, 'class-based modifier');
        destructors.push(
          opcodeFor(f, () => {
            console.log('opcode executed for modifier');
          }),
        );
      });
      return () => {
        destructors.forEach((fn) => fn());
        console.log('destroing class-based modifier');
        if ('willDestroy' in instance) {
          instance.willDestroy();
        }
        runDestructors(instance);
      };
    };
  } else {
    // console.log(modifier);
    // @ts-expect-error
    if (EmberFunctionalModifiers.has(modifier)) {
      return (element: HTMLElement) => {
        console.log('ember-functional-modifier', props, hashArgs());
        const args = hashArgs();
        const newArgs = {};
        Object.keys(args).forEach((key) => {
          Object.defineProperty(newArgs, key, {
            enumerable: true,
            get() {
              if (typeof args[key] === 'function') {
                // @ts-expect-error function signature
                return args[key]();
              } else {
                return args[key];
              }
            },
          });
        });
        return modifier(element, props, newArgs);
      };
    }
    return modifier;
  }
};
export const $_helper = (helper: any) => {
  console.log('helper', helper);
  return helper;
};
export const $_tag = _DOM;
export const $_api = (ctx: any) => initDOM(ctx);

export function $_fin(
  roots: Array<ComponentReturnType | Node>,
  ctx:
    | Component<any>
    | AsyncListComponent<any>
    | SyncListComponent<any>
    | IfCondition,
) {
  if (IS_DEV_MODE) {
    if (!ctx) {
      throw new Error('Components without context is not supported');
    }
  }

  return {
    [$nodes]: roots,
    ctx,
  };
}
