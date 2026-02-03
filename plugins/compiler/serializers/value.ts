/**
 * Value Serializer
 *
 * Serializes SerializedValue types to JavaScript code strings.
 * Uses the CodeBuilder pattern for clean code generation.
 */

import type { CompilerContext } from '../context';
import type { SerializedValue, SourceRange, PathValue } from '../types';
import { SYMBOLS, INTERNAL_HELPERS, getBuiltInHelperSymbol } from './symbols';
import {
  B,
  serializeJS,
  type JSExpression,
} from '../builder';

/**
 * Serialize a SerializedValue to JavaScript code.
 *
 * @param ctx - The compiler context
 * @param value - The value to serialize
 * @param ctxName - The current context variable name
 */
export function serializeValue(
  ctx: CompilerContext,
  value: SerializedValue,
  ctxName = 'this'
): string {
  const node = buildValue(ctx, value, ctxName);
  const fmt = ctx.formatter.options;
  // Note: Emitter is handled at the top level in compile.ts
  // Source ranges are embedded in JSExpression nodes for later mapping
  return serializeJS(node, {
    format: fmt.enabled,
    indent: fmt.indent,
    baseIndent: fmt.baseIndent,
    emitPure: fmt.emitPure,
  });
}

/**
 * Build a JSExpression from a SerializedValue.
 * This is the core transformation that converts the intermediate representation
 * to a CodeBuilder AST node for code generation.
 */
export function buildValue(
  ctx: CompilerContext,
  value: SerializedValue,
  ctxName: string
): JSExpression {
  switch (value.kind) {
    case 'literal':
      return buildLiteral(value.value, value.sourceRange);

    case 'path':
      return buildPathExpression(ctx, value, ctx.flags.IS_GLIMMER_COMPAT_MODE, ctxName);

    case 'spread':
      return buildSpread(ctx, value.expression, value.sourceRange);

    case 'raw':
      return B.raw(value.code, value.sourceRange);

    case 'helper':
      return buildHelper(ctx, value.name, value.positional, value.named, ctxName, value.sourceRange, value.pathRange);

    case 'getter':
      // Wrap the inner value in an arrow function: () => innerValue
      return B.getter(buildValue(ctx, value.value, ctxName), value.sourceRange);

    case 'concat':
      // Build [part1, part2, ...].join('') with source mapping for paths.
      // Parts use direct references (no reactive getter wrapping) since the
      // outer getter already provides reactivity.
      return buildConcat(ctx, value.parts, ctxName, value.sourceRange);
  }
}

/**
 * Build a literal value.
 */
function buildLiteral(
  value: string | number | boolean | null | undefined,
  sourceRange?: SourceRange
): JSExpression {
  if (value === undefined) return B.undef(sourceRange);
  if (value === null) return B.nil(sourceRange);
  if (typeof value === 'string') return B.string(value, sourceRange);
  if (typeof value === 'boolean') return B.bool(value, sourceRange);
  return B.num(value, sourceRange);
}

/**
 * Build a path expression.
 * Uses proper JSExpression types instead of $: magic prefix.
 *
 * For unknown bindings in IS_GLIMMER_COMPAT_MODE, this generates a
 * $_maybeHelper call to support dynamic resolution via eval/scope.
 */
export function buildPathExpression(
  ctx: CompilerContext,
  value: PathValue,
  wrapInGetter = ctx.flags.IS_GLIMMER_COMPAT_MODE,
  ctxName = 'this'
): JSExpression {
  const expression = value.expression;

  // Check if this is a known binding
  // Known bindings: @args, this.*, or explicitly declared in scopeTracker
  const rootName = expression.split(/[.\[]/)[0];
  const isKnown = value.isArg ||
    expression.startsWith('this.') ||
    expression.startsWith('this[') ||
    expression === 'this' ||
    ctx.scopeTracker.hasBinding(rootName);

  // For unknown bindings in compat mode, use $_maybeHelper for dynamic resolution
  // This enables eval/scope-based lookup for unknown references
  if (!isKnown && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    // Build $_maybeHelper("name", [], ctx) or $_maybeHelper("name", [])
    // Pass ctx only when WITH_EVAL_SUPPORT is enabled (for $_eval access)
    // This avoids creating closure functions on every reactive update
    const maybeHelperArgs: JSExpression[] = [
      B.string(expression, value.sourceRange),
      B.array([]),
    ];
    // Only pass context when eval support is enabled
    if (ctx.flags.WITH_EVAL_SUPPORT) {
      maybeHelperArgs.push(B.id(ctxName));
    }
    const maybeHelperCall = B.call(SYMBOLS.MAYBE_HELPER, maybeHelperArgs, value.sourceRange);

    if (wrapInGetter) {
      return B.reactiveGetter(maybeHelperCall, value.sourceRange);
    }
    return maybeHelperCall;
  }

  const pathExpr = buildPathBase(ctx, value);
  if (wrapInGetter && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    return B.reactiveGetter(pathExpr, value.sourceRange);
  }
  return pathExpr;
}

function buildPathBase(
  _ctx: CompilerContext,
  value: PathValue
): JSExpression {
  const resolved = toSafeJSPath(value.expression);

  let parts = value.parts?.map(p => p.name);
  let ranges = value.parts?.map(p => p.range);
  let rootRange = value.rootRange;

  if (!parts || parts.length === 0) {
    // Fallback: if sourceRange length matches the expression, derive ranges from it.
    if (value.sourceRange) {
      const spanLen = value.sourceRange.end - value.sourceRange.start;
      if (spanLen === value.expression.length && !value.expression.includes('?.') && !value.expression.includes('[')) {
        const tokens = value.expression.split('.');
        let offset = 0;
        parts = tokens.map((token) => token);
        ranges = tokens.map((token, index) => {
          const start = value.sourceRange!.start + offset;
          const end = start + token.length;
          offset += token.length + 1;
          if (index === 0) {
            rootRange = { start, end };
          }
          return { start, end };
        });
      }
    }
  }

  if (!parts || parts.length === 0) {
    return B.runtimeRef(resolved, value.sourceRange);
  }

  let expr: JSExpression;
  let startIndex: number;
  let optionalStartIndex: number;
  let mappingStartIndex: number;

  if (value.isArg) {
    expr = B.runtimeRef(`this[${SYMBOLS.ARGS_PROPERTY}]`, rootRange ?? value.sourceRange);
    startIndex = 0;
    optionalStartIndex = 1;
    // Always map the first arg segment (e.g., @user.name -> map "user")
    mappingStartIndex = 0;
  } else {
    const rootName = parts[0] ?? resolved.split('.')[0] ?? resolved;
    expr = B.runtimeRef(rootName, rootRange ?? value.sourceRange);
    startIndex = 1;
    optionalStartIndex = 2;
    mappingStartIndex = 1;
  }

  for (let i = startIndex; i < parts.length; i++) {
    const name = parts[i];
    const range = i >= mappingStartIndex ? ranges?.[i] : undefined;
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);

    if (needsBracket) {
      const propExpr = B.string(name, range);
      const useOptional = i >= optionalStartIndex;
      expr = B.computedMember(expr, propExpr, undefined, useOptional);
      continue;
    }

    const useOptional = i >= optionalStartIndex;
    expr = useOptional
      ? B.optionalMember(expr, name, undefined, range)
      : B.member(expr, name, undefined, range);
  }

  return expr;
}

/**
 * Convert a path to safe JS (add optional chaining for array access).
 */
export function toSafeJSPath(path: string): string {
  // Convert foo[0].bar to foo[0]?.bar for safety
  return path.replace(/\[(\d+)\]\./g, '[$1]?.');
}

/**
 * Build a spread expression from a string.
 * Converts "...foo" into a spread node with a runtime reference.
 */
function buildSpread(
  _ctx: CompilerContext,
  expression: string,
  sourceRange?: SourceRange
): JSExpression {
  const inner = expression.startsWith('...') ? expression.slice(3) : expression;
  const resolved = toSafeJSPath(inner);
  return B.spread(B.runtimeRef(resolved, sourceRange), sourceRange);
}

/**
 * Build a concat expression: [part1, part2, ...].join('')
 * Parts use direct references (no reactive getter) since the outer getter handles reactivity.
 */
function buildConcat(
  ctx: CompilerContext,
  parts: readonly SerializedValue[],
  ctxName: string,
  sourceRange?: SourceRange
): JSExpression {
  const exprs = parts.map(p => {
    if (p.kind === 'path') {
      // Direct reference for source mapping, no reactive getter wrapping
      return buildPathExpression(ctx, p, false, ctxName);
    }
    return buildValue(ctx, p, ctxName);
  });
  return B.methodCall(B.array(exprs), 'join', [B.string('')], sourceRange);
}

/**
 * Build a helper call.
 */
function buildHelper(
  ctx: CompilerContext,
  name: string,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string,
  sourceRange?: SourceRange,
  pathRange?: SourceRange
): JSExpression {
  if (name === INTERNAL_HELPERS.ELEMENT_HELPER) {
    const tagValue = positional[0] ?? { kind: 'literal', value: 'div' };
    const tagExpr = buildValue(ctx, tagValue, ctxName);
    return B.elementHelperWrapper(tagExpr, {
      GET_ARGS: SYMBOLS.GET_ARGS,
      GET_FW: SYMBOLS.GET_FW,
      GET_SLOTS: SYMBOLS.GET_SLOTS,
      FINALIZE_COMPONENT: SYMBOLS.FINALIZE_COMPONENT,
      TAG: SYMBOLS.TAG,
      SLOT: SYMBOLS.SLOT,
      LOCAL_FW: SYMBOLS.LOCAL_FW,
      LOCAL_SLOTS: SYMBOLS.LOCAL_SLOTS,
    }, sourceRange);
  }

  // Handle @arg-prefixed helper names (helper passed as argument)
  // e.g., (@myHelper arg) -> this[$args].myHelper(arg)
  let resolvedName = name;
  if (name.startsWith('@')) {
    const argName = name.slice(1);
    // Use bracket notation for names with special characters (like hyphens)
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName);
    resolvedName = needsBracket
      ? `this[${SYMBOLS.ARGS_PROPERTY}]["${argName}"]`
      : `this[${SYMBOLS.ARGS_PROPERTY}].${argName}`;
  }

  // Check if it's a known binding (component/helper from scope)
  // This check must come BEFORE the builtin check so that local bindings
  // can shadow builtins (e.g., a local `or` function overrides builtin $__or)
  // For dotted/bracket paths like "myObj.method" or "global['prop']",
  // check the root segment (e.g., "myObj", "global")
  const rootName = name.split(/[.\[]/)[0];
  const isKnown = name.startsWith('@') ||
    name.startsWith('this.') ||
    name.startsWith('this[') ||
    name.startsWith('$_') ||
    ctx.scopeTracker.hasBinding(rootName);

  // Handle unless -> if transformation (swap args)
  // Only when not shadowed by a local binding
  // unless(cond, a, b) -> if(cond, b, a)
  if (name === 'unless' && !isKnown) {
    let transformedPositional: readonly SerializedValue[];
    if (positional.length >= 2) {
      if (positional.length >= 3) {
        // unless(cond, true, false) -> if(cond, false, true)
        transformedPositional = [positional[0], positional[2], positional[1]];
      } else {
        // unless(cond, true) -> if(cond, "", true)
        transformedPositional = [positional[0], { kind: 'literal', value: '' }, positional[1]];
      }
    } else {
      transformedPositional = positional;
    }
    return buildBuiltInHelper(ctx, SYMBOLS.IF_HELPER, transformedPositional, named, ctxName, sourceRange, pathRange, name);
  }

  // Check for built-in helpers (only when not shadowed by a local binding)
  if (!isKnown) {
    const builtIn = getBuiltInHelperSymbol(name);
    if (builtIn) {
      return buildBuiltInHelper(ctx, builtIn, positional, named, ctxName, sourceRange, pathRange, name);
    }
  }

  // Special helpers like component(), helper(), modifier() use different arg format
  const isSpecialHelper =
    name === SYMBOLS.COMPONENT_HELPER ||
    name === SYMBOLS.HELPER_HELPER ||
    name === SYMBOLS.MODIFIER_HELPER;

  if (isSpecialHelper) {
    return buildSpecialHelper(ctx, name, positional, named, ctxName, sourceRange, pathRange);
  }

  if (isKnown) {
    // When WITH_HELPER_MANAGER is enabled, even known bindings go through
    // maybeHelper for runtime lifecycle management (passing function reference).
    if (ctx.flags.WITH_HELPER_MANAGER) {
      return buildMaybeHelper(ctx, name, positional, named, ctxName, sourceRange, resolvedName, pathRange);
    }
    // Known helper binding - build args without compat-mode reactive getter
    // wrapping. For direct calls, paths should be plain values, not getters.
    const args = buildDirectCallArgs(ctx, positional, named, ctxName);
    // Use runtimeRef for the callee to preserve source map name for debugger hover
    const callee = pathRange ? B.runtimeRef(resolvedName, pathRange) : resolvedName;
    return B.call(callee, args, sourceRange);
  }

  // Unknown helper - use maybe helper wrapper with $scope for resolution
  return buildMaybeHelper(ctx, name, positional, named, ctxName, sourceRange, undefined, pathRange);
}

/**
 * Build a special helper (component, helper, modifier).
 */
function buildSpecialHelper(
  ctx: CompilerContext,
  name: string,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string,
  sourceRange?: SourceRange,
  pathRange?: SourceRange
): JSExpression {
  const posArgs = positional.map(arg => buildValue(ctx, arg, ctxName));
  const namedObj = buildNamedArgsObject(ctx, named, ctxName);
  const callee = pathRange ? B.id(name, pathRange, 'PathExpression', name) : name;
  return B.call(callee, [B.array(posArgs), namedObj], sourceRange);
}

/**
 * Build a maybe helper call.
 * For unknown helpers: passes the name as a string and adds scope key for resolution.
 * For known helpers (WITH_HELPER_MANAGER): passes the function reference directly.
 *
 * @param resolvedRef - If provided, the helper is a known binding and this is the
 *   resolved reference name to pass as a function reference (not a string).
 */
function buildMaybeHelper(
  ctx: CompilerContext,
  name: string,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string,
  sourceRange?: SourceRange,
  resolvedRef?: string,
  nameRange?: SourceRange
): JSExpression {
  const posArgs = positional.map(arg => buildValue(ctx, arg, ctxName));

  // Build named args
  const namedProps = [];
  for (const [key, val] of named) {
    namedProps.push(B.prop(key, buildValue(ctx, val, ctxName), false, val.sourceRange));
  }

  // For unknown bindings, context is passed directly as last arg
  // $_maybeHelper accesses ctx.$_eval and ctx[$args].$_scope directly
  // This avoids creating closure functions on every reactive update

  // For known bindings, pass the function reference; for unknown, pass string name
  const helperRef = resolvedRef
    ? B.id(resolvedRef, nameRange, 'PathExpression', name)
    : B.string(name, nameRange);

  if (resolvedRef) {
    // Known binding - pass hash with named args
    const namedObj = namedProps.length > 0 ? B.object(namedProps) : B.emptyObject();
    return B.call(SYMBOLS.MAYBE_HELPER, [
      helperRef,
      B.array(posArgs),
      namedObj,
    ], sourceRange);
  }

  // Unknown binding - pass context only when WITH_EVAL_SUPPORT is enabled
  // $_maybeHelper accesses ctx.$_eval and ctx[$args].$_scope directly
  if (namedProps.length > 0) {
    // Unknown with named args - pass hash, optionally context (3 or 4 args)
    const callArgs = [
      helperRef,
      B.array(posArgs),
      B.object(namedProps),
    ];
    if (ctx.flags.WITH_EVAL_SUPPORT) {
      callArgs.push(B.id(ctxName));
    }
    return B.call(SYMBOLS.MAYBE_HELPER, callArgs, sourceRange);
  }
  // Unknown without named args - pass context only if eval support enabled
  const callArgs = [
    helperRef,
    B.array(posArgs),
  ];
  if (ctx.flags.WITH_EVAL_SUPPORT) {
    callArgs.push(B.id(ctxName));
  }
  return B.call(SYMBOLS.MAYBE_HELPER, callArgs, sourceRange);
}

/**
 * Build named args as an object expression.
 */
function buildNamedArgsObject(
  ctx: CompilerContext,
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string
): JSExpression {
  if (named.size === 0) return B.emptyObject();

  const props = [];
  for (const [key, val] of named) {
    props.push(B.prop(key, buildValue(ctx, val, ctxName), false, val.sourceRange));
  }
  return B.object(props);
}

// Note: getBuiltInHelperSymbol is imported from ./symbols (the single source of truth)

/**
 * Set of reactive helpers that need ALL positional arguments wrapped in getters.
 * These helpers evaluate their arguments lazily for reactivity.
 */
const REACTIVE_HELPERS: Set<string> = new Set([
  SYMBOLS.IF_HELPER,
  SYMBOLS.EQ,
  SYMBOLS.NOT,
  SYMBOLS.OR,
  SYMBOLS.AND,
]);

/**
 * Build a built-in helper call.
 */
function buildBuiltInHelper(
  ctx: CompilerContext,
  symbol: string,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string,
  sourceRange?: SourceRange,
  nameRange?: SourceRange,
  displayName?: string
): JSExpression {
  const helperId = nameRange ? B.id(symbol, nameRange, 'PathExpression', displayName ?? symbol) : symbol;

  // Special handling for hash helper - wrap values in getters so $__hash
  // can lazily evaluate them without auto-calling functions
  if (symbol === SYMBOLS.HASH) {
    const hashProps = [];
    for (const [key, val] of named) {
      // Wrap the value in a getter for lazy evaluation
      let builtVal = buildValue(ctx, val, ctxName);
      // In compat mode, paths are already wrapped in reactive getters (() => expr).
      // Hash provides its own getter wrapping, so unwrap to avoid double-wrapping.
      if (builtVal.type === 'reactiveGetter') {
        builtVal = builtVal.expression;
      }
      // Use B.getter() to preserve AST structure for sourcemaps
      hashProps.push(B.prop(key, B.getter(builtVal, val.sourceRange), false, val.sourceRange));
    }
    return B.call(helperId, [B.object(hashProps)], sourceRange);
  }

  // Special handling for fn helper - first argument is the function reference
  // and should NOT be wrapped in a getter (it needs to be called directly)
  if (symbol === SYMBOLS.FN) {
    const args = buildFnHelperArgs(ctx, positional, ctxName);
    return B.call(helperId, args, sourceRange);
  }

  // Reactive helpers need dynamic arguments wrapped in getters
  // for proper lazy evaluation: $__if(() => cond, "a", "b")
  if (REACTIVE_HELPERS.has(symbol)) {
    const args = buildReactiveHelperArgs(ctx, positional, ctxName);
    return B.call(helperId, args, sourceRange);
  }

  const args = buildHelperArgs(ctx, positional, named, ctxName);

  // Special handling for has-block helpers - they need bound to $slots
  if (symbol === SYMBOLS.HAS_BLOCK || symbol === SYMBOLS.HAS_BLOCK_PARAMS) {
    const bindTarget = typeof helperId === 'string' ? B.id(helperId) : helperId;
    const bindCall = B.methodCall(bindTarget, 'bind', [B.id(ctxName), B.id('$slots')], sourceRange);
    if (positional.length > 0) {
      // Call the bound function with args
      return B.call(bindCall, args, sourceRange);
    }
    // Just return the bound function
    return bindCall;
  }

  // Special handling for debugger - prepend this and use .call
  if (symbol === SYMBOLS.DEBUGGER) {
    const callArgs = [B.id(ctxName), ...args];
    const callTarget = typeof helperId === 'string' ? B.id(helperId) : helperId;
    return B.methodCall(callTarget, 'call', callArgs, sourceRange);
  }

  // Special handling for component/helper/modifier helpers
  // These expect: $_componentHelper([...positional], {...named})
  // NOT: $_componentHelper(...positional, named)
  if (
    symbol === SYMBOLS.COMPONENT_HELPER ||
    symbol === SYMBOLS.HELPER_HELPER ||
    symbol === SYMBOLS.MODIFIER_HELPER
  ) {
    const posArgs = positional.map(arg => buildValue(ctx, arg, ctxName));
    const namedObj = buildNamedArgsObject(ctx, named, ctxName);
    return B.call(helperId, [B.array(posArgs), namedObj], sourceRange);
  }

  return B.call(helperId, args, sourceRange);
}

/**
 * Build helper arguments (positional and named).
 */
function buildHelperArgs(
  ctx: CompilerContext,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string
): JSExpression[] {
  const args: JSExpression[] = [];

  // Add positional arguments
  for (const arg of positional) {
    args.push(buildValue(ctx, arg, ctxName));
  }

  // Add named arguments as object
  if (named.size > 0) {
    args.push(buildNamedArgsObject(ctx, named, ctxName));
  }

  return args;
}

/**
 * Build arguments for direct calls (known bindings).
 * Unlike buildHelperArgs, this does NOT apply compat-mode reactive getter
 * wrapping to path values. Paths are passed as plain references.
 * Source ranges are still preserved for proper source mapping.
 */
function buildDirectCallArgs(
  ctx: CompilerContext,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string
): JSExpression[] {
  const args: JSExpression[] = [];

  // Add positional arguments without reactive getter wrapping
  for (const arg of positional) {
    if (arg.kind === 'path') {
      // For direct calls, pass paths as plain references (no reactive getter)
      args.push(buildPathExpression(ctx, arg, false, ctxName));
    } else {
      args.push(buildValue(ctx, arg, ctxName));
    }
  }

  // Add named arguments as object
  if (named.size > 0) {
    args.push(buildNamedArgsObject(ctx, named, ctxName));
  }

  return args;
}

/**
 * Build arguments for reactive helpers (if, eq, and, or, not).
 * - Paths: already wrapped by buildPath in compat mode, pass as-is
 * - Literals: pass directly (no wrapping needed)
 * - Getters: already wrapped, pass as-is (avoid double wrapping)
 * - Spread: pass as-is (can't wrap spread operators)
 * - Helpers/raw: wrap in getter for lazy evaluation
 * This ensures reactivity: $__if(() => cond, "a", "b")
 */
function buildReactiveHelperArgs(
  ctx: CompilerContext,
  positional: readonly SerializedValue[],
  ctxName: string
): JSExpression[] {
  const args: JSExpression[] = [];

  for (const arg of positional) {
    const builtVal = buildValue(ctx, arg, ctxName);

    switch (arg.kind) {
      case 'literal':
        // Static values don't need wrapping
        args.push(builtVal);
        break;
      case 'path':
        // Already wrapped by buildPathExpression() in compat mode
        args.push(builtVal);
        break;
      case 'getter':
        // Already a getter, don't double-wrap
        args.push(builtVal);
        break;
      case 'spread':
        // Can't wrap spread operators
        args.push(builtVal);
        break;
      case 'helper':
      case 'raw':
      case 'concat':
        // Dynamic values need wrapping for lazy evaluation
        args.push(B.getter(builtVal, arg.sourceRange));
        break;
    }
  }

  return args;
}

/**
 * Build arguments for fn helper.
 * The first argument is the function reference and should NOT be wrapped in a getter.
 * Subsequent arguments are values that may need getter wrapping in compat mode.
 */
function buildFnHelperArgs(
  ctx: CompilerContext,
  positional: readonly SerializedValue[],
  ctxName: string
): JSExpression[] {
  const args: JSExpression[] = [];

  for (let i = 0; i < positional.length; i++) {
    const arg = positional[i];

    if (i === 0) {
      // First arg is function reference - don't wrap in getter
      // For paths, use raw output instead of reactiveGetter
      if (arg.kind === 'path') {
        args.push(buildPathExpression(ctx, arg, false, ctxName));
      } else {
        args.push(buildValue(ctx, arg, ctxName));
      }
    } else {
      // Other args get normal treatment (wrapped in getter in compat mode)
      args.push(buildValue(ctx, arg, ctxName));
    }
  }

  return args;
}

/**
 * Serialize a value to use in an attribute/property array.
 */
export function serializeAttrValue(
  ctx: CompilerContext,
  value: SerializedValue,
  ctxName: string
): string {
  const serialized = serializeValue(ctx, value, ctxName);

  // For paths, wrap in TO_VALUE for reactivity
  if (value.kind === 'path' && serialized.includes('.')) {
    return `${SYMBOLS.TO_VALUE}(${serialized})`;
  }

  return serialized;
}
