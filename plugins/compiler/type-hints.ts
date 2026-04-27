/**
 * Type Hint Resolution
 *
 * Resolves type hints from CompilerContext and computes
 * reactivity classification for template expressions.
 */

import type { CompilerContext } from './context';
import type { ReactivityHint, PropertyTypeHint } from './types';

export type StaticLiteralValue = string | number | boolean;

/**
 * Look up the type hint for a path expression.
 *
 * @param ctx - Compiler context (must have typeHints and WITH_TYPE_OPTIMIZATION flag)
 * @param expression - The path expression (e.g., "this.title", "this.count")
 * @param isArg - Whether this is an @arg reference
 * @returns PropertyTypeHint or undefined if no hint is available
 */
export function lookupTypeHint(
  ctx: CompilerContext,
  expression: string,
  isArg: boolean
): PropertyTypeHint | undefined {
  if (!ctx.flags.WITH_TYPE_OPTIMIZATION || !ctx.typeHints) {
    return undefined;
  }

  if (isArg) {
    // @argName -> look up in args hints
    // Expression comes in as "this[$args].argName" but the hint key is just "argName"
    const argName = extractArgName(expression);
    return argName ? ctx.typeHints.args?.[argName] : undefined;
  }

  // this.propertyName -> look up in properties hints
  return ctx.typeHints.properties?.[expression];
}

/**
 * Look up the return type hint for a helper.
 *
 * @param ctx - Compiler context
 * @param helperName - The helper name
 * @returns PropertyTypeHint or undefined
 */
export function lookupHelperReturnHint(
  ctx: CompilerContext,
  helperName: string
): PropertyTypeHint | undefined {
  if (!ctx.flags.WITH_TYPE_OPTIMIZATION || !ctx.typeHints) {
    return undefined;
  }
  return ctx.typeHints.helperReturns?.[helperName];
}

/**
 * Classify the reactivity of a path expression based on type hints.
 *
 * Conservative rules:
 * - 'unknown' kind -> 'unknown' (fallback to runtime detection)
 * - 'primitive' + isReadonly -> 'static' (no reactivity needed)
 * - 'primitive' + NOT isTracked -> 'static' (plain property, no Cell backing)
 * - 'primitive' + isTracked -> 'reactive' (has Cell backing, needs getter)
 * - 'object' -> 'unknown' (could contain reactive references)
 * - 'function' -> 'unknown' (could return reactive values)
 * - 'cell' -> 'reactive' (always reactive)
 *
 * @returns ReactivityHint
 */
export function classifyReactivity(hint: PropertyTypeHint | undefined): ReactivityHint {
  if (!hint) {
    return 'unknown';
  }

  // Tracked properties are always reactive, regardless of kind
  if (hint.isTracked) {
    return 'reactive';
  }

  if (hint.kind === 'unknown') {
    return 'unknown';
  }

  // Cell type is always reactive
  if (hint.kind === 'cell') {
    return 'reactive';
  }

  // Functions could return anything -- treat as unknown
  if (hint.kind === 'function') {
    return 'unknown';
  }

  // Objects could contain reactive references -- treat as unknown
  if (hint.kind === 'object') {
    return 'unknown';
  }

  // Primitive type
  if (hint.kind === 'primitive') {
    // Readonly primitives are definitely static
    if (hint.isReadonly) {
      return 'static';
    }
    // Non-tracked, non-readonly primitive: static (plain class property)
    return 'static';
  }

  return 'unknown';
}

/**
 * Determine if the compiler should skip getter wrapping for a given expression.
 *
 * @returns true if the value is known to be static and can be emitted directly
 */
export function shouldSkipGetterWrapper(
  ctx: CompilerContext,
  expression: string,
  isArg: boolean
): boolean {
  // Arg reactivity depends on call-site expressions (often getter functions),
  // not on the arg's static type. Keep getter wrappers for args to preserve tracking.
  if (isArg) {
    return false;
  }
  const hint = lookupTypeHint(ctx, expression, isArg);
  const reactivity = classifyReactivity(hint);
  return reactivity === 'static';
}

/**
 * Determine if a path should access `.value` directly in text rendering contexts.
 *
 * Safety rules:
 * - Never apply to @args (call-site value may intentionally be a Cell object)
 * - Only apply when the expression is known to be Cell/MergedCell-like
 */
export function shouldAccessCellValue(
  ctx: CompilerContext,
  expression: string,
  isArg: boolean
): boolean {
  if (isArg) {
    return false;
  }

  const hint = lookupTypeHint(ctx, expression, isArg);
  return hint?.kind === 'cell';
}

/**
 * Resolve a compile-time literal value for a path expression when it is safe
 * to inline directly into generated code.
 *
 * Safety rules:
 * - Never inline @args (call-site controlled)
 * - Only inline primitive values
 * - Only inline readonly, non-tracked properties
 */
export function getStaticLiteralValue(
  ctx: CompilerContext,
  expression: string,
  isArg: boolean
): StaticLiteralValue | undefined {
  if (isArg) {
    return undefined;
  }

  const hint = lookupTypeHint(ctx, expression, isArg);
  if (!hint) {
    return undefined;
  }

  if (hint.kind !== 'primitive') {
    return undefined;
  }

  if (hint.isTracked) {
    return undefined;
  }

  if (hint.isReadonly !== true) {
    return undefined;
  }

  return hint.literalValue;
}

/**
 * Extract the arg name from a resolved arg expression.
 * "this[$args].userName" -> "userName"
 * "this[$args][\"user-name\"]" -> "user-name"
 */
function extractArgName(expression: string): string | undefined {
  // Handle "this[$args].argName" pattern
  const dotMatch = expression.match(/\$args\]\.(\w+)/);
  if (dotMatch) return dotMatch[1];

  // Handle bracket notation: this[$args]["argName"]
  const bracketMatch = expression.match(/\$args\]\[["']([^"']+)["']\]/);
  if (bracketMatch) return bracketMatch[1];

  // Handle simple unresolved arg names (e.g., just "userName")
  // Used when the caller passes the raw arg name
  if (!expression.includes('.') && !expression.includes('[')) {
    return expression;
  }

  return undefined;
}
