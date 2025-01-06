import { renderComponent, type ComponentReturnType } from '@/utils/component';
import { createRoot, getNodeCounter, getRoot, resetNodeCounter, setRoot } from '@/utils/dom';
import { api as rehydrationDomApi } from '@/utils/ssr/rehydration-dom-api';
import { api, RENDERING_CONTEXT } from '@/utils/dom-api';
import { $args, $context, $template } from '../shared';
import { provideContext } from '../context';
const withRehydrationStack: HTMLElement[] = [];
const commentsToRehydrate: Comment[] = [];
let rehydrationScheduled = false;
const nodesToRemove: Set<Node> = new Set();
const nodesMap: Map<string, HTMLElement> = new Map();

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
  componentCreationCallback: () => ComponentReturnType,
  targetNode: HTMLElement, // the node to render the component into
) {
  try {
    rehydrationScheduled = true;
    pushToStack(targetNode, true);
    resetNodeCounter();
    const root = getRoot() || createRoot();
    setRoot(root);
    provideContext(root, RENDERING_CONTEXT, rehydrationDomApi);

    // @ts-expect-error
    nodesToRemove.forEach((node) => node.remove());
    // withRehydrationStack.reverse();
    // console.log('withRehydrationStack', withRehydrationStack);
    // @ts-expect-error typings mismatch
    const wrapper = {
      [$args]: {
        [$context]: root,
      },
      [$template]: function () {
        // @ts-expect-error typings mismatch
        return new componentCreationCallback(...arguments);
      },
    } as ComponentReturnType;
    renderComponent(wrapper, targetNode, root, true);
    if (withRehydrationStack.length > 0) {
      console.warn('withRehydrationStack is not empty', withRehydrationStack);
      // withRehydrationStack.forEach((node) => {
      //   node.remove();
      // });
      withRehydrationStack.length = 0;
    }
    rehydrationScheduled = false;
    nodesMap.clear();
    provideContext(root, RENDERING_CONTEXT, api);
    // rollbackDOMAPI();
  } catch (e) {
    rehydrationScheduled = false;
    withRehydrationStack.length = 0;
    nodesMap.clear();
    resetNodeCounter();
    const root = getRoot()!;
    provideContext(root, RENDERING_CONTEXT, api);
    throw e;
  }
}
