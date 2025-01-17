import {
  destroy,
  registerDestructor,
  Destructors,
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
  $nodes,
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
  $context,
} from './shared';
import { resolveRenderable, Root, $_c } from './dom';
import {
  provideContext,
  initDOM,
  RENDERING_CONTEXT,
  cleanupFastContext,
} from './context';
import { cellToText, createRoot, MergedCell } from '.';

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

export function renderElement(
  api: DOMApi,
  ctx: Component<any>,
  target: Node,
  el: RenderableElement | RenderableElement[] | MergedCell,
  placeholder: Comment | Node | null = null,
  skipRegistration = false,
) {
  if (isEmpty(el) || el === '') {
    return;
  }
  if (!isArray(el)) {
    if (isPrimitive(el)) {
      let node = api.text(el);
      if (skipRegistration !== true) {
        ctx[RENDERED_NODES_PROPERTY].push(node);
      }
      api.insert(target, node, placeholder);
    } else if ((el as HTMLElement).nodeType) {
      if (skipRegistration !== true) {
        ctx[RENDERED_NODES_PROPERTY].push(el as Node);
      }
      api.insert(target, el as Node, placeholder);
    } else if ($nodes in el) {
      el[$nodes].forEach((node) => {
        // @ts-expect-error el.ctx
        renderElement(api, el.ctx, target, node, placeholder);
      });
      el[$nodes].length = 0;
      // el.ctx![RENDERED_NODES_PROPERTY].reverse();
    } else if (isFn(el)) {
      // @ts-expect-error
      renderElement(api, ctx, target, resolveRenderable(el), placeholder);
    } else if (isTagLike(el)) {
      const destructors: Destructors = [];
      const node = cellToText(api, el, destructors);
      ctx[RENDERED_NODES_PROPERTY].push(node);
      api.insert(target, node, placeholder);
      registerDestructor(ctx, ...destructors);
    } else {
      throw new Error(`Unknown element type ${el}`);
    }
  } else {
    for (let i = 0; i < el.length; i++) {
      renderElement(api, ctx, target, el[i], placeholder, true);
    }
  }
}

export function renderComponent(
  component: typeof Component<any>,
  componentArgs: Record<string, unknown>,
  target: ComponentRenderTarget,
  appRoot: Root | Component<any> = createRoot(),
  skipRoot?: boolean,
): ComponentReturnType {
  if (import.meta.env.DEV) {
    if (target === undefined) {
      throw new Error(`Trying to render undefined`);
    }
  }
  cleanupFastContext();
  const targetElement = targetFor(target);

  if (!skipRoot) {
    if (!initDOM(appRoot)) {
      // setting default dom api
      provideContext(
        appRoot,
        RENDERING_CONTEXT,
        new HTMLBrowserDOMApi((appRoot as Root).document),
      );
    }
  }

  const args = {
    ...componentArgs,
    ...{
      [$context]: appRoot,
    },
  };
  const instance = $_c(component, args, appRoot);

  const dom = initDOM(appRoot);
  const children = instance[$nodes];
  renderElement(
    dom,
    instance.ctx!,
    targetElement as unknown as HTMLElement,
    children,
    targetElement.lastChild,
  );

  return instance;
}

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;
export class Component<T extends Props = any>
  implements Omit<ComponentReturnType, 'ctx'>
{
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

function destroyNode(node: Node) {
  // Skip if node is already detached
  if (!node.isConnected) return;
  // @ts-expect-error
  node.remove();
}

export function destroyElementSync(
  component: ComponentReturnType | Node | Array<ComponentReturnType | Node>,
  skipDom = false,
) {
  if (isArray(component)) {
    component.forEach((component) => destroyElementSync(component, skipDom));
  } else {
    if ($nodes in component) {
      if (IS_DEV_MODE) {
        if (!component.ctx) {
          throw new Error('context should match');
        }
      }
      runDestructorsSync(component.ctx!, skipDom);
    } else {
      destroyNode(component);
    }
  }
}

function destroyNodes(roots: Node | Array<Node>) {
  if (isArray(roots)) {
    for (let i = 0; i < roots.length; i++) {
      destroyNode(roots[i]);
    }
  } else {
    destroyNode(roots);
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
  } else if ($nodes in component) {
    const id = component.ctx![COMPONENT_ID_PROPERTY];
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
  skipDom = false,
) {
  if (isArray(component)) {
    await Promise.all(
      component.map((component) => destroyElement(component, skipDom)),
    );
  } else {
    if ($nodes in component) {
      const destructors: Array<Promise<void>> = [];
      runDestructors(component.ctx!, destructors, skipDom);
      await Promise.all(destructors);
    } else {
      if ('nodeType' in component) {
        destroyNode(component);
      } else {
        throw new Error('unknown branch');
      }
    }
  }
}

function runDestructorsSync(targetNode: Component<any>, skipDom = false) {
  const stack = [targetNode];

  while (stack.length > 0) {
    const currentNode = stack.pop()!;
    const nodesToRemove = CHILD.get(currentNode[COMPONENT_ID_PROPERTY]);

    destroySync(currentNode);
    if (skipDom !== true) {
      destroyNodes(currentNode![RENDERED_NODES_PROPERTY]);
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
): Array<Promise<void>> {
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
        runDestructors(instance, promises, skipDom);
      }
    });
  }
  if (skipDom !== true) {
    if (promises.length) {
      promises.push(
        Promise.all(promises).then(() => {
          destroyNodes(target[RENDERED_NODES_PROPERTY]);
        }),
      );
    } else {
      destroyNodes(target[RENDERED_NODES_PROPERTY]);
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
    return outlet[$nodes][0] as HTMLElement;
  }
}

export type Slots = Record<
  string,
  (
    ...params: unknown[]
  ) => Array<ComponentReturnType | Node | Comment | string | number>
>;
export type ComponentReturnType = {
  nodes: Node[];
  ctx: Component<any> | null;
};
