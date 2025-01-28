import {
  destroy,
  registerDestructor,
  destroySync,
} from '@/utils/glimmer/destroyable';
import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';
import { HTMLBrowserDOMApi, type DOMApi } from '@/utils/dom-api';
import {
  isFn,
  $args,
  $fwProp,
  isPrimitive,
  isArray,
  isEmpty,
  RENDERING_CONTEXT_PROPERTY,
  isTagLike,
  RENDERED_NODES_PROPERTY,
  cId,
  COMPONENT_ID_PROPERTY,
  TREE,
  CHILD,
  PARENT,
} from './shared';
import { resolveRenderable, Root, $_c } from './dom';
import {
  provideContext,
  initDOM,
  RENDERING_CONTEXT,
  cleanupFastContext,
} from './context';
import { createRoot, MergedCell } from '.';
import { opcodeFor } from './vm';
import { getFirstNode } from './control-flow/list';

export type ComponentRenderTarget =
  | Element
  | HTMLElement
  | DocumentFragment
  | ComponentReturnType;

export type GenericReturnType =
  | ComponentReturnType
  | Node
  | Array<ComponentReturnType | Node>
  | null
  | null[];

type RenderableElement =
  | GenericReturnType
  | Node
  | string
  | number
  | null
  | undefined;

// todo - define types of items
// arrays - nodes from DOM
// functions / objects - reactive items
// primitives - hanles
const RENDERED_COMPONENTS = new WeakSet();
export function renderElement(
  api: DOMApi,
  ctx: Component<any>,
  target: Node,
  el: RenderableElement | RenderableElement[] | MergedCell,
  placeholder: Comment | Node | null = null,
  skipRegistration = false,
) {
  if (isFn(el)) {
    // @ts-expect-error
    el = resolveRenderable(el);
  }
  if (isEmpty(el) || el === '') {
    return;
  }
  if (isPrimitive(el)) {
    let node = api.text(el);
    if (skipRegistration !== true) {
      ctx[RENDERED_NODES_PROPERTY].push(node);
    }
    api.insert(target, node, placeholder);
    return;
  }
  // @ts-expect-error isNode type
  if (api.isNode(el)) {
    if (!skipRegistration) {
      ctx[RENDERED_NODES_PROPERTY].push(el);
    }
    api.insert(target, el, placeholder);
    return;
  }
  if (RENDERED_NODES_PROPERTY in el) {
    if (RENDERED_COMPONENTS.has(el)) {
      // relocate case
      // move row case (node already rendered and re-located)
      const renderedNodes = el[RENDERED_NODES_PROPERTY];
      const childs = CHILD.get(el[COMPONENT_ID_PROPERTY]) ?? [];
      // we need to do proper relocation, considering initial child position
      const list: Array<[Node | null, Component<any> | Node]> = renderedNodes.map(
        (el) => [el, el],
      );
      for (let i = 0; i < childs.length; i++) {
        const child = TREE.get(childs[i])!;
        const firstChildNode = getFirstNode(api, child);
        list.push([firstChildNode, child]);
      }
      list.sort(([node1], [node2]) => {
        if (!node1) {
          return -1;
        }
        if (!node2) {
          return 1;
        }
        const position = node1.compareDocumentPosition(node2);
        if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
          return -1;
        } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
          return 1;
        }
        return 0;
      });
      list.forEach(([_, item]) => {
        renderElement(
          api,
          el as Component<any>,
          target,
          item,
          placeholder,
          true,
        );
      });
    } else {
      // fresh (not rendered component)
      // TODO: add same logic for IF (inside each)
      const oldRenderedNodes = el[RENDERED_NODES_PROPERTY].slice();
      el[RENDERED_NODES_PROPERTY].length = 0;
      oldRenderedNodes.forEach((node) => {
        renderElement(api, el as Component<any>, target, node, placeholder);
      });
      RENDERED_COMPONENTS.add(el);
    }
    return;
  }
  if (isTagLike(el)) {
    const node = api.text('');
    ctx[RENDERED_NODES_PROPERTY].push(node);
    api.insert(target, node, placeholder);
    registerDestructor(
      ctx,
      opcodeFor(el, (value) => {
        api.textContent(node, String(value ?? ''));
      }),
    );
    return;
  }
  if (isArray(el)) {
    for (let i = 0; i < el.length; i++) {
      renderElement(api, ctx, target, el[i], placeholder, skipRegistration);
    }
  } else {
    throw new Error(`Unknown rendering path`);
  }
}

export function renderComponent(
  component: typeof Component<any>,
  params: {
    owner?: Root;
    args?: Record<string, unknown>;
    element?: ComponentRenderTarget;
  } = {},
): ComponentReturnType {
  const appRoot = params.owner ?? createRoot();
  const target = params.element ?? document.body;
  const componentArgs = params.args ?? {};

  if (import.meta.env.DEV) {
    if (target === undefined) {
      throw new Error(`Trying to render undefined`);
    }
  }
  cleanupFastContext();
  const targetElement = targetFor(target);

  if (!initDOM(appRoot)) {
    // setting default dom api
    provideContext(
      appRoot,
      RENDERING_CONTEXT,
      new HTMLBrowserDOMApi((appRoot as Root).document),
    );
  }

  const instance = $_c(component, componentArgs, appRoot);

  const dom = initDOM(appRoot);
  renderElement(
    dom,
    instance,
    targetElement as unknown as HTMLElement,
    instance,
    targetElement.lastChild,
  );

  return instance;
}

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;
export class Component<T extends Props = any> implements ComponentReturnType {
  args!: Get<T, 'Args'>;
  [RENDERING_CONTEXT_PROPERTY]: undefined | DOMApi = undefined;
  [COMPONENT_ID_PROPERTY] = cId();
  declare [RENDERED_NODES_PROPERTY]: Array<Node>;
  declare [Context]: TemplateContext<
    this,
    Get<T, 'Args'>,
    Get<T, 'Blocks'>,
    Get<T, 'Element', null>
  >;
  declare [Invoke]: (
    args?: Get<T, 'Args'>,
  ) => ComponentReturn<Get<T, 'Blocks'>, Get<T, 'Element', null>>;
  nodes!: Node[];
  $fw: unknown;
  constructor(props: Get<T, 'Args'>, fw?: unknown) {
    this[$args] = props;
    this[$fwProp] = fw;
  }
  declare template: ComponentReturnType;
}

export type TOC<S extends Props = {}> = (
  args?: Get<S, 'Args'>,
) => ComponentReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>;

export function destroyElementSync(
  component: ComponentReturnType | Node | Array<ComponentReturnType | Node>,
  skipDom = false,
  api: DOMApi,
) {
  if (isArray(component)) {
    component.forEach((component) =>
      destroyElementSync(component, skipDom, api),
    );
  } else {
    if (RENDERED_NODES_PROPERTY in component) {
      runDestructorsSync(component, skipDom, api);
      if (IS_DEV_MODE) {
        // TODO: fix it!!
        // we trying to destroy "not rendered" component (but, likely it's rendered);
        // if (component[$nodes].length) {
        //   destroyNodes(api, component[$nodes]);
        //   console.error('Destroying not rendered node');
        // }
      }
    } else {
      try {
        (api as DOMApi).destroy(component);
      } catch (e) {
        // @TODO  custom renderer, destroy
        throw new Error('unknown branch');
      }
    }
  }
}

function destroyNodes(api: DOMApi, roots: Node | Array<Node>) {
  if (isArray(roots)) {
    for (let i = 0; i < roots.length; i++) {
      api.destroy(roots[i]);
    }
  } else {
    api.destroy(roots);
  }
}

export function unregisterFromParent(
  component: ComponentReturnType | Node | Array<ComponentReturnType | Node>,
) {
  if (!WITH_CONTEXT_API) {
    return;
  }
  if (isArray(component)) {
    component.forEach(unregisterFromParent);
  } else if (RENDERED_NODES_PROPERTY in component) {
    const id = component[COMPONENT_ID_PROPERTY];
    const arr = CHILD.get(PARENT.get(id)!);
    if (arr !== undefined) {
      const index = arr.indexOf(id);
      if (IS_DEV_MODE) {
        if (index === -1) {
          console.warn('TOOD: hmr negative index');
        }
      }
      if (index !== -1) {
        arr.splice(index, 1);
      }
    }
  }
}

export async function destroyElement(
  component: ComponentReturnType | Node | Array<ComponentReturnType | Node>,
  // should dom be "abstract" (in terms of different renderers)
  skipDom = false,
  api?: DOMApi,
) {
  if (isArray(component)) {
    await Promise.all(
      component.map((component) => destroyElement(component, skipDom, api)),
    );
  } else {
    if (RENDERED_NODES_PROPERTY in component) {
      const destructors: Array<Promise<void>> = [];
      runDestructors(component, destructors, skipDom, api);
      await Promise.all(destructors);
    } else {
      try {
        (api as DOMApi).destroy(component);
      } catch (e) {
        // @TODO  custom renderer, destroy
        throw new Error('unknown branch');
      }
    }
  }
}

function runDestructorsSync(
  targetNode: Component<any>,
  skipDom = false,
  api: DOMApi,
) {
  const stack = [targetNode];

  while (stack.length > 0) {
    const currentNode = stack.pop()!;
    const nodesToRemove = CHILD.get(currentNode[COMPONENT_ID_PROPERTY]);

    destroySync(currentNode);
    if (skipDom !== true) {
      destroyNodes(api, currentNode![RENDERED_NODES_PROPERTY]);
    }
    if (nodesToRemove) {
      for (const node of nodesToRemove) {
        stack.push(TREE.get(node)!);
      }
    }
  }
}
export function runDestructors(
  target: Component<any> | Root,
  promises: Array<Promise<void>> = [],
  skipDom = false,
  _api?: DOMApi,
): Array<Promise<void>> {
  const api = _api || initDOM(target);
  const childComponents = CHILD.get(target[COMPONENT_ID_PROPERTY]);
  // @todo - move it after child components;
  destroy(target, promises);
  if (childComponents) {
    /*
      we need slice here because of search for it:
      @todo - case 42 (associateDestroyable)
      tldr list may be mutated during removal and forEach is stopped
    */
    childComponents.forEach((node) => {
      const instance = TREE.get(node);
      // TODO: fix rehydration destroy case;
      if (instance) {
        runDestructors(instance, promises, skipDom, api);
      }
    });
  }
  if (skipDom !== true) {
    if (promises.length) {
      promises.push(
        Promise.all(promises).then(() => {
          destroyNodes(api, target[RENDERED_NODES_PROPERTY]);
        }),
      );
    } else {
      destroyNodes(api, target[RENDERED_NODES_PROPERTY]);
    }
  }
  return promises;
}

export function targetFor(
  outlet: ComponentRenderTarget,
): HTMLElement | DocumentFragment {
  if ('nodeType' in outlet) {
    return outlet as HTMLElement;
  } else {
    return outlet[RENDERED_NODES_PROPERTY][0] as HTMLElement;
  }
}

export type Slots = Record<
  string,
  (
    ...params: unknown[]
  ) => Array<ComponentReturnType | Node | Comment | string | number>
>;
export type ComponentReturnType = Component<any>;
