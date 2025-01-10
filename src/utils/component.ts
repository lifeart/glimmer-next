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
import { api as DEFAULT_API } from '@/utils/dom-api';
import {
  isFn,
  $template,
  $nodes,
  $args,
  $fwProp,
  RENDER_TREE,
  isPrimitive,
  isArray,
  isEmpty,
  PARENT_GRAPH,
  RENDERING_CONTEXT_PROPERTY,
  isTagLike,
  RENDERED_NODES_PROPERTY,
} from './shared';
import { createRoot, getRoot, resolveRenderable, Root, setRoot } from './dom';
import { provideContext, initDOM, RENDERING_CONTEXT } from './context';
import { cellToText, MergedCell } from '.';

export type ComponentRenderTarget =
  | HTMLElement
  | DocumentFragment
  | ComponentReturnType;

export type GenericReturnType =
  | ComponentReturnType
  | Node
  | Array<ComponentReturnType | Node>
  | null
  | null[];

type RenderableElement = GenericReturnType | Node | string | number | null | undefined;

export function renderElement(
  api: typeof DEFAULT_API,
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
      ctx[RENDERED_NODES_PROPERTY].push(node);
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
  component: ComponentReturnType,
  target: ComponentRenderTarget,
  owner?: any,
  skipRoot?: boolean,
): ComponentReturnType {
  if (import.meta.env.DEV) {
    if (target === undefined) {
      throw new Error(`Trying to render undefined`);
    }
  }
  const targetElement = targetFor(target);
  const appRoot = getRoot();

  if (!skipRoot) {
    if (appRoot !== null && appRoot !== owner) {
      if (import.meta.env.DEV) {
        throw new Error(`Root already exists, it may lead to memory leaks, 
          at the moment we allow only one root. Let us know if you need more.
          To manually fix this issue you may save existing root reference and cleanup root.
          try "getRoot()" to resolve root reference for last rendered root component,
          and once you get it, call "resetRoot", and try to re-render component one more time.
        `);
      }
    } else {
      if (appRoot === null) {
        setRoot(createRoot());
      }
    }
    if (!initDOM(getRoot()!)) {
      // setting default dom api
      provideContext(getRoot()!, RENDERING_CONTEXT, DEFAULT_API);
    }
  }

  if ($template in component && isFn(component[$template])) {
    return renderComponent(
      component[$template](),
      targetElement,
      component,
      true,
    );
  }

  const children = component[$nodes];

  const dom = initDOM(owner || component) || initDOM(getRoot()!);
  if (TRY_CATCH_ERROR_HANDLING) {
    try {
      renderElement(dom, owner || component, targetElement as unknown as HTMLElement, children, targetElement.lastChild);
    } catch (e) {
      runDestructorsSync(owner || component);
      throw e;
    }
  } else {
    renderElement(dom, owner || component, targetElement as unknown as HTMLElement, children, targetElement.lastChild);
  }

  return component;
}

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;
export class Component<T extends Props = any>
  implements Omit<ComponentReturnType, 'ctx'>
{
  args!: Get<T, 'Args'>;
  [RENDERING_CONTEXT_PROPERTY]: undefined | typeof DEFAULT_API = undefined;
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
  template!: ComponentReturnType;
}

export type TOC<S extends Props = {}> = (
  args?: Get<S, 'Args'>,
) => ComponentReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>;

function destroyNode(node: Node) {
  if (IS_DEV_MODE) {
    if (!('nodeType' in node)) {
      throw new Error('Unable to destroy node');
    }
  }
  if (!node.isConnected) {
    return;
  }
  if (IS_DEV_MODE) {
    const parent = node.parentNode;
    if (parent !== null) {
      parent.removeChild(node);
    } else {
      if (import.meta.env.SSR) {
        console.warn(`Node is not in DOM`, node.nodeType, node.nodeName);
        return;
      }
      throw new Error(`Node is not in DOM`);
    }
  } else {
    node.parentNode!.removeChild(node);
  }
}

export function destroyElementSync(
  component:
    | ComponentReturnType
    | Node
    | Array<ComponentReturnType | Node>,
  skipDom = false,
) {
  if (isArray(component)) {
    component.forEach((component) => destroyElementSync(component, skipDom));
  } else {
    if ($nodes in component) {
      runDestructorsSync(component.ctx!, skipDom);
    } else {
      destroyNode(component);
    }
  }
}

function destroyNodes(
  roots: Node | Array<Node>,
) {
  if (isArray(roots)) {
    for (let i = 0; i < roots.length; i++) {
      destroyNode(roots[i]);
    }
  } else {
    destroyNode(roots);
  }
}

export async function destroyElement(
  component:
    | ComponentReturnType
    | Node
    | Array<ComponentReturnType | Node>,
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
    const nodesToRemove = RENDER_TREE.get(currentNode);

    destroySync(currentNode);
    if (skipDom !== true) {
      destroyNodes(currentNode![RENDERED_NODES_PROPERTY]);
    }

    if (WITH_CONTEXT_API) {
      PARENT_GRAPH.delete(currentNode);
    }
    if (nodesToRemove !== undefined) {
      /*
        we need slice here because of search for it:
        @todo - case 42 (associateDestroyable)
        tldr list may be mutated during removal and forEach is stopped
      */
      stack.push(...nodesToRemove);
    }
  }
}
export function runDestructors(
  target: Component<any> | Root,
  promises: Array<Promise<void>> = [],
  skipDom = false,
): Array<Promise<void>> {
  const childComponents = RENDER_TREE.get(target);
  destroy(target, promises);
  if (childComponents) {
    /*
      we need slice here because of search for it:
      @todo - case 42 (associateDestroyable)
      tldr list may be mutated during removal and forEach is stopped
    */
    Array.from(childComponents).forEach((node) => {
      runDestructors(node, promises, skipDom);
    });
  }
  if (WITH_CONTEXT_API) {
    PARENT_GRAPH.delete(target);
  }
  if (skipDom !== true) {
    if (promises.length) {
      promises.push(Promise.all(promises).then(() => {
        destroyNodes(target[RENDERED_NODES_PROPERTY]);
      }));
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
    return outlet;
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
