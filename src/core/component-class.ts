/**
 * Component Class - Level 4
 *
 * The Component base class definition.
 * Imports from Level 0-3 only.
 */

import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';
import type { DOMApi } from './types';
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
 */
export class Component<T extends Props = any> {
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
) => ComponentReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>;
