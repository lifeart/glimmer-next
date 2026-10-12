/**
 * Core Type Definitions - Level 0
 *
 * This module contains all core type definitions and symbols.
 * It has NO imports from other utils modules to serve as the foundation.
 */

// ============================================
// Symbols
// ============================================

export const isTag = Symbol('isTag');
export const RENDERING_CONTEXT_PROPERTY = Symbol('rendering-context');
export const RENDERED_NODES_PROPERTY = Symbol('nodes');
export const COMPONENT_ID_PROPERTY = Symbol('id');
export const ADDED_TO_TREE_FLAG = Symbol('addedToTree');
// Optional post-insert callback a carrier can expose so it can re-run work once
// its staged nodes have been inserted into their REAL parent (known only at
// `renderElement` time, not at carrier-construction time). `$_html` uses it to
// re-parse trusted HTML against a now-known table-/select-family parent so the
// browser's contextual parser (implicit `<tbody>`, contextual `<td>`) applies.
export const MOUNT_REPARSE_HOOK = Symbol('mount-reparse');

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
// Component Class Types
// ============================================

export type Props = Record<string, unknown>;

type Get<T, K, Otherwise = {}> = K extends keyof T
  ? Exclude<T[K], undefined>
  : Otherwise;

/**
 * Template type-checker hook. Empty here, so the published types need no
 * other package. The opt-in `@lifeart/gxt/glint` types entry (`./glint.ts`)
 * adds `componentReturn: ComponentReturn<Blocks, El>` from `@glint/template`.
 */
export interface TemplateTypeRegistry<Blocks, El> {}

/**
 * What invoking a component yields for a template type-checker: Glint's
 * `ComponentReturn` once `@lifeart/gxt/glint` is loaded, `unknown` otherwise.
 */
export type ComponentInvokeReturn<Blocks, El> =
  TemplateTypeRegistry<Blocks, El> extends { componentReturn: infer R }
    ? R
    : unknown;

/**
 * Base component interface. `@lifeart/gxt/glint` gives the `Component` class
 * Glint's `[Context]` / `[Invoke]` keys.
 */
export interface ComponentBase<T extends Props = any> {
  args: Get<T, 'Args'>;
  [RENDERING_CONTEXT_PROPERTY]: DOMApi | undefined;
  [COMPONENT_ID_PROPERTY]: number;
  [RENDERED_NODES_PROPERTY]: Array<Node>;
  nodes: Node[];
  $fw: unknown;
}

/**
 * TOC (Template-Only Component) type
 */
export type TOC<S extends Props = {}> = (
  args?: Get<S, 'Args'>,
) => ComponentInvokeReturn<Get<S, 'Blocks'>, Get<S, 'Element', null>>;
