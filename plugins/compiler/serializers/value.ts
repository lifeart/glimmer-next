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
import {
  getStaticLiteralValue,
  shouldAccessCellValue,
  shouldSkipGetterWrapper,
} from '../type-hints';

export interface BuildPathExpressionOptions {
  preferCellValue?: boolean;
}

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
 * `(hash)` / `(array)` are the keyword helpers whose produced object/array
 * identity must be memoized. Classic Glimmer returns a stable compute-ref for
 * them; GXT otherwise rebuilds a fresh identity on every read of the arg getter,
 * which makes reference-comparing consumers (Ember child components, modifiers)
 * over-invalidate. See `cachedHelper` in src/core/reactive.ts.
 */
function isMemoizableIdentityHelper(
  ctx: CompilerContext,
  value: SerializedValue
): boolean {
  if (value.kind !== 'helper') return false;
  if (value.name !== 'hash' && value.name !== 'array') return false;
  // Respect a local binding that shadows the built-in (e.g. block param `hash`).
  return !ctx.scopeTracker.hasBinding(value.name);
}

/**
 * Wrap an already-built value expression in an arg getter, memoizing the
 * identity when the value is a `(hash)` / `(array)` helper so the produced
 * reference stays stable across reads. `$__cached` returns a getter, so the
 * `() => value` calling convention is preserved either way.
 *
 * Gated to the Ember dialect (IS_GLIMMER_COMPAT_MODE + WITH_EMBER_INTEGRATION):
 * the identity-stability contract matters for reference-comparing Ember
 * consumers (child components, modifiers). gxt-standalone AND non-Ember
 * glimmer-compat compilation stay byte-identical (plain `() => value` getter,
 * no `$__cached`).
 */
function buildMaybeMemoizedGetter(
  ctx: CompilerContext,
  value: SerializedValue,
  builtVal: JSExpression,
  sourceRange?: SourceRange
): JSExpression {
  if (
    ctx.flags.IS_GLIMMER_COMPAT_MODE &&
    ctx.flags.WITH_EMBER_INTEGRATION &&
    isMemoizableIdentityHelper(ctx, value)
  ) {
    return B.call(SYMBOLS.CACHED, [B.getter(builtVal, sourceRange)], sourceRange);
  }
  return B.getter(builtVal, sourceRange);
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
      // In compat mode, $__log should not be wrapped in a reactive getter.
      // Ember's {{log}} fires once, not on every re-evaluation.
      // Transform: () => $__log(args) → ($__log("__logSite:N", args), "")
      if (ctx.flags.IS_GLIMMER_COMPAT_MODE &&
          value.value.kind === 'helper' && value.value.name === 'log') {
        const siteId = `__logSite:${ctx.logSiteCounter++}`;
        const innerHelper = value.value;
        const siteIdExpr = B.string(siteId);
        const originalArgs = innerHelper.positional.map(arg => buildValue(ctx, arg, ctxName));
        const logSymbol = getBuiltInHelperSymbol('log')!;
        const logCallWithId = B.call(logSymbol, [siteIdExpr, ...originalArgs], innerHelper.sourceRange);
        // Comma expression: ($__log("siteId", args), "") — evaluates log, returns empty string
        // Must be "" not undefined, because GXT renders undefined as text node
        return B.raw(`(${serializeJS(logCallWithId)}, "")`, value.sourceRange);
      }
      // Wrap the inner value in an arrow function: () => innerValue
      // Use buildValueNoGetter to avoid double-wrapping: getter(path) should
      // produce () => this.x, NOT () => () => this.x
      //
      // For (hash)/(array) the wrap goes through $__cached so the produced
      // object/array reference is identity-stable across reads/re-renders (the
      // arg-access layer re-invokes this getter on every read; a bare arrow
      // would rebuild a fresh identity each time and over-invalidate
      // reference-comparing consumers).
      return buildMaybeMemoizedGetter(
        ctx,
        value.value,
        buildValueNoGetter(ctx, value.value, ctxName),
        value.sourceRange
      );

    case 'concat':
      // Build [part1, part2, ...].join('') with source mapping for paths.
      // Parts use direct references (no reactive getter wrapping) since the
      // outer getter already provides reactivity.
      return buildConcat(ctx, value.parts, ctxName, value.sourceRange);
  }
}

/**
 * Build a value WITHOUT getter wrapping for path expressions.
 * Used inside getter(value) to prevent double-wrapping:
 * getter(path) should produce () => this.x, NOT () => () => this.x
 */
function buildValueNoGetter(
  ctx: CompilerContext,
  value: SerializedValue,
  ctxName: string
): JSExpression {
  if (value.kind === 'path') {
    return buildPathExpression(ctx, value, false, ctxName);
  }
  // For non-path types, buildValue doesn't double-wrap
  return buildValue(ctx, value, ctxName);
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
  ctxName = 'this',
  options: BuildPathExpressionOptions = {}
): JSExpression {
  const expression = value.expression;

  // Check if this is a known binding
  // Known bindings: @args, this.*, or explicitly declared in scopeTracker
  const rootName = expression.split(/[?.\[]/)[0];
  const isKnown = value.isArg ||
    expression.startsWith('this.') ||
    expression.startsWith('this[') ||
    expression === 'this' ||
    ctx.scopeTracker.hasBinding(rootName);

  // For unknown bindings in compat mode with Ember integration,
  // treat bare names as this.name since Ember templates have implicit this.
  // This ensures reactive tracking works — this.cond1 goes through the cell
  // getter and GXT's formula tracking picks it up.
  // Exception: when WITH_EVAL_SUPPORT is true, unknown bindings should use
  // $_maybeHelper for dynamic resolution via eval().
  if (!isKnown && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    if (ctx.flags.WITH_EMBER_INTEGRATION && !ctx.flags.WITH_EVAL_SUPPORT) {
      // Treat as this.expression — Ember's implicit this
      const thisPath = `${ctxName}.${expression}`;
      if (wrapInGetter) {
        return B.reactiveGetter(B.id(thisPath), value.sourceRange);
      }
      return B.id(thisPath);
    }
    // Non-Ember compat or eval mode: use $_maybeHelper for dynamic resolution
    const maybeHelperArgs: JSExpression[] = [
      B.string(expression, value.sourceRange),
      B.array([]),
      B.id(ctxName),
    ];
    const maybeHelperCall = B.call(SYMBOLS.MAYBE_HELPER, maybeHelperArgs, value.sourceRange);

    if (wrapInGetter) {
      return B.reactiveGetter(maybeHelperCall, value.sourceRange);
    }
    return maybeHelperCall;
  }

  const staticLiteral = getStaticLiteralValue(ctx, value.expression, value.isArg);
  if (staticLiteral !== undefined) {
    return buildLiteral(staticLiteral, value.sourceRange);
  }

  // Ember-dialect {{#each}} row-item reactive tap.
  //
  // A member read whose head is a block param — `{{item.text}}` inside
  // `{{#each items as |item|}}` — is rewritten to a host cell tap
  // `$__cellFor(item, "text")` so the read stays reactive on item-property
  // mutation WITHOUT wrapping every row item in a runtime tracking Proxy
  // (the ember-side `wrapEachItemForTracking`). Deep paths tap each segment:
  // `{{item.v.x}}` → `$__cellFor($__cellFor(item, "v"), "x")`.
  //
  // Gated to the Ember dialect (WITH_EMBER_INTEGRATION + IS_GLIMMER_COMPAT_MODE)
  // so gxt-standalone compilation is byte-identical. Same wrap-in-getter
  // discipline as the surrounding path emission.
  if (
    ctx.flags.IS_GLIMMER_COMPAT_MODE &&
    ctx.flags.WITH_EMBER_INTEGRATION &&
    !value.isArg
  ) {
    const tap = buildBlockParamCellTap(ctx, value);
    if (tap) {
      return wrapInGetter ? B.reactiveGetter(tap, value.sourceRange) : tap;
    }
  }

  let pathExpr = buildPathBase(ctx, value);

  if (
    options.preferCellValue &&
    wrapInGetter &&
    shouldAccessCellValue(ctx, value.expression, value.isArg)
  ) {
    pathExpr = B.optionalMember(pathExpr, 'value');
  }

  // Type-directed optimization: skip getter wrapper for known-static values
  if (wrapInGetter && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    if (shouldSkipGetterWrapper(ctx, value.expression, value.isArg)) {
      // Type hint says this value is static -- emit direct reference
      return pathExpr;
    }
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
    expr = B.runtimeRef(SYMBOLS.ARGS_ALIAS, rootRange ?? value.sourceRange);
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
 * Decompose a path into ordered segments (head + members), preferring the
 * lowered `parts` (which carry sourcemap ranges) and falling back to splitting
 * the dotted expression. Returns null for shapes the row-item tap must not
 * touch (bracket / numeric-index / optional-chaining access).
 */
function getPathSegments(
  value: PathValue
): Array<{ name: string; range?: SourceRange }> | null {
  // Prefer the lowered `parts`: they carry clean per-segment names (the head
  // expression string may have `?.` baked in by toOptionalChaining for deep
  // paths) plus sourcemap ranges. Non-identifier segments (numeric/bracket
  // index) are rejected by the caller's per-segment identifier check.
  if (value.parts && value.parts.length > 0) {
    return value.parts.map((p) => ({ name: p.name, range: p.range }));
  }
  // Fallback: split the dotted expression. Bail on bracket / optional-chaining
  // shapes the row-item tap must not touch.
  if (value.expression.includes('[') || value.expression.includes('?')) {
    return null;
  }
  const tokens = value.expression.split('.');
  if (tokens.length === 0) return null;
  return tokens.map((name) => ({ name }));
}

/**
 * Ember-dialect row-item cell tap.
 *
 * For a member read whose head is a block param (e.g. the `{{#each as |item|}}`
 * row item, or a component-yielded value `<Comp as |row|>`), emit a nested
 * `$__cellFor(...)` chain that taps each reactive segment through the host
 * cell. Returns null (caller falls back to the plain read) when the path is not
 * a tappable shape:
 *   - head is not a block param (this.*, @args, components, helpers, let-bindings),
 *   - head is the {{#each}} index param (a reactive Cell, read via `.value`),
 *   - the path is a bare block param with no member (`{{item}}`),
 *   - any member segment is not a simple identifier (numeric/bracket index,
 *     optional chaining) — gxt's tracked-array machinery owns index reactivity.
 */
function buildBlockParamCellTap(
  ctx: CompilerContext,
  value: PathValue
): JSExpression | null {
  const segs = getPathSegments(value);
  if (!segs || segs.length < 2) return null; // need head + >=1 member

  const head = segs[0].name;
  const binding = ctx.scopeTracker.resolve(head);
  if (!binding || binding.kind !== 'block-param') return null;
  // The {{#each}} index is a reactive Cell (read via `.value`), not a raw
  // value — never cellFor-tap it.
  if (binding.isEachIndex) return null;
  // Recycled rows bind to a per-row state object with forwarding accessors;
  // a cellFor tap would clobber that reference-swap channel.
  if (binding.recycledRow) return null;

  // Only simple identifier member segments are tapped; anything else (numeric
  // index, bracket access) bails the whole path to the plain read.
  for (let i = 1; i < segs.length; i++) {
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segs[i].name)) return null;
  }

  // $__cellFor($__cellFor(item, "v"), "x")
  let expr: JSExpression = B.runtimeRef(
    head,
    segs[0].range ?? value.rootRange ?? value.sourceRange
  );
  for (let i = 1; i < segs.length; i++) {
    expr = B.call(
      SYMBOLS.CELL_FOR,
      [expr, B.string(segs[i].name, segs[i].range)],
      value.sourceRange
    );
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
  // e.g., (@myHelper arg) -> $a.myHelper(arg)
  let resolvedName = name;
  if (name.startsWith('@')) {
    const argName = name.slice(1);
    // Use bracket notation for names with special characters (like hyphens)
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName);
    resolvedName = needsBracket
      ? `${SYMBOLS.ARGS_ALIAS}["${argName}"]`
      : `${SYMBOLS.ARGS_ALIAS}.${argName}`;
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
  const maybeHelperExpr = buildMaybeHelper(ctx, name, positional, named, ctxName, sourceRange, undefined, pathRange);

  // In compat mode, wrap {{unbound expr}} calls with caching logic.
  // The unbound helper should snapshot the value once and never update.
  // Wrap: $_maybeHelper("unbound", ...) → globalThis.__gxtUnboundEval(__ubCache, "id", () => (call))
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && name === 'unbound') {
    const ubId = `__ub${ctx.unboundCounter++}`;
    const serialized = serializeJS(maybeHelperExpr);
    return B.raw(
      `globalThis.__gxtUnboundEval(__ubCache,"${ubId}",()=>(${serialized}))`,
      sourceRange
    );
  }

  return maybeHelperExpr;
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
  const callee = pathRange ? B.id(name, pathRange, 'PathExpression', name) : name;

  // In compat mode, wrap $_componentHelper hash values in getter functions
  // for reactivity. This preserves reactivity so curried component args
  // update when dependencies change.
  // Transform: $_componentHelper([params], {key: expr}) → $_componentHelper([params], {key: () => (expr)})
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && name === SYMBOLS.COMPONENT_HELPER) {
    const namedObj = buildComponentHelperNamedArgs(ctx, named, ctxName);
    return B.call(callee, [B.array(posArgs), namedObj], sourceRange);
  }

  const namedObj = buildNamedArgsObject(ctx, named, ctxName);
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

  // Unknown binding - always pass context for scope resolution
  // $_maybeHelper accesses ctx.$_eval and ctx[$args].$_scope directly
  if (namedProps.length > 0) {
    // Unknown with named args - pass hash and context (4 args)
    return B.call(SYMBOLS.MAYBE_HELPER, [
      helperRef,
      B.array(posArgs),
      B.object(namedProps),
      B.id(ctxName),
    ], sourceRange);
  }
  // Unknown without named args - pass context (3 args)
  return B.call(SYMBOLS.MAYBE_HELPER, [
    helperRef,
    B.array(posArgs),
    B.id(ctxName),
  ], sourceRange);
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

/**
 * Build named args for $_componentHelper with getter-wrapped values.
 * In compat mode, each hash value is wrapped in () => (expr) for reactivity,
 * so curried component args update when dependencies change.
 */
function buildComponentHelperNamedArgs(
  ctx: CompilerContext,
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string
): JSExpression {
  if (named.size === 0) return B.emptyObject();

  const props = [];
  for (const [key, val] of named) {
    const builtVal = buildValue(ctx, val, ctxName);
    // Wrap in getter for reactivity, but don't double-wrap if already a function
    const wrappedVal = B.getter(builtVal, val.sourceRange);
    props.push(B.prop(key, wrappedVal, false, val.sourceRange));
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

type KnownLiteral = {
  value: string | number | boolean | null | undefined;
  source: 'hint' | 'literal';
};

function getKnownLiteral(
  ctx: CompilerContext,
  value: SerializedValue
): KnownLiteral | undefined {
  if (value.kind === 'literal') {
    return { value: value.value, source: 'literal' };
  }

  if (value.kind === 'path') {
    const literal = getStaticLiteralValue(ctx, value.expression, value.isArg);
    if (literal !== undefined) {
      return { value: literal, source: 'hint' };
    }
    return undefined;
  }

  if (value.kind === 'getter') {
    return getKnownLiteral(ctx, value.value);
  }

  return undefined;
}

function tryFoldBuiltInHelper(
  ctx: CompilerContext,
  symbol: string,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string,
  sourceRange?: SourceRange
): JSExpression | undefined {
  // Built-ins we fold do not use named arguments in GXT.
  if (named.size > 0) {
    return undefined;
  }

  if (symbol === SYMBOLS.IF_HELPER) {
    if (positional.length === 0) return undefined;
    const cond = getKnownLiteral(ctx, positional[0]);
    if (!cond || cond.source !== 'hint') {
      return undefined;
    }
    const branch = cond.value ? positional[1] : positional[2];
    if (!branch) {
      return B.string('', sourceRange);
    }
    return buildValue(ctx, branch, ctxName);
  }

  if (symbol === SYMBOLS.NOT) {
    if (positional.length === 0) return undefined;
    const arg = getKnownLiteral(ctx, positional[0]);
    if (!arg || arg.source !== 'hint') {
      return undefined;
    }
    return B.bool(!arg.value, sourceRange);
  }

  if (symbol === SYMBOLS.EQ) {
    const literals = positional.map((arg) => getKnownLiteral(ctx, arg));
    const known = literals.filter((entry): entry is KnownLiteral => !!entry);
    if (!known.some((entry) => entry.source === 'hint')) {
      return undefined;
    }
    if (known.length === 0) {
      return undefined;
    }
    const first = known[0].value;
    const hasMismatch = known.some((entry) => entry.value !== first);
    if (hasMismatch) {
      // Any mismatch among known values guarantees eq(...) is false,
      // regardless of unresolved arguments.
      return B.bool(false, sourceRange);
    }
    // If some args are unknown, equality is not provably true yet.
    if (known.length !== literals.length) {
      return undefined;
    }
    return B.bool(true, sourceRange);
  }

  if (symbol === SYMBOLS.AND) {
    const literals = positional.map((arg) => getKnownLiteral(ctx, arg));
    let sawHint = false;
    for (const entry of literals) {
      if (!entry) {
        // Unknown encountered before a decisive false value.
        return undefined;
      }
      if (entry.source === 'hint') {
        sawHint = true;
      }
      if (!entry.value) {
        return sawHint ? B.bool(false, sourceRange) : undefined;
      }
    }
    return sawHint ? B.bool(true, sourceRange) : undefined;
  }

  if (symbol === SYMBOLS.OR) {
    const literals = positional.map((arg) => getKnownLiteral(ctx, arg));
    if (literals.length === 0) {
      return undefined;
    }
    let sawHint = false;
    for (const entry of literals) {
      if (!entry) {
        // Unknown encountered before a decisive truthy value.
        return undefined;
      }
      if (entry.source === 'hint') {
        sawHint = true;
      }
      if (entry.value) {
        return sawHint ? buildLiteral(entry.value, sourceRange) : undefined;
      }
    }
    const last = literals[literals.length - 1] as KnownLiteral;
    return sawHint ? buildLiteral(last.value, sourceRange) : undefined;
  }

  return undefined;
}

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

  const folded = tryFoldBuiltInHelper(
    ctx,
    symbol,
    positional,
    named,
    ctxName,
    sourceRange
  );
  if (folded) {
    return folded;
  }

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
      // Use B.getter() to preserve AST structure for sourcemaps. A nested
      // (hash)/(array) prop is memoized through $__cached so reading
      // `outerHash.nested` returns an identity-stable reference too.
      hashProps.push(B.prop(key, buildMaybeMemoizedGetter(ctx, val, builtVal, val.sourceRange), false, val.sourceRange));
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

  // Special handling for has-block helpers - they need bound to $slots.
  //
  // Emit a CALL of the bound function so the SubExpression evaluates to a
  // boolean wherever it appears. The "no positional args" case used to return
  // just the bound function (e.g. `$_hasBlock.bind(this, $slots)`), which is
  // truthy by virtue of being a function regardless of slot presence. That
  // worked for direct mustache `{{has-block}}` (the renderer auto-calls
  // function children via deepFnValue) and for `{{#if (has-block)}}` (the
  // `$_if` runtime auto-calls function conditions in setupCondition), but
  // broke the inline-helper / attribute paths that route through `$__if`,
  // whose `unwrap()` is shallow and treats a returned function as truthy.
  // (Tests: ember.js curly-components-test "(has-block) expression in an
  // attribute" / "(has-block) as a param to a helper", and the matching
  // (has-block-params) variants.)
  //
  // Calling immediately is safe: `$slots` is fully populated by the time the
  // template body runs (the runtime-compiler wrapper extracts it before
  // returning the array), and `$_hasBlock` / `$_hasBlockParams` perform a
  // pure key lookup against that snapshot — there is no reactivity to
  // preserve via lazy invocation.
  if (symbol === SYMBOLS.HAS_BLOCK || symbol === SYMBOLS.HAS_BLOCK_PARAMS) {
    const bindTarget = typeof helperId === 'string' ? B.id(helperId) : helperId;
    const bindCall = B.methodCall(bindTarget, 'bind', [B.id(ctxName), B.id('$slots')], sourceRange);
    return B.call(bindCall, args, sourceRange);
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
        const pathExpr = buildPathExpression(ctx, arg, false, ctxName);
        // In compat mode, when the first arg is a this.X path, wrap in a
        // getter () => this.X so $__fn_ember can resolve it lazily at call
        // time, supporting reactive function swaps via set().
        if (ctx.flags.IS_GLIMMER_COMPAT_MODE && ctx.flags.WITH_EMBER_INTEGRATION && /^this\.[a-zA-Z_$][a-zA-Z0-9_$.?]*$/.test(arg.expression)) {
          args.push(B.getter(pathExpr, arg.sourceRange));
        } else {
          args.push(pathExpr);
        }
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
