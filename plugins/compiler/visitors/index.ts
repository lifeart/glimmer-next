/**
 * Visitor Pattern Implementation
 *
 * This module provides a single-pass visitor for Glimmer AST nodes.
 * Each visitor function receives the CompilerContext and returns a SerializedValue or HBSChild.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext } from '../context';
import type {
  SerializedValue,
  HBSChild,
  HBSNode,
  HBSControlExpression,
  SourceRange,
} from '../types';
import { literal, path, raw, helper, getter, concat, isSerializedValue } from '../types';
import { getNodeRange, resolvePath, setSourceForRanges, getPathPartRanges, getPathExpressionString } from './utils';

// Re-export for compile.ts
export { setSourceForRanges };
import { visitText, isWhitespaceOnly } from './text';
import { visitMustache } from './mustache';
import { visitBlock } from './block';
import { visitElement } from './element';
import { INTERNAL_HELPERS } from '../serializers/symbols';

/**
 * Result of visiting a node - can be a value, an HBS structure, or null if filtered
 */
export type VisitResult =
  | SerializedValue
  | HBSNode
  | HBSControlExpression
  | string
  | null;

/**
 * Visit an AST node and return the appropriate value.
 *
 * This is the main dispatcher that routes nodes to their specific visitors.
 *
 * @param ctx - The compiler context
 * @param node - The AST node to visit
 * @param wrap - Whether to wrap expressions in getters (default: true)
 */
export function visit(
  ctx: CompilerContext,
  node: ASTv1.Node,
  wrap = true
): VisitResult {
  // Track that we've seen this node
  ctx.seenNodes.add(node);

  const range = getNodeRange(node);

  switch (node.type) {
    // Literals
    case 'UndefinedLiteral':
      return literal(undefined, range);

    case 'NullLiteral':
      return literal(null, range);

    case 'BooleanLiteral':
      return literal(node.value, range);

    case 'NumberLiteral':
      return literal(node.value, range);

    case 'StringLiteral':
      return literal(node.value, range);

    // Text nodes
    case 'TextNode':
      return visitText(ctx, node);

    // Path expressions
    case 'PathExpression':
      return visitPathExpression(ctx, node, wrap, range);

    // Concatenation
    case 'ConcatStatement':
      return visitConcatStatement(ctx, node);

    // Sub-expressions (helpers)
    case 'SubExpression':
      return visitSubExpression(ctx, node, wrap);

    // Mustache statements
    case 'MustacheStatement':
      return visitMustache(ctx, node, wrap);

    // Block statements
    case 'BlockStatement':
      return visitBlock(ctx, node);

    // Elements
    case 'ElementNode':
      return visitElement(ctx, node);

    default:
      // Unknown node type - return null
      return null;
  }
}

/**
 * Visit a PathExpression node.
 *
 * Always returns a 'path' SerializedValue. The wrapping in getters for
 * reactivity is handled by buildPath() based on IS_GLIMMER_COMPAT_MODE.
 *
 * The 'wrap' parameter is kept for API compatibility but is no longer used
 * to determine the return type. Paths should always go through buildPath()
 * for proper compat mode handling.
 */
function visitPathExpression(
  ctx: CompilerContext,
  node: ASTv1.PathExpression,
  _wrap: boolean,
  range?: SourceRange
): SerializedValue {
  let pathString = getPathExpressionString(node);
  let isArg = node.head.type === 'AtHead';

  // In compat mode, rewrite `this.attrs.X` → `@X` (deprecated Ember pattern).
  // The Glimmer parser produces ThisHead + tail ["attrs", "X", ...].
  if (
    ctx.flags.IS_GLIMMER_COMPAT_MODE &&
    node.head.type === 'ThisHead' &&
    node.tail.length >= 2 &&
    node.tail[0] === 'attrs'
  ) {
    // this.attrs.foo.bar → @foo.bar
    const remainingTail = node.tail.slice(1);
    pathString = `@${remainingTail.join('.')}`;
    isArg = true;
  }

  const resolved = resolvePath(ctx, pathString);
  const partsInfo = getPathPartRanges(node);

  // Always return as a path value - buildPath() handles compat mode wrapping
  return path(resolved, isArg, range, partsInfo?.parts, partsInfo?.rootRange);
}

/**
 * Visit a ConcatStatement node (attribute interpolation).
 */
function visitConcatStatement(
  ctx: CompilerContext,
  node: ASTv1.ConcatStatement
): SerializedValue {
  const parts: SerializedValue[] = [];

  for (const part of node.parts) {
    if (part.type === 'TextNode') {
      ctx.seenNodes.add(part);
      parts.push(literal(part.chars));
    } else {
      const result = visit(ctx, part, false);
      if (result !== null && isSerializedValue(result)) {
        parts.push(result);
      } else {
        parts.push(literal(''));
      }
    }
  }

  const range = getNodeRange(node);
  return getter(concat(parts, range), range);
}

/**
 * Visit a SubExpression node (helper call).
 */
function visitSubExpression(
  ctx: CompilerContext,
  node: ASTv1.SubExpression,
  wrap: boolean
): SerializedValue | null {
  if (node.path.type !== 'PathExpression') {
    return null;
  }

  const name = getPathExpressionString(node.path);
  const range = getNodeRange(node);

  // In compat mode, transform (mut (get obj key)) → (__mutGet obj key)
  // This enables two-way binding with dynamic property paths.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && name === 'mut' && node.params.length === 1) {
    const firstParam = node.params[0];
    if (firstParam.type === 'SubExpression' && firstParam.path.type === 'PathExpression' && getPathExpressionString(firstParam.path) === 'get') {
      // (mut (get obj key)) → (__mutGet obj key)
      const mutGetPositional = firstParam.params.map((param) => {
        const result = visit(ctx, param, false);
        if (result === null) return literal(null);
        if (typeof result === 'string') return literal(result);
        if (isSerializedValue(result)) return result;
        return raw(JSON.stringify(result));
      });
      const pathRange = getNodeRange(node.path);
      const mutGetResult = helper('__mutGet', mutGetPositional, new Map(), range, pathRange);
      if (wrap) {
        return getter(mutGetResult, range);
      }
      return mutGetResult;
    }
  }

  // In compat mode, transform (mut this.prop) / (mut @arg) to pass the property
  // path as a second string argument so the mut helper can create a proper setter.
  // (mut this.foo) → (mut this.foo "this.foo")
  // (mut @bar)     → (mut @bar "@bar")
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && name === 'mut' && node.params.length === 1) {
    const firstParam = node.params[0];
    if (firstParam.type === 'PathExpression') {
      const paramPath = getPathExpressionString(firstParam);
      if (paramPath.startsWith('this.') || paramPath.startsWith('@')) {
        const paramResult = visit(ctx, firstParam, false);
        const firstArg = paramResult && isSerializedValue(paramResult) ? paramResult : literal(null);
        const mutPositional = [firstArg, literal(paramPath)];
        const mutNamed = new Map<string, SerializedValue>();
        for (const pair of node.hash.pairs) {
          const value = visit(ctx, pair.value, false);
          if (value !== null && isSerializedValue(value)) {
            mutNamed.set(pair.key, value);
          } else if (typeof value === 'string') {
            mutNamed.set(pair.key, literal(value));
          }
        }
        const pathRange = getNodeRange(node.path);
        const mutResult = helper(name, mutPositional, mutNamed, range, pathRange);
        if (wrap) {
          return getter(mutResult, range);
        }
        return mutResult;
      }
    }
  }

  // `(has-block)` / `(has-block-params)` are handled as built-in helpers
  // by `buildBuiltInHelper` (see plugins/compiler/serializers/value.ts):
  // it emits `$_hasBlock.bind(this, $slots)(name)` so the free runtime
  // helper receives the locally-extracted `$slots` and the block name.
  // We deliberately fall through here — the WIP rewrite that emitted
  // `this.$_hasBlock(name)` instead broke template-only components,
  // which compile to plain `function () { ... }` invoked with `new`,
  // producing a fresh `this` with no such method.

  // Special handling for (element "tag") - creates a dynamic component wrapper.
  // Validate arity / named args. On misuse, emit a raw `throw` expression as
  // the tag so the wrapper fails at invocation time (the runtime-compiler
  // swallows compile-time throws into result.errors; the test wraps both
  // template() and renderComponent() in assert.throws, so a render-time
  // throw still matches the Ember regex).
  if (name === 'element') {
    let tagValue: SerializedValue;
    if (node.params.length !== 1) {
      tagValue = raw('(()=>{throw new Error("The `element` helper takes a single positional argument")})()');
    } else if (node.hash.pairs.length !== 0) {
      tagValue = raw('(()=>{throw new Error("The `element` helper does not take any named arguments")})()');
    } else {
      const tagParam = node.params[0];
      const tagResult = visit(ctx, tagParam, false);
      tagValue = tagResult && isSerializedValue(tagResult) ? tagResult : literal('div');
    }
    const pathRange = getNodeRange(node.path);
    return helper(INTERNAL_HELPERS.ELEMENT_HELPER, [tagValue], new Map(), range, pathRange);
  }

  // Collect positional arguments.
  //
  // Special-case the `(modifier NAME ...)` keyword: when NAME is a free
  // (out-of-scope) bare identifier — e.g. the built-in `on` keyword in
  // strict-mode templates like `{{ (if true (modifier on "click" cb) )}}` —
  // the runtime $_modifierHelper needs a string it can resolve via
  // INTERNAL_MODIFIER_MANAGERS / `_builtinModifiers`. Emitting it as a JS
  // identifier would produce a ReferenceError at evaluation time because
  // no `const on = ...` binding exists in the generated factory. The
  // `modifier` keyword's runtime wrapper (createEmberModifierHelper) already
  // handles string-name resolution; we just need to deliver the string.
  const positional = node.params.map((param, idx) => {
    // First positional param of `(modifier ...)` may need name-as-string
    // hoisting; handle it explicitly before the generic visit() dispatch.
    if (
      idx === 0 &&
      name === 'modifier' &&
      param.type === 'PathExpression' &&
      param.head.type === 'VarHead' &&
      param.tail.length === 0
    ) {
      const headName = (param.head as { name?: string; original: string }).name
        ?? param.head.original;
      const isInScope = ctx.scopeTracker.hasBinding(headName);
      if (!isInScope) {
        // Free identifier — emit as string literal so the runtime resolves
        // it via the modifier registry (e.g. "on" → OnModifierManager).
        return literal(headName, getNodeRange(param));
      }
    }
    const result = visit(ctx, param, false);
    if (result === null) return literal(null);
    if (typeof result === 'string') return literal(result);
    if (isSerializedValue(result)) return result;
    return raw(JSON.stringify(result));
  });

  // Collect named arguments
  const named = new Map<string, SerializedValue>();
  for (const pair of node.hash.pairs) {
    const value = visit(ctx, pair.value, false);
    if (value !== null && isSerializedValue(value)) {
      named.set(pair.key, value);
    } else if (typeof value === 'string') {
      named.set(pair.key, literal(value));
    }
  }

  const pathRange = getNodeRange(node.path);
  const result = helper(name, positional, named, range, pathRange);

  // If wrap is requested, wrap the helper result in a getter for reactivity
  // This is needed for conditions in {{#if (helper args)}} blocks
  // Exception: has-block and has-block-params return bound functions that
  // should be called directly by $_if, not wrapped in another getter
  if (wrap && name !== 'has-block' && name !== 'has-block-params') {
    return getter(result, range);
  }

  return result;
}

/**
 * Filter and visit children nodes, removing whitespace-only text nodes.
 */
export function visitChildren(
  ctx: CompilerContext,
  children: ASTv1.Statement[]
): HBSChild[] {
  const results: HBSChild[] = [];

  for (const child of children) {
    // Skip whitespace-only text nodes
    if (child.type === 'TextNode' && isWhitespaceOnly(child.chars)) {
      ctx.seenNodes.add(child);
      continue;
    }

    const result = visit(ctx, child);
    if (result !== null) {
      if (typeof result === 'string') {
        results.push(result);
      } else if (isSerializedValue(result)) {
        results.push(result);
      } else {
        results.push(result as HBSNode | HBSControlExpression);
      }
    }
  }

  return results;
}

// Re-export utilities
export { getNodeRange, resolvePath, serializeValueToString } from './utils';

// Re-export individual visitors
export { visitText, isWhitespaceOnly } from './text';
export { visitMustache } from './mustache';
export { visitBlock } from './block';
export { visitElement } from './element';
