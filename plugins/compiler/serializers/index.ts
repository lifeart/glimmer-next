/**
 * Serializers Module
 *
 * Converts HBSNode, HBSControlExpression, and SerializedValue to JavaScript code.
 *
 * Architecture:
 * - `build*` functions return JSExpression (AST-like structure)
 * - `serialize*` functions return strings (for backward compatibility)
 * - Use build* + serializeJS(expr, { emitter }) for proper source mapping
 */

import type { CompilerContext } from '../context';
import { nextContextName } from '../context';
import type {
  HBSNode,
  HBSChild,
  HBSTag,
} from '../types';
import { isHBSNode, isHBSControlExpression, isSerializedValue, isRuntimeTag } from '../types';
import {
  serializeElement,
  serializeComponent,
  buildElement,
  buildComponent,
  setElementDependencies,
} from './element';
import {
  serializeControl,
  buildControl,
  setControlDependencies,
} from './control';
import { serializeValue, buildValue } from './value';
import { B, type JSExpression } from '../builder';

// ============================================================================
// Context Name Generation
// ============================================================================

/**
 * Generate the next unique context name.
 *
 * @param ctx - The compiler context (contains the counter)
 * @returns A unique context name like 'ctx0', 'ctx1', etc.
 */
export function nextCtxName(ctx: CompilerContext): string {
  return nextContextName(ctx);
}

// ============================================================================
// Build Functions (Return JSExpression)
// ============================================================================

/**
 * Build an HBS child as a JSExpression.
 * This is the core function for the new architecture.
 *
 * @param ctx - The compiler context
 * @param child - The child to build
 * @param ctxName - The current context variable name
 * @returns JSExpression or null if filtered
 */
export function build(
  ctx: CompilerContext,
  child: HBSChild,
  ctxName = 'this'
): JSExpression | null {
  if (child === null) {
    return null;
  }

  // String literal - use B.string for proper source mapping
  if (typeof child === 'string') {
    return B.string(child);
  }

  // SerializedValue (expression)
  if (isSerializedValue(child)) {
    return buildValue(ctx, child, ctxName);
  }

  // HBSControlExpression (if, each, yield, etc.)
  if (isHBSControlExpression(child)) {
    return buildControl(ctx, child, ctxName);
  }

  // HBSNode (element or component)
  if (isHBSNode(child)) {
    return buildNode(ctx, child, ctxName);
  }

  return null;
}

/**
 * Build an HBSNode (element or component) as JSExpression.
 */
export function buildNode(
  ctx: CompilerContext,
  node: HBSNode,
  ctxName = 'this'
): JSExpression {
  const isComponent = isComponentTag(ctx, node.tag);

  if (isComponent) {
    return buildComponent(ctx, node, ctxName);
  }

  return buildElement(ctx, node, ctxName);
}

/**
 * Build an array of children as JSExpression[].
 */
export function buildChildren(
  ctx: CompilerContext,
  children: readonly HBSChild[],
  ctxName: string
): JSExpression[] {
  if (children.length === 0) {
    return [];
  }

  return children
    .map((child) => build(ctx, child, ctxName))
    .filter((expr): expr is JSExpression => expr !== null);
}

/**
 * Build children as an array expression.
 */
export function buildChildArray(
  ctx: CompilerContext,
  children: readonly HBSChild[] | null,
  ctxName: string
): JSExpression {
  if (!children || children.length === 0) {
    return B.emptyArray();
  }

  const exprs = buildChildren(ctx, children, ctxName);
  return B.array(exprs);
}

// ============================================================================
// Serialize Functions (Return strings - backward compatible)
// ============================================================================

/**
 * Serialize an HBS child to JavaScript code.
 *
 * @param ctx - The compiler context
 * @param child - The child to serialize
 * @param ctxName - The current context variable name
 */
export function serialize(
  ctx: CompilerContext,
  child: HBSChild,
  ctxName = 'this'
): string | null {
  if (child === null) {
    return null;
  }

  // String literal
  if (typeof child === 'string') {
    return escapeString(child);
  }

  // SerializedValue (expression)
  if (isSerializedValue(child)) {
    return serializeValue(ctx, child, ctxName);
  }

  // HBSControlExpression (if, each, yield, etc.)
  if (isHBSControlExpression(child)) {
    return serializeControl(ctx, child, ctxName);
  }

  // HBSNode (element or component)
  if (isHBSNode(child)) {
    return serializeNode(ctx, child, ctxName);
  }

  return null;
}

/**
 * Serialize an HBSNode (element or component).
 */
export function serializeNode(
  ctx: CompilerContext,
  node: HBSNode,
  ctxName = 'this'
): string {
  // Check if it's a component (has binding, RuntimeTag, or dotted path)
  const isComponent = isComponentTag(ctx, node.tag);

  if (isComponent) {
    return serializeComponent(ctx, node, ctxName);
  }

  return serializeElement(ctx, node, ctxName);
}

/**
 * Serialize an array of children.
 */
export function serializeChildren(
  ctx: CompilerContext,
  children: readonly HBSChild[],
  ctxName: string
): string {
  if (children.length === 0) {
    return '';
  }

  const serialized = children
    .map((child) => serialize(ctx, child, ctxName))
    .filter((s): s is string => s !== null);

  return serialized.join(', ');
}

/**
 * Serialize children to an array of strings (for formatted output).
 */
export function serializeChildrenToArray(
  ctx: CompilerContext,
  children: readonly HBSChild[],
  ctxName: string
): string[] {
  if (children.length === 0) {
    return [];
  }

  return children
    .map((child) => serialize(ctx, child, ctxName))
    .filter((s): s is string => s !== null);
}

/**
 * Serialize children as an array expression.
 * Uses formatter for proper indentation when formatting is enabled.
 */
export function serializeChildArray(
  ctx: CompilerContext,
  children: readonly HBSChild[] | null,
  ctxName: string
): string {
  if (!children || children.length === 0) {
    return '[]';
  }

  const items = serializeChildrenToArray(ctx, children, ctxName);

  // Use formatter for proper indentation
  const fmt = ctx.formatter;
  if (fmt.options.enabled && items.length > 0) {
    return fmt.array(items);
  }

  return `[${items.join(', ')}]`;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a tag represents a component.
 */
function isComponentTag(ctx: CompilerContext, tag: HBSTag): boolean {
  // RuntimeTag is always a component (namespace providers, dynamic components)
  if (isRuntimeTag(tag)) {
    return true;
  }

  // For string tags:
  // 1. Are known bindings (imported components)
  // 2. Contain a dot (namespaced paths)
  // Note: We do NOT check for PascalCase here because unknown PascalCase tags
  // should be passed as strings to the DOM API (e.g., TresMesh -> $_tag('TresMesh', ...))
  // which allows custom renderers to handle them dynamically.
  return (
    ctx.scopeTracker.hasBinding(tag) ||
    tag.includes('.')
  );
}

/**
 * Escape a string for use in JavaScript code.
 */
export function escapeString(str: string): string {
  return JSON.stringify(str);
}

/**
 * Check if a string looks like a path expression.
 */
export function isPath(str: string): boolean {
  return str.startsWith('this.') || str.startsWith('@');
}

// ============================================================================
// Dependency Wiring
// ============================================================================

// Wire up circular dependencies (nextCtxName is now passed as the function itself)
setElementDependencies(buildChildren, nextCtxName);
setControlDependencies(buildChildren, nextCtxName);

// ============================================================================
// Re-exports
// ============================================================================

// Re-export symbols and built-in helpers
export {
  SYMBOLS,
  EVENT_TYPE,
  INTERNAL_HELPERS,
  BUILT_IN_HELPERS,
  BUILT_IN_HELPER_NAMES,
  isBuiltInHelper,
  getBuiltInHelperSymbol,
} from './symbols';

// Re-export individual serializers (string-based)
export { serializeElement, serializeComponent } from './element';
export { serializeControl } from './control';
export { serializeValue } from './value';

// Re-export builders (JSExpression-based)
export { buildElement, buildComponent } from './element';
export { buildControl } from './control';
export { buildValue } from './value';

// Re-export builder utilities
export { B, serializeJS } from '../builder';
export type { JSExpression } from '../builder';
