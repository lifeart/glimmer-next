import { type ComponentReturnType } from '@/utils/component';
import { getNodeCounter, resetNodeCounter } from '@/utils/dom';
import { api as rehydrationDomApi } from '@/utils/ssr/rehydration-dom-api';
import { api as domApi } from '@/utils/dom-api';
const withRehydrationStack: HTMLElement[] = [];
const commentsToRehydrate: Comment[] = [];
let rehydrationScheduled = false;
const nodesToRemove: Set<Node> = new Set();
const nodesMap: Map<number, HTMLElement> = new Map();

export function lastItemInStack(target: 'text' | 'node' | 'comment') {
  if (target === 'text') {
    return withRehydrationStack[withRehydrationStack.length - 1];
  } else if (target === 'node') {
    const maybeNextNode = nodesMap.get(getNodeCounter());
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
    nodesMap.set(parseInt(node.dataset.nodeId!, 10), node);
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

const originalDomAPI = { ...domApi };
function patchDOMAPI() {
  domApi.attr = rehydrationDomApi.attr;
  domApi.comment = rehydrationDomApi.comment;
  // @ts-expect-error
  domApi.text = rehydrationDomApi.text;
  domApi.textContent = rehydrationDomApi.textContent;
  domApi.fragment = rehydrationDomApi.fragment;
  domApi.element = rehydrationDomApi.element;
  domApi.append = rehydrationDomApi.append;
  domApi.insert = rehydrationDomApi.insert;
}
function rollbackDOMAPI() {
  domApi.attr = originalDomAPI.attr;
  domApi.comment = originalDomAPI.comment;
  domApi.text = originalDomAPI.text;
  domApi.textContent = originalDomAPI.textContent;
  domApi.fragment = originalDomAPI.fragment;
  domApi.element = originalDomAPI.element;
  domApi.append = originalDomAPI.append;
  domApi.insert = originalDomAPI.insert;
}

export function withRehydration(
  componentCreationCallback: () => ComponentReturnType,
  targetNode: HTMLElement, // the node to render the component into
) {
  try {
    rehydrationScheduled = true;
    pushToStack(targetNode, true);
    resetNodeCounter();
    patchDOMAPI();

    // @ts-expect-error
    nodesToRemove.forEach((node) => node.remove());
    // withRehydrationStack.reverse();
    // console.log('withRehydrationStack', withRehydrationStack);
    componentCreationCallback();
    if (withRehydrationStack.length > 0) {
      console.warn('withRehydrationStack is not empty', withRehydrationStack);
      // withRehydrationStack.forEach((node) => {
      //   node.remove();
      // });
      withRehydrationStack.length = 0;
    }
    rehydrationScheduled = false;
    nodesMap.clear();
    rollbackDOMAPI();
  } catch (e) {
    rehydrationScheduled = false;
    withRehydrationStack.length = 0;
    nodesMap.clear();
    resetNodeCounter();
    rollbackDOMAPI();
    throw e;
  }
}
