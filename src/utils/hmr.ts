import { getFirstNode } from '@/utils/control-flow/list';
import { COMPONENTS_HMR, IFS_FOR_HMR, isArray, LISTS_FOR_HMR } from './shared';
import {
  renderElement,
  destroyElementSync,
  type Component,
  type ComponentReturnType,
  unregisterFromParent,
} from '@/utils/component';
import { initDOM } from './context';

export function createHotReload(
  component: (
    comp: ComponentReturnType | Component,
    args: Record<string, unknown>,
    ctx: Component<any>,
  ) => ComponentReturnType,
) {
  return function hotReload(
    oldklass: Component | ComponentReturnType,
    newKlass: Component | ComponentReturnType,
  ) {
    const renderedInstances = COMPONENTS_HMR.get(oldklass);
    if (!renderedInstances) {
      return;
    }
    const renderedBuckets = Array.from(renderedInstances);
    // we need to append new instances before first element of rendered bucket and later remove all rendered buckets;
    // TODO: add tests for hot-reload
    renderedBuckets.forEach(({ parent, instance, args }) => {
      const newCmp = component(newKlass, args, parent);
      const firstElement = getFirstNode(instance);
      const parentElement = firstElement.parentNode;
      if (!parentElement) {
        return;
      }
      LISTS_FOR_HMR.forEach((list) => {
        Array.from(list.keyMap).forEach(([key, lineItems]) => {
          if (isArray(lineItems)) {
            for (let k = 0; k < lineItems.length; k++) {
              const value = lineItems[k];
              if (instance === value) {
                lineItems[k] = newCmp;
              }
            }
          } else if (instance === lineItems) {
            list.keyMap.set(key, instance);
          }
          
        });
      });
      IFS_FOR_HMR.forEach((fn) => {
        const { item: scopes, set } = fn();
        if (scopes === instance) {
          set(newCmp);
        } else if (Array.isArray(scopes)) {
          let dirty = false;
          for (let i = 0; i < scopes.length; i++) {
            if (scopes[i] === instance) {
              scopes[i] = newCmp;
              dirty = true;
            }
          }
          if (dirty) {
            set(scopes);
          }
        } else if (scopes && 'nodes' in scopes) {
          let dirty = false;
          for (let i = 0; i < scopes.nodes.length; i++) {
            // @ts-expect-error
            if (scopes.nodes[i] === instance) {
              // @ts-expect-error
              scopes.nodes[i] = newCmp;
              dirty = true;
            }
          }
          if (dirty) {
            set(scopes);
          }
        }
      });
      // @ts-expect-error different type for API
      const api = initDOM(newCmp.ctx);
      renderElement(api, newCmp.ctx!, parentElement, newCmp, firstElement);
      unregisterFromParent(instance);
      destroyElementSync(instance);
    });
    COMPONENTS_HMR.delete(oldklass);
  };
}
