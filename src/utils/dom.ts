import {
  type ComponentReturnType,
  type Slots,
  type Component,
  renderElement,
  destroyElement,
  runDestructors,
  destroyElementSync,
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
} from '@/utils/control-flow/list';
import {
  DestructorFn,
  Destructors,
  registerDestructor,
} from './glimmer/destroyable';
import {
  api as HTMLAPI,
  getDocument,
} from '@/utils/dom-api';
import {
  isFn,
  isPrimitive,
  isTagLike,
  $template,
  $nodes,
  addToTree,
  RENDER_TREE,
  setBounds,
  $args,
  $DEBUG_REACTIVE_CONTEXTS,
  IN_SSR_ENV,
  COMPONENTS_HMR,
  isEmpty,
  FRAGMENT_TYPE,
  $context,
  RENDERING_CONTEXT_PROPERTY,
} from './shared';
import { isRehydrationScheduled } from './ssr/rehydration';
import { createHotReload } from './hmr';
import { IfCondition } from './control-flow/if';
import { CONSTANTS } from '../../plugins/symbols';
import { getContext, initDOM, RENDERING_CONTEXT } from './context';
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

type Fn = () => unknown;
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
  [RENDERING_CONTEXT_PROPERTY]: undefined | typeof HTMLAPI = undefined;
}
let ROOT: Root | null = null;

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
export function resetRoot() {
  ROOT = null;
}
export function setRoot(root: Root) {
  if (IS_DEV_MODE) {
    if (ROOT) {
      throw new Error('Root already exists');
    }
  }
  ROOT = root;
}
export function getRoot() {
  return ROOT;
}

function $prop(
  api: typeof HTMLAPI,
  element: HTMLElement,
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
  api: typeof HTMLAPI,
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
  api: typeof HTMLAPI,
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
  return name in slots;
}
export function $_hasBlockParams(
  slots: Record<string, unknown>,
  slotName = 'default',
) {
  return slots[`${slotName}_`];
}

function addAttrs(
  api: typeof HTMLAPI,
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
  api: typeof HTMLAPI,
  properties: TagProp[],
  element: HTMLElement,
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
    if (!getContext<typeof HTMLAPI>(getRoot()!, RENDERING_CONTEXT)) {
      console.error('Unable to resolve root rendering context');
    }
  }
  if (import.meta.env.DEV) {
    if (!api) {
      console.error('Unable to resolve rendering context');
    }
  }
  const element = api.element(tag);
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

  const hasSplatAttrs = typeof tagProps[3] === 'object';

  let hasShadowMode: ShadowRootMode = null;

  const setShadowNode = (value: ShadowRootMode) => {
    hasShadowMode = value;
  };

  if (hasSplatAttrs === true) {
    for (let i = 0; i < tagProps[3]![2].length; i++) {
      $ev(api, element, tagProps[3]![2][i][0], tagProps[3]![2][i][1], destructors);
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
    addProperties(api,
      tagProps[3]![0],
      element,
      seenKeys,
      destructors,
      classNameModifiers,
      setShadowNode,
    );
  }
  addProperties(api,
    tagProps[0],
    element,
    seenKeys,
    destructors,
    classNameModifiers,
    setShadowNode,
  );

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
        const tpl = getDocument().createElement('template');
        tpl.setAttribute('shadowrootmode', 'open');
        element.appendChild(tpl);
        // @ts-expect-error children type mismatch
        renderElement(api, ctx, tpl, children);
        // children.forEach((child, index) => {
        //   addChild(api, tpl, child, destructors, index);
        // });
      } else {
        // @ts-expect-error children type mismatch
        renderElement(api, ctx, appendRef!, children);

        // children.forEach((child, index) => {
        //   addChild(api, appendRef!, child, destructors, index);
        // });
      }
    } else {
      // @ts-expect-error children type mismatch
      renderElement(api, ctx, appendRef!, children);

      // children.forEach((child, index) => {
      //   addChild(api, appendRef!, child, destructors, index);
      // });
    }
  } else {
    // @ts-expect-error children type mismatch
    renderElement(api, ctx, element, children);

    // for (let i = 0; i < children.length; i++) {
    //   addChild(api, element, children[i], destructors, i);
    // }
  }

  registerDestructor(ctx, ...destructors);
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
      const destructors: Destructors = [];
      renderElement(api, ctx, appendRef, roots(ctx));
      // roots(ctx).forEach((child, index) => {
      //   addChild(api, appendRef, child, destructors, index);
      // });
      destructors.push(() => {
        appendRef.innerHTML = '';
      });
      registerDestructor(ctx, ...destructors);
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
      // console.log(this, ...arguments);
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

if (!import.meta.env.SSR) {
  if (IS_DEV_MODE) {
    // @ts-expect-error global
    window.utils = {
      getRoot,
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

function component(
  comp: ComponentReturnType | Component,
  args: Record<string, unknown>,
  ctx: Component<any>,
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
        label = `<${label} ${JSON.stringify(args)} />`;
      }
      // @ts-expect-error uniqSymbol as index
      const fw = args[$PROPS_SYMBOL] as unknown as FwType;
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
          errorOverlay = HTMLAPI.element('pre');
          // @ts-expect-error stack may not exit
          HTMLAPI.textContent(errorOverlay, `${label}\n${e.stack ?? e}`);
          HTMLAPI.attr(
            errorOverlay,
            'style',
            'color:red;border:1px solid red;padding:10px;background-color:#333;',
          );
        } else {
          errorOverlay = new ErrorOverlayClass(e, true);
        }
        console.error(label, e);

        return {
          ctx: null,
          nodes: [errorOverlay],
        };
      } else {
        return {
          ctx: null,
          // @ts-expect-error message may not exit
          nodes: [HTMLAPI.text(String(e.message))],
        };
      }
    } finally {
      if (IS_DEV_MODE) {
        $DEBUG_REACTIVE_CONTEXTS.pop();
      }
    }
  } else {
    // @ts-expect-error uniqSymbol as index
    const fw = args[$PROPS_SYMBOL] as unknown as FwType;
    return _component(comp, args, fw, ctx);
  }
}
// hello, basic component manager
function _component(
  _comp: ComponentReturnType | Component,
  args: Record<string, unknown>,
  fw: FwType,
  ctx: Component<any>,
) {
  args[$context] = ctx;
  let comp = _comp;
  if (WITH_EMBER_INTEGRATION) {
    if ($_MANAGERS.component.canHandle(_comp)) {
      comp = $_MANAGERS.component.handle(_comp, args, fw, ctx);
    }
  }
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
    addToTree(ctx, instance);
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
    addToTree(ctx, instance.ctx);
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
  const elements = value(...[...params(), ctx]);
  if (IS_DEV_MODE) {
    $DEBUG_REACTIVE_CONTEXTS.pop();
  }
  return elements;
}

function slot(name: string, params: () => unknown[], $slot: Slots, ctx: any) {
  const api = initDOM(ctx);
  const $destructors: Destructors = [];
  registerDestructor(ctx, () => {
    $destructors.forEach((fn) => fn());
  });
  if (!(name in $slot)) {
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
        const slotRoots = createSlot(
          slotValue,
          params,
          name,
          ctx,
        );
        $destructors.push(() => {
          // @ts-expect-error types mismatch
          destroyElement(slotRoots);
        });
        renderElement(api, ctx, slotPlaceholder.parentNode!, slotRoots, slotPlaceholder);
        isRendered = true;
      },
      get() {
        if (isSettled) {
          return slotValue;
        }
        if (IS_DEV_MODE) {
          throw new Error(`Slot ${name} is not set`);
        }
      },
    });
    return slotPlaceholder;
  }
  const slotRoot = createSlot($slot[name], params, name, ctx);
  $destructors.push(() => {
    // @ts-expect-error types mismatch
    destroyElement(slotRoot);
  });
  return slotRoot;
}
export function cellToText(api: typeof HTMLAPI, cell: Cell | MergedCell, destructors: Destructors) {
  const textNode = api.text('');
  destructors.push(
    opcodeFor(cell, (value) => {
      api.textContent(textNode, String(value ?? ''));
    }),
  );
  return textNode;
}
function text(
  api: typeof HTMLAPI,
  text: string | number | null | Cell | MergedCell | Fn | RenderableType,
  destructors: Destructors,
): Text {
  const result = $_TO_VALUE(text);
  if (isEmpty(result)) {
    return api.text('');
  } else if (isPrimitive(result)) {
    return api.text(result);
  } else {
    // @ts-expect-error
    return cellToText(api, typeof text === 'function' ? result : text, destructors);
  }
}

function getRenderTargets(api: typeof HTMLAPI, debugName: string) {
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
  ctx: any = null,
) {
  if (outlet.nodeType !== FRAGMENT_TYPE) {
    return outlet;
  }
  return {
    ctx,
    [$nodes]: Array.from(outlet.childNodes),
  };
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
  // @ts-expect-error instance type mismatch
  addToTree(ctx, instance);
  return toNodeReturnType(outlet, instance);
}
export function $_eachSync<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(api, 'sync-each-placeholder');
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
  addToTree(ctx, instance as unknown as Component<any>);
  return toNodeReturnType(outlet, instance);
}
export function $_each<T extends { id: number }>(
  items: Cell<T[]> | MergedCell,
  fn: (item: T) => Array<ComponentReturnType | Node>,
  key: string | null = null,
  ctx: Component<any>,
) {
  const api = initDOM(ctx);
  const { outlet, placeholder } = getRenderTargets(api, 'async-each-placeholder');
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
  addToTree(ctx, instance as unknown as Component<any>);
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
  set(target, prop, value) {
    if (prop === $context) {
      // @ts-expect-error unknown property
      target[prop] = value;
      return true;
    }
    if (IS_DEV_MODE) {
      throw new Error('args are readonly');
    }
    return false;
  },
};
export function $_GET_ARGS(ctx: any, args: any) {
  ctx[$args] = ctx[$args] || args[0] || {};
  const parentContext = ctx[$args][$context];
  if (parentContext) {
    // console.log('context', parentContext, ctx);
    addToTree(parentContext, ctx);
  } else {
    // @ts-expect-error typings error
    addToTree(getRoot()!, ctx);
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
      addToTree(ctx, result);
      return;
    }
    if (value !== ref) {
      ref = value;
    } else {
      return;
    }
    if (result) {
      const target = result[$nodes].pop();
      destroyElementSync(result);
      result = component(value, args, ctx);
      result![$nodes].push(target!);
      renderElement(api, ctx, target!.parentNode!, result, target!);
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
export const $_text = text;
export const $_tag = _DOM;
export const $_api = (ctx: any) => initDOM(ctx);

export function $_fin(
  roots: Array<ComponentReturnType | Node>,
  ctx: Component<any> | null,
) {
  const $destructors: Destructors = [];
  const api = initDOM(ctx!);
  for (let i = 0; i < roots.length; i++) {
    const node = roots[i];
    if (isFn(node)) {
      roots[i] = text(api,
        resolveRenderable(node, `component child fn`),
        $destructors,
      );
    }
  }

  return {
    [$nodes]: roots,
    ctx,
  };
}
