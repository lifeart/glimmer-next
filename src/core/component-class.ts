/**
 * Component Class - Level 4
 *
 * The Component base class definition.
 * Imports from Level 0-3 only.
 */

import type { DOMApi, ComponentInvokeReturn } from './types';
import {
  RENDERING_CONTEXT_PROPERTY,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
} from './types';
import { cId } from './tree';
import { $args, $fwProp } from './shared';

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;

/**
 * Base Component class for building UI components.
 *
 * Glint's `[Context]` / `[Invoke]` keys are added by the opt-in
 * `@lifeart/gxt/glint` types entry (`./glint.ts`), so these published types
 * do not need `@glint/template`.
 */
export class Component<T extends Props = any> {
  args!: Get<T, 'Args'>;
  [RENDERING_CONTEXT_PROPERTY]: undefined | DOMApi = undefined;
  [COMPONENT_ID_PROPERTY] = cId();
  declare [RENDERED_NODES_PROPERTY]: Array<Node>;
  nodes!: Node[];
  $fw: unknown;

  constructor(props: Get<T, 'Args'>, fw?: unknown) {
    this[$args] = props;
    this[$fwProp] = fw;
  }

  declare template: Component<any>;
}

/**
 * Component return type (alias for backward compatibility)
 */
export type ComponentReturnType = Component<any>;

/**
 * TOC (Template-Only Component) type
 */
export type TOC<S extends Props = {}> = (
  args?: Get<S, 'Args'>,
) => ComponentInvokeReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>;
