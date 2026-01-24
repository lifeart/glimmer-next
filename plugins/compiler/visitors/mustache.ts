/**
 * Mustache Statement Visitor
 *
 * Handles mustache expressions like {{foo}}, {{helper arg}}, {{yield}}.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext, VisitFn } from '../context';
import type { SerializedValue, HBSControlExpression, SourceRange } from '../types';
import { literal, path, helper, getter, raw, isSerializedValue } from '../types';
import { getNodeRange, resolvePath, serializeValueToString, getPathPartRanges, getPathExpressionString } from './utils';

/**
 * Get the visit function from context.
 * Requires ctx.visitors to be initialized via initializeVisitors().
 */
function getVisit(ctx: CompilerContext): VisitFn {
  if (ctx.visitors?.visit) {
    return ctx.visitors.visit;
  }
  throw new Error('No visit function available. Call initializeVisitors first.');
}

/**
 * Visit a MustacheStatement node.
 *
 * @param ctx - The compiler context
 * @param node - The MustacheStatement to visit
 * @param wrap - Whether to wrap expressions in getters
 */
export function visitMustache(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  wrap = true
): SerializedValue | HBSControlExpression | null {
  const range = getNodeRange(node);

  // Handle non-path mustache (literal values, sub-expressions)
  if (node.path.type !== 'PathExpression') {
    return visitMustacheLiteral(ctx, node, wrap, range);
  }

  const pathName = getPathExpressionString(node.path);

  // Handle yield/outlet
  if (pathName === 'yield' || pathName === 'outlet') {
    return createYieldExpression(ctx, node, range);
  }

  // Collect hash arguments
  const hashArgs = collectHashArgs(ctx, node.hash.pairs);

  // No params - simple path or helper with only named args
  if (node.params.length === 0) {
    return visitSimpleMustache(ctx, node, hashArgs, wrap, range);
  }

  // Helper call with positional params
  return visitHelperMustache(ctx, node, hashArgs, wrap, range);
}

/**
 * Handle mustache with non-path expression (literals, sub-expressions).
 */
function visitMustacheLiteral(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  wrap: boolean,
  range?: SourceRange
): SerializedValue | null {
  const pathNode = node.path;

  if (
    pathNode.type === 'BooleanLiteral' ||
    pathNode.type === 'UndefinedLiteral' ||
    pathNode.type === 'NullLiteral'
  ) {
    return literal(pathNode.value, range);
  }

  if (pathNode.type === 'NumberLiteral') {
    return literal(pathNode.value, range);
  }

  if (pathNode.type === 'StringLiteral') {
    return literal(pathNode.value, range);
  }

  if (pathNode.type === 'SubExpression') {
    const subResult = getVisit(ctx)(ctx, pathNode, false);
    if (subResult === null) return null;
    if (isSerializedValue(subResult)) {
      if (wrap) {
        // Wrap in getter
        return getter(subResult, range);
      }
      return subResult;
    }
    return null;
  }

  return null;
}

/**
 * Create a yield control expression.
 */
function createYieldExpression(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  range?: SourceRange
): HBSControlExpression {
  // Find the slot name from hash
  let slotName = 'default';
  const toPair = node.hash.pairs.find((p) => p.key === 'to');
  if (toPair) {
    if (toPair.value.type === 'StringLiteral') {
      slotName = toPair.value.value;
    } else {
      const result = getVisit(ctx)(ctx, toPair.value, false);
      if (result !== null && isSerializedValue(result)) {
        slotName = serializeValueToString(result);
      }
    }
  }

  // Collect yield params
  const blockParams = node.params.map((p) => {
    const result = getVisit(ctx)(ctx, p, false);
    if (result === null) return '';
    if (typeof result === 'string') return result;
    if (isSerializedValue(result)) return serializeValueToString(result);
    return '';
  });

  return {
    _nodeType: 'control',
    type: 'yield',
    condition: literal(''),
    blockParams,
    children: [],
    inverse: null,
    key: slotName,
    isSync: true,
    sourceRange: range,
  };
}

/**
 * Collect hash pairs into a Map.
 */
function collectHashArgs(
  ctx: CompilerContext,
  pairs: ASTv1.HashPair[]
): Map<string, SerializedValue> {
  const result = new Map<string, SerializedValue>();

  for (const pair of pairs) {
    const value = getVisit(ctx)(ctx, pair.value, false);
    if (value !== null) {
      if (isSerializedValue(value)) {
        result.set(pair.key, value);
      } else if (typeof value === 'string') {
        result.set(pair.key, literal(value));
      }
    }
  }

  return result;
}

/**
 * Visit a simple mustache (no params).
 */
function visitSimpleMustache(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  hashArgs: Map<string, SerializedValue>,
  _wrap: boolean,
  range?: SourceRange
): SerializedValue {
  const pathExpr = node.path as ASTv1.PathExpression;
  const pathName = getPathExpressionString(pathExpr);

  // Check if it's a known path:
  // - 'this' and 'this.xxx' are always valid paths
  // - '@xxx' (arg references) are always valid paths
  // - Paths with explicit bindings
  const head = pathExpr.head;
  const isThisPath = head.type === 'ThisHead';
  const isArg = head.type === 'AtHead';
  let headName = 'this';
  if (head.type !== 'ThisHead') {
    headName = head.name ?? head.original;
  }
  const hasBinding = !isArg && !isThisPath && ctx.scopeTracker.hasBinding(headName);
  const isKnownPath = isThisPath || isArg || hasBinding;

  const pathRange = getNodeRange(pathExpr);

  // No hash args - could be a path or a no-arg helper
  if (hashArgs.size === 0) {
    if (isKnownPath) {
      // Known binding - return as path reference
      const resolved = resolvePath(ctx, pathName);
      const partsInfo = getPathPartRanges(pathExpr);
      return path(resolved, isArg, pathRange, partsInfo?.parts, partsInfo?.rootRange);
    }

    // Unknown binding without hash args - return as helper value.
    // buildHelper handles: builtin detection, maybeHelper for unknowns, $_ prefixes.
    return helper(pathName, [], new Map(), range, pathRange);
  }

  // Has hash args - helper call.
  // Return as structured helper value; buildHelper handles:
  // - Known bindings (direct call or maybeHelper with WITH_HELPER_MANAGER)
  // - Unknown helpers (maybeHelper with scope resolution)
  // - Built-in helpers (symbol lookup)
  return helper(pathName, [], hashArgs, range, pathRange);
}


/**
 * Visit a helper mustache (with params).
 */
function visitHelperMustache(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  hashArgs: Map<string, SerializedValue>,
  wrap: boolean,
  range?: SourceRange
): SerializedValue {
  const pathExpr = node.path as ASTv1.PathExpression;
  const pathName = getPathExpressionString(pathExpr);

  // Collect positional args
  const positional = node.params.map((param) => {
    const result = getVisit(ctx)(ctx, param, false);
    if (result === null) return literal(null);
    if (typeof result === 'string') return literal(result);
    if (isSerializedValue(result)) return result;
    return raw(JSON.stringify(result));
  });

  // Use standard helper value to preserve positional param source ranges.
  // buildHelper() in the serializer handles:
  // - Known bindings (direct call)
  // - Unknown helpers (maybeHelper with scope resolution)
  // - Built-in helpers (symbol lookup)
  // By returning a structured 'helper' SerializedValue, each positional
  // param retains its sourceRange through buildValue() → streaming serialization.
  const pathRange = getNodeRange(pathExpr);
  const helperValue = helper(pathName, positional, hashArgs, range, pathRange);

  if (wrap) {
    // Wrap in getter - use the getter type so buildValue handles it properly
    // This ensures path arguments get wrapped in compat mode
    return getter(helperValue, range);
  }

  return helperValue;
}
