import { getFirstNode } from '@/core/control-flow/list';
import { COMPONENTS_HMR, IFS_FOR_HMR, isArray, LISTS_FOR_HMR, RENDERED_NODES_PROPERTY } from './shared';
import {
  renderElement,
  destroyElementSync,
  type Component,
  type ComponentReturnType,
  unregisterFromParent,
} from '@/core/component';
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
    // we need to append new instances before first element of rendered bucket and later remove all rendered buckets
    renderedBuckets.forEach(({ parent, instance, args, tags }) => {
      const newCmp = component(newKlass, args, parent);
      const elApi = initDOM(instance);
      const firstElement = getFirstNode(elApi, instance);
      const parentElement = elApi.parent(firstElement);
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
            list.keyMap.set(key, newCmp);
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
        } else if (scopes && RENDERED_NODES_PROPERTY in scopes) {
          let dirty = false;
          for (let i = 0; i < scopes[RENDERED_NODES_PROPERTY].length; i++) {
            // @ts-expect-error
            if (scopes[RENDERED_NODES_PROPERTY][i] === instance) {
              // @ts-expect-error
              scopes[RENDERED_NODES_PROPERTY][i] = newCmp;
              dirty = true;
            }
          }
          if (dirty) {
            set(scopes);
          }
        }
      });
      const api = initDOM(newCmp);
      unregisterFromParent(instance);
      renderElement(api, newCmp, parentElement, newCmp, firstElement);
      const newComponents = Array.from(COMPONENTS_HMR.get(newKlass) || []);
      const tagsFromCurrentInstance = newComponents.find((item) => item.instance === newCmp)?.tags ?? [];
      if (tagsFromCurrentInstance.length === tags.length) {
        tags.forEach((tag, index) => {
          const newTag = tagsFromCurrentInstance[index];
          if (newTag && tag._debugName && newTag._debugName) {
            if (tag._debugName?.endsWith(newTag._debugName)) {
              if (newTag._value !== tag._value) {
                newTag.value = tag._value;
              }
              newTag._debugName = tag._debugName;
            }
          }
        });
      }
      destroyElementSync(instance, false, elApi);
    });
    COMPONENTS_HMR.delete(oldklass);
  };
}
