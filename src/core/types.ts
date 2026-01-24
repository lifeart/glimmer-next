/**
 * Core Type Definitions - Level 0
 *
 * This module contains all core type definitions and symbols.
 * It has NO imports from other utils modules to serve as the foundation.
 */

import type {
  TemplateContext,
  Context,
  Invoke,
  ComponentReturn,
} from '@glint/template/-private/integration';

// ============================================
// Symbols
// ============================================

export const isTag = Symbol('isTag');
export const RENDERING_CONTEXT_PROPERTY = Symbol('rendering-context');
export const RENDERED_NODES_PROPERTY = Symbol('nodes');
export const COMPONENT_ID_PROPERTY = Symbol('id');
export const ADDED_TO_TREE_FLAG = Symbol('addedToTree');

// ============================================
// Core Types
// ============================================

/**
 * Minimal component-like interface for use in modules that can't import Component
 * to avoid circular dependencies.
 */
export type ComponentLike = {
  [COMPONENT_ID_PROPERTY]: number;
  [RENDERED_NODES_PROPERTY]: Array<Node>;
  [RENDERING_CONTEXT_PROPERTY]: DOMApi | undefined;
} & Record<string, any>;

/**
 * Minimal Root-like interface for use in modules that can't import Root
 * to avoid circular dependencies.
 */
export type RootLike = {
  document: Document;
  [COMPONENT_ID_PROPERTY]: number;
  [RENDERED_NODES_PROPERTY]: Array<Node>;
  [RENDERING_CONTEXT_PROPERTY]: DOMApi | undefined;
};

/**
 * Generic return type for rendering operations
 */
export type GenericReturnType =
  | ComponentLike
  | Node
  | Array<ComponentLike | Node>
  | null
  | null[];

/**
 * Elements that can be rendered
 */
export type RenderableElement =
  | GenericReturnType
  | Node
  | string
  | number
  | Function
  | null
  | undefined;

/**
 * Component render target types
 */
export type ComponentRenderTarget =
  | Element
  | HTMLElement
  | DocumentFragment
  | ComponentLike;

/**
 * Slot function type
 */
export type Slots = Record<
  string,
  (
    ...params: unknown[]
  ) => Array<ComponentLike | Node | Comment | string | number>
>;

// ============================================
// DOMApi Interface
// ============================================

/**
 * DOM API interface for abstracting DOM operations.
 * Allows for different renderers (browser, SSR, etc.)
 */
export interface DOMApi {
  element(tagName: string): Node;
  text(content: string | number): Node;
  comment(content?: string): Comment;
  fragment(): DocumentFragment;
  insert(parent: Node, node: Node, anchor?: Node | null): void;
  destroy(node: Node): void;
  parent(node: Node): Node | null;
  attr(element: Node, name: string, value: string | null): void;
  prop(element: Node, name: string, value: unknown): unknown;
  textContent(node: Node, content: string): void;
  addEventListener(element: Node, event: string, handler: EventListener): (() => void) | undefined | void;
  clearChildren(parent: Node): void;
  isNode(value: unknown): value is Node;
}

// ============================================
// Component Class Types (for glint integration)
// ============================================

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;

/**
 * Base component interface with glint template context
 */
export interface ComponentBase<T extends Props = any> {
  args: Get<T, 'Args'>;
  [RENDERING_CONTEXT_PROPERTY]: DOMApi | undefined;
  [COMPONENT_ID_PROPERTY]: number;
  [RENDERED_NODES_PROPERTY]: Array<Node>;
  [Context]: TemplateContext<
    this,
    Get<T, 'Args'>,
    Get<T, 'Blocks'>,
    Get<T, 'Element', null>
  >;
  [Invoke]: (
    args?: Get<T, 'Args'>,
  ) => ComponentReturn<Get<T, 'Blocks'>, Get<T, 'Element', null>>;
  nodes: Node[];
  $fw: unknown;
}

/**
 * TOC (Template-Only Component) type
 */
export type TOC<S extends Props = {}> = (
  args?: Get<S, 'Args'>,
) => ComponentReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>;
