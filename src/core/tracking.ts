/**
 * Tracking - Level 1
 *
 * Parent context stack for tracking component hierarchy during rendering.
 * This module was previously named parent-context.ts.
 */

import {
  COMPONENT_ID_PROPERTY,
  type ComponentLike,
} from './types';
import { TREE } from './tree';

const parentContextStack: Array<number> = [];
let parentContextIndex = -1;

if (IS_DEV_MODE) {
  try {
    // @ts-expect-error - dev mode debugging
    window.parentContext = parentContextStack;
    // @ts-expect-error - dev mode debugging
    window.resolveParents = () => parentContextStack.map((id) => TREE.get(id));
  } catch (e) {
    // Ignore - may not have window
  }
}

/**
 * Push a component onto the parent context stack.
 * Split into push/pop for hot path performance - avoids null check on every call.
 */
export const pushParentContext = (value: ComponentLike): void => {
  parentContextIndex++;
  parentContextStack.push(value[COMPONENT_ID_PROPERTY]!);
};

/**
 * Pop a component from the parent context stack.
 */
export const popParentContext = (): void => {
  parentContextIndex--;
  parentContextStack.pop();
};

/**
 * Set or clear the parent context (backward compatibility wrapper).
 */
export const setParentContext = (value: ComponentLike | null): void => {
  if (value === null) {
    popParentContext();
  } else {
    pushParentContext(value);
  }
};

/**
 * Get the current parent context component.
 * Return type is 'any' to avoid type dependency on Component<any>.
 */
export const getParentContext = (): any => {
  if (IS_DEV_MODE) {
    if (!TREE.get(parentContextStack[parentContextIndex]!)) {
      // parent context is not found, may happen if context was not set properly
      // debugger;
    }
  }
  return TREE.get(parentContextStack[parentContextIndex]!);
};
