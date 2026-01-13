import { renderComponent, runDestructors, Component } from '@/utils/component';
import { createRoot, getNodeCounter, resetNodeCounter, Root } from '@/utils/dom';
import { HTMLRehydrationBrowserDOMApi } from '@/utils/ssr/rehydration-dom-api';
import { SVGRehydrationBrowserDOMApi } from '@/utils/ssr/svg-rehydration-dom-api';
import { MathMLRehydrationBrowserDOMApi } from '@/utils/ssr/mathml-rehydration-dom-api';
import { HTMLBrowserDOMApi, type DOMApi } from '@/utils/dom-api';
import { SVGBrowserDOMApi } from '@/utils/svg-api';
import { MathMLBrowserDOMApi } from '@/utils/math-api';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT, API_FACTORY_CONTEXT } from '../context';
import { NS_SVG, NS_MATHML } from '@/utils/namespaces';

export type ApiFactory = (namespace?: string) => DOMApi;
export type ApiFactoryWrapper = { factory: ApiFactory };
const withRehydrationStack: HTMLElement[] = [];
const commentsToRehydrate: Comment[] = [];
let rehydrationScheduled = false;
const nodesToRemove: Set<Node> = new Set();
const nodesMap: Map<string, HTMLElement> = new Map();

export function nodeById(nodeId: string) {
  return nodesMap.get(nodeId);
}
 
export function lastItemInStack(target: 'text' | 'node' | 'comment') {
  if (target === 'text') {
    return withRehydrationStack[withRehydrationStack.length - 1];
  } else if (target === 'node') {
    const maybeNextNode = nodesMap.get(String(getNodeCounter()));
    if (maybeNextNode) {
      // remove data attribute
      // remove from stack
      const indexInStack = withRehydrationStack.indexOf(maybeNextNode);
      if (indexInStack > -1) {
        withRehydrationStack.splice(indexInStack, 1);
        withRehydrationStack.push(maybeNextNode);
      }
      return maybeNextNode;
    }
  } else if (target === 'comment') {
    const nodeCounter = getNodeCounter();
    const maybeNextNode = commentsToRehydrate.find((node) => {
      return (
        node.nodeType === Node.COMMENT_NODE &&
        node.textContent?.includes(`$[${nodeCounter}]`)
      );
    }) as unknown as HTMLElement;
    if (maybeNextNode) {
      // remove from stack
      withRehydrationStack.push(maybeNextNode);
      commentsToRehydrate.splice(
        commentsToRehydrate.indexOf(maybeNextNode as unknown as Comment),
        1,
      );
      return maybeNextNode;
    } else {
      console.warn(`Unable to find comment node with id: ${nodeCounter}.`);
    }
  }
  // console.log('withRehydrationStack', withRehydrationStack);
  // debugger;
  return withRehydrationStack[withRehydrationStack.length - 1];
}
export function itemFromRehydrationStack() {
  const nextItem = withRehydrationStack.pop();
  if (nextItem && nextItem.nodeType !== Node.COMMENT_NODE) {
  }

  return nextItem;
}

export function isRehydrationScheduled() {
  return rehydrationScheduled;
}

/*
    <div class="text-white p-3">
      <h1>
        <q>Compilers are the New Frameworks</q> - Tom Dale ©
      </h1>
      <br>
      <h2>Imagine a world </h2>
    </div>
    
    ---

    rechydration stack should looks like this (we have to pop it):
    
        [q, h1, br, h2, div]
    

*/

function pushToStack(node: HTMLElement, isFirst = false) {
  if (node.dataset.nodeId) {
    nodesMap.set(node.dataset.nodeId, node);
    node.removeAttribute('data-node-id');
  }
  const childs = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
  if (!isFirst) {
    withRehydrationStack.push(node);
  }

  const totalChilds = childs.length;
  if (childs.length === 1 && childs[0].nodeType === Node.TEXT_NODE) {
    // console.log('skipChild for node',  node);
    // return;
    // childs[0].textContent = '';
    // withRehydrationStack.push(childs[0] as HTMLElement);
    // if (!isFirst) {
    //   withRehydrationStack.push(node);
    // }
    // return;
  }
  for (let i = totalChilds - 1; i >= 0; i--) {
    const el = childs[i];
    if (el.nodeType === Node.TEXT_NODE) {
      nodesToRemove.add(el);
      continue;
    } else if (el.nodeType === Node.COMMENT_NODE) {
      commentsToRehydrate.push(el as Comment);
    } else {
      pushToStack(el as HTMLElement);
    }
  }
}

export function withRehydration(
  componentCreationCallback: typeof Component<any>,
  args: Record<string, unknown>,
  targetNode: HTMLElement, // the node to render the component into
  root: Root = createRoot(),
) {
  const api = new HTMLRehydrationBrowserDOMApi(document);
  // Track all APIs created during rehydration for upgrading after completion
  const createdApis: Array<{ api: DOMApi; namespace?: string }> = [
    { api, namespace: undefined },
  ];

  // Factory function that creates namespace-appropriate rehydration APIs
  // Wrapped in an object to prevent getContext from calling it (getContext calls functions)
  const apiFactory: { factory: ApiFactory } = {
    factory: (namespace?: string) => {
      let newApi: DOMApi;
      if (namespace === NS_SVG) {
        newApi = new SVGRehydrationBrowserDOMApi(document);
      } else if (namespace === NS_MATHML) {
        newApi = new MathMLRehydrationBrowserDOMApi(document);
      } else {
        newApi = new HTMLRehydrationBrowserDOMApi(document);
      }
      createdApis.push({ api: newApi, namespace });
      return newApi;
    },
  };

  try {
    rehydrationScheduled = true;
    pushToStack(targetNode, true);
    resetNodeCounter();
    cleanupFastContext();
    provideContext(root, RENDERING_CONTEXT, api);
    provideContext(root, API_FACTORY_CONTEXT, apiFactory);

    nodesToRemove.forEach((node) => {
      // replace node with comment
      const comment = document.createComment('[text-placeholder]');
      if (node.parentElement) {
        node.parentElement.replaceChild(comment, node);
      } else {
        // @ts-expect-error typings mismatch
        node.remove();
      }
    });

    renderComponent(componentCreationCallback, {
      args, element: targetNode, owner: root,
    });
    if (withRehydrationStack.length > 0) {
      const lastNodes = Array.from(withRehydrationStack);
      console.warn('withRehydrationStack is not empty', lastNodes);
      withRehydrationStack.length = 0;
      if (lastNodes.filter((node) => node.parentElement && node.isConnected).length) {
        throw new Error('withRehydrationStack is not empty and node is connected');
      } else {
        lastNodes.forEach((el) =>  {
          if (el.isConnected) {
            el.remove();
          }
        });
      }
    }
    rehydrationScheduled = false;
    nodesMap.clear();

    // Upgrade all rehydration APIs to standard browser API methods
    // Note: Must use getOwnPropertyNames since class methods are non-enumerable
    for (const { api: rehydrationApi, namespace } of createdApis) {
      let targetPrototype: object;
      if (namespace === NS_SVG) {
        targetPrototype = SVGBrowserDOMApi.prototype;
      } else if (namespace === NS_MATHML) {
        targetPrototype = MathMLBrowserDOMApi.prototype;
      } else {
        targetPrototype = HTMLBrowserDOMApi.prototype;
      }
      Object.getOwnPropertyNames(targetPrototype).forEach((key) => {
        if (key !== 'constructor') {
          // @ts-expect-error props
          rehydrationApi[key] = targetPrototype[key];
        }
      });
    }
  } catch (e) {
    rehydrationScheduled = false;
    withRehydrationStack.length = 0;
    nodesMap.clear();
    runDestructors(root);
    resetNodeCounter();
    throw e;
  }
}
