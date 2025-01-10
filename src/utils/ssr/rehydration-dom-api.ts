import { getNodeCounter, incrementNodeCounter } from '@/utils/dom';

import { getDocument } from '@/utils/dom-api';
import {
  isRehydrationScheduled,
  itemFromRehydrationStack,
  lastItemInStack,
} from './rehydration';
import { isEmpty } from '../shared';
const $doc = getDocument();
export const api = {
  toString() {
    return 'hydration-html:dom-api';
  },
  addEventListener(node: Node, eventName: string, fn: EventListener) {
    node.addEventListener(eventName, fn);
    if (RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES) {
      return () => {
        node.removeEventListener(eventName, fn);
      };
    }
  },
  prop(element: HTMLElement, name: string, value: any) {
    if (isRehydrationScheduled()) {
      // @ts-ignore
      if (element[name] === value) {
        return value;
      }
    }
    // @ts-ignore
    element[name] = value;
    return value;
  },
  attr(element: HTMLElement, name: string, value: string | null) {
    if (isRehydrationScheduled()) {
      const existingValue = element.getAttribute(name);
      if (existingValue === value) {
        return;
      }
    }
    element.setAttribute(name, value === null ? '' : value);
  },
  comment(text = '') {
    incrementNodeCounter();
    if (isRehydrationScheduled()) {
      const lastItem = lastItemInStack('comment');
      if (lastItem !== undefined) {
        if (lastItem.nodeType === Node.COMMENT_NODE) {
          const node = itemFromRehydrationStack();
          // check tagName
          if (node && node.nodeType === Node.COMMENT_NODE) {
            return node as unknown as Comment;
          } else {
            throw new Error(
              `Rehydration failed. Expected tagName: ${node}, got: ${node?.tagName}.`,
            );
          }
        } else {
          // console.warn(
          //   'Rehydration may be filed. Expected comment node, got: ',
          //   lastItem,
          // );
        }
      }
    }
    return $doc.createComment(`${text} $[${getNodeCounter()}]`);
  },
  text(text = '') {
    // console.log('text', text);
    if (isRehydrationScheduled()) {
      const nextItem = lastItemInStack('text');
      if (nextItem && nextItem.nodeType === Node.TEXT_NODE) {
        const node = itemFromRehydrationStack();
        // check tagName
        if (node && node.nodeType === Node.TEXT_NODE) {
          if (node.textContent !== text) {
            node.textContent = text;
          }
          return node;
        } else {
          throw new Error(
            `Rehydration failed. Expected textContent, got: ${node?.tagName}.`,
          );
        }
      }
    }
    return $doc.createTextNode(text);
  },
  textContent(node: Node, text: string) {
    if (isRehydrationScheduled()) {
      const existingText = node.textContent;
      if (existingText === text) {
        return;
      }
    }
    node.textContent = text;
  },
  fragment() {
    return $doc.createDocumentFragment();
  },
  element(tagName = ''): HTMLElement {
    // console.log('element', tagName);
    if (isRehydrationScheduled()) {
      let nextNode = lastItemInStack('node');
      if (nextNode && nextNode.nodeType === Node.COMMENT_NODE) {
        itemFromRehydrationStack();
        return this.element(tagName);
      } else if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
        const dummyNode = itemFromRehydrationStack();
        if (dummyNode) {
          dummyNode.remove();
        }
        return this.element(tagName);
      }
      let node = itemFromRehydrationStack();
      // check tagName
      if (
        node &&
        (node.tagName === tagName.toUpperCase() || node.tagName === tagName)
      ) {
        return node;
      } else {
        // if node may be a text node from element
        if (
          node &&
          (node.nodeType === Node.TEXT_NODE ||
            node.nodeType === Node.COMMENT_NODE)
        ) {
          node = itemFromRehydrationStack();
          if (node && node.tagName === tagName.toUpperCase()) {
            return node;
          } else {
            // it may be a case where we have a queue of text/comment nodes
            // we have to skip them
            if (
              node &&
              (node.nodeType === Node.TEXT_NODE ||
                node.nodeType === Node.COMMENT_NODE)
            ) {
              return this.element(tagName);
            }
            throw new Error(
              `Rehydration failed. Expected tagName: ${tagName}, got: ${node?.tagName}.`,
            );
          }
        }

        throw new Error(
          `Rehydration failed. Expected tagName: ${tagName}, got: ${node?.tagName}.`,
        );
      }
    }
    return $doc.createElement(tagName);
  },
  append(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    targetIndex: number = 0,
  ) {
    if (isRehydrationScheduled()) {
      if (import.meta.env.DEV) {
        if (!parent) {
          debugger;
        }
      }
      // in this case likely child is a text node, and we don't need to append it, we need to prepend it
      const childNodes = Array.from(parent.childNodes);
      const maybeIndex = childNodes.indexOf(child as any);
      if (maybeIndex !== -1 && maybeIndex === targetIndex) {
        return;
      }
      if (childNodes.length === 0) {
        this.insert(parent, child, null);
        return;
      } else if (targetIndex === 0) {
        this.insert(parent, child, parent.firstChild);
        return;
      } else if (targetIndex >= childNodes.length) {
        this.insert(parent, child, null);
        return;
      }
      if (!childNodes[targetIndex]) {
        throw new Error(`Rehydration filed. Unable to find target node.`);
      }
      this.insert(parent, child, childNodes[targetIndex]!);
      return;
    } else {
      this.insert(parent, child, null);
    }
  },
  insert(
    parent: HTMLElement | Node,
    child: HTMLElement | Node,
    anchor?: HTMLElement | Node | null,
  ) {
    if (child.isConnected) {
      return;
    }
    // replace child with first comment node if found
    if (parent && child.nodeType === Node.TEXT_NODE && parent.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      const commentNodes = Array.from(parent.childNodes).filter(node => node.nodeType === Node.COMMENT_NODE && String((node as Comment).data).includes('[text-placeholder]'));
      if (commentNodes.length > 0) {
        console.log(commentNodes);
        parent.replaceChild(child, commentNodes[0]);
        return;
      }
    }
    if (import.meta.env.DEV) {
      if (isEmpty(child)) {
        console.warn(`Trying to render ${typeof child}`);
        return;
      }
      if (parent === null) {
        console.warn(`Trying to render null parent`);
        return;
      }
    }
    if (parent === child) {
      // console.warn('parent === child');
      return;
    }
    if (isRehydrationScheduled()) {
      const existingChild = anchor ? anchor.previousSibling : parent.lastChild;
      const alternativeChild = anchor ? anchor.nextSibling : parent.firstChild;
      if (alternativeChild === child) {
        return;
      }
      if (existingChild === child) {
        return;
      } else {
        if (existingChild && existingChild.nodeType === Node.TEXT_NODE) {
          if (existingChild.textContent === child.textContent) {
            parent.replaceChild(child, existingChild);
            return;
          }
        }
        // debugger;
        if (parent.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
          /*
            TODO: check if it's possible to remove this code
          */
          // check if both comments
          if (
            existingChild &&
            existingChild.nodeType === Node.COMMENT_NODE &&
            child.nodeType === Node.COMMENT_NODE &&
            existingChild.textContent === child.textContent
          ) {
            try {
              existingChild.remove();
              // $doc.replaceChild(child, existingChild);
            } catch (e) {
              console.error(e, {
                child,
                existingChild,
                childParent: child.parentElement,
                existingChildParent: existingChild.parentElement,
              });
            }
            return;
          } else if (
            existingChild &&
            existingChild.nodeType === Node.COMMENT_NODE &&
            child.nodeType === Node.COMMENT_NODE
          ) {
          } else if (existingChild !== null) {
            if (child.isConnected) {
              return;
            }
            if (child.nodeType !== Node.TEXT_NODE) {
              if (child.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                if ((child as DocumentFragment).childElementCount !== 0) {
                  throw new Error(
                    `Rehydration failed. Expected child: ${child}, got: ${existingChild}.`,
                  );
                }

                // debugger;
              } else {
                if (child.nodeType === Node.COMMENT_NODE) {
                } else {
                  debugger;
                  throw new Error(
                    `Rehydration failed. Expected child: ${child}, got: ${existingChild}.`,
                  );
                }
              }
            }
          }
        } else if (child.isConnected) {
          return;
        }
      }
    }
    if (IS_DEV_MODE && !import.meta.env.SSR) {
      if (child.nodeType === undefined) {
        throw new Error('child.nodeType is undefined');
      }
      if (anchor && anchor.parentElement !== parent) {
        if (anchor.parentElement === null) {
          // TODO: figure out why parent element in anchor is null
          if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            if (isRehydrationScheduled()) {
              parent.insertBefore(anchor, null);
              return;
            } else {
              if (anchor.parentNode === null) {
                console.warn('anchor.parentElement === null');
                parent.insertBefore(child, null);
                return;
              }
              parent.insertBefore(child, anchor);
              return;
            }
          } else {
            debugger;
            // TODO: figure out why it happens
            // parent.insertBefore(anchor, null);
            console.warn('anchor.parentElement !== parent', {
              anchor,
              parent,
              child,
            });
          }
        } else if (isRehydrationScheduled()) {
          // likely anchor is already in dom and parent is documentFragment
          if (parent.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
            debugger;
            anchor.parentElement.insertBefore(child, anchor);
            return;
          } else {
            debugger;
          }
        }
        return;
      }
    }

    if (isRehydrationScheduled()) {
      if (
        anchor &&
        anchor.nodeType === Node.TEXT_NODE &&
        child.nodeType === Node.TEXT_NODE
      ) {
        if (anchor.textContent === child.textContent) {
          parent.replaceChild(child, anchor);
        }
      } else {
        parent.insertBefore(child, anchor || null);
      }
    } else {
      parent.insertBefore(child, anchor || null);
    }
  },
};
