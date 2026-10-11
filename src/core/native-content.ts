/**
 * Glimmer dynamic content for the Ember native layer (G15).
 *
 * A content-position `{{value}}` in Glimmer renders whatever its value IS and
 * re-decides on every change: text, trusted HTML (`SafeString`), a DOM node, a
 * component definition, a helper. gxt's historic binding is a text node whose
 * `textContent` follows the value — a node becomes `[object HTMLDivElement]`,
 * a SafeString is escaped, a component definition stringifies — and a value
 * that STARTS as a node / component renders once and never updates.
 *
 * Under the EMBER_NATIVE runtime, dom.ts registers a binding
 * (`setNativeContentBinding`) that render-core / root.ts use for every
 * reactive content value:
 *   - text values keep the single text node (the hot path is unchanged: one
 *     kind check per update);
 *   - any other kind renders as a sibling CONTENT UNIT inserted before that
 *     text node (which then stays empty as the unit's anchor). The unit is a
 *     render-tree child of the binding's owner (destroyed with it) and is
 *     spliced into the owner's rendered-nodes list just before the anchor, so
 *     row moves / first-node lookups / teardown see it; a change of kind or
 *     identity destroys it and renders the new value.
 * Without a registered binding (standalone gxt, the Ember compat bridge) every
 * check below is a single `null` comparison and behaviour is unchanged.
 *
 * This module holds only the registration slot and the pure classification
 * helpers (no imports from the render modules, so render-core / root.ts / dom.ts
 * can all depend on it).
 */
import { HOST_HOOKS } from './host-hooks';
import { isTemplateFn } from './template-fn';
import { isFn, isPrimitive, isTagLike } from './shared';
import type { ComponentLike, DOMApi } from './types';
import type { MergedCell } from './reactive';

/** Content kinds (Glimmer's ContentType, collapsed). */
export const CONTENT_TEXT = 0;
export const CONTENT_NODE = 1;
export const CONTENT_HTML = 2;
export const CONTENT_COMPONENT = 3;
export const CONTENT_HELPER = 4;
export type ContentKind = 0 | 1 | 2 | 3 | 4;

/**
 * Binds the reactive content formula `f` to `textNode` (already inserted).
 * `treeParent` owns content units in the render tree; `owner` is the render
 * node whose rendered-nodes list holds `textNode` (null when the text node is
 * not registered anywhere — e.g. a child of an element, whose removal takes it
 * along). Returns the binding's destructor.
 */
export type NativeContentBinding = (
  api: DOMApi,
  treeParent: ComponentLike,
  owner: ComponentLike | null,
  textNode: Node,
  f: MergedCell,
) => () => void;

let BINDING: NativeContentBinding | null = null;

/** Registered by dom.ts under EMBER_NATIVE (tests register / reset it directly). */
export function setNativeContentBinding(binding: NativeContentBinding | null): void {
  BINDING = binding;
}

/**
 * True once the EMBER_NATIVE runtime registered its binding: the Ember native
 * layer's runtime semantics (dynamic content, mount-time in-element) apply.
 */
export function isNativeRuntime(): boolean {
  return BINDING !== null;
}

/** The registered dynamic-content binding, or null (historic text binding). */
export function nativeContentBinding(): NativeContentBinding | null {
  return BINDING;
}

// The value `resolveRenderable`'s `checkOpcode` read computed for a content
// formula, handed to the binding so creation reads the binding ONCE (Glimmer
// parity: a side-effecting getter runs once per render). Consumed on bind.
const INITIAL_VALUES = new WeakMap<object, unknown>();

export function stashInitialContent(f: object, value: unknown): void {
  INITIAL_VALUES.set(f, value);
}

/** The stashed first value (and forgets it), or `NO_INITIAL`. */
export const NO_INITIAL: unique symbol = Symbol('no-initial-content');
export function takeInitialContent(f: object): unknown {
  if (!INITIAL_VALUES.has(f)) return NO_INITIAL;
  const value = INITIAL_VALUES.get(f);
  INITIAL_VALUES.delete(f);
  return value;
}

/**
 * A host construct a content value can be — the host's `classifyContent`
 * answer, or a gxt template function (a template-only component).
 */
function hostKind(value: unknown): ContentKind | 0 {
  const hook = HOST_HOOKS.classifyContent;
  if (hook !== undefined) {
    const kind = hook(value);
    if (kind === 'html') return CONTENT_HTML;
    if (kind === 'component') return CONTENT_COMPONENT;
    if (kind === 'helper') return CONTENT_HELPER;
  }
  if (isTemplateFn(value)) return CONTENT_COMPONENT;
  return CONTENT_TEXT;
}

/**
 * A component definition by the content rules (host `classifyContent` says
 * `'component'`, or a gxt template function): an argument-less `{{Comp}}`
 * renders it rather than invoking it as a helper (Glimmer's ambiguous append).
 */
export function isContentComponent(value: unknown): boolean {
  if (value === null) return false;
  const type = typeof value;
  if (type !== 'object' && type !== 'function') return false;
  return hostKind(value) === CONTENT_COMPONENT;
}

/** What a content value renders as. */
export function nativeContentKind(api: DOMApi, value: unknown): ContentKind {
  if (value === null || value === undefined || isPrimitive(value)) return CONTENT_TEXT;
  const type = typeof value;
  if (type !== 'object' && type !== 'function') return CONTENT_TEXT;
  if (api.isNode(value as Node)) return CONTENT_NODE;
  return hostKind(value);
}

/** Glimmer's text normalization: nullish / no `toString` → '', else `String(v)`. */
export function nativeContentText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object' && !isFn((value as { toString?: unknown }).toString)) return '';
  return String(value);
}

/**
 * `deepFnValue` for native content: unwraps thunks (a binding's getter, a
 * thunk returning a thunk) but STOPS at a function that is a host construct —
 * a component class or a helper definition must be rendered, not called (a
 * class constructor would throw, a managed helper would bypass its manager).
 * Plain functions are still called (gxt's — and Glimmer's default-manager —
 * semantics for a function value in content position).
 */
export function nativeDeepFnValue(fn: Function): unknown {
  let value: unknown = fn();
  while (isFn(value)) {
    if (hostKind(value) !== CONTENT_TEXT) return value;
    value = (value as () => unknown)();
  }
  if (typeof value === 'object' && value !== null && isTagLike(value)) {
    return (value as { value: unknown }).value;
  }
  return value;
}
