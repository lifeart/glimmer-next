/**
 * Value Serializer
 *
 * Serializes SerializedValue types to JavaScript code strings.
 * Uses the CodeBuilder pattern for clean code generation.
 */

import type { CompilerContext } from '../context';
import { addError, recordLooseBuiltin } from '../context';
import type { SerializedValue, SourceRange, PathValue } from '../types';
import { path } from '../types';
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
import { escapeBindingName } from '../utils/js-utils';

/**
 * When `rootName` refers to a binding whose name is not a plain JS identifier
 * — a JS reserved word (`{{#each x as |if|}}` → the `if` row item; a strict-mode
 * local named `debugger`) or a name such as `each-in` / `some-helper` — return
 * the safe identifier the binding is declared under (`escapeBindingName`:
 * `__bp_if`, `__bp_some$2d$helper`). Block params and let-bindings are declared
 * by the template itself; a caller-provided binding (lexical scope, a strict
 * local) is declared by the caller under the same escaped name. Any other name
 * — a plain identifier, or a name that is not a binding — is returned
 * unchanged, so output stays byte-identical.
 */
function emitBindingRootName(
  ctx: CompilerContext,
  rootName: string
): string {
  const binding = ctx.scopeTracker.resolve(rootName);
  if (
    binding &&
    (binding.kind === 'block-param' || binding.kind === 'let-binding')
  ) {
    // A `{{#let}}` binding renamed because it shadows a name its own value
    // reads (BindingInfo.emitName) is referenced under that fresh name.
    return binding.emitName ?? escapeBindingName(rootName);
  }
  if (binding && binding.kind === 'component') {
    return escapeBindingName(rootName);
  }
  return rootName;
}

/**
 * The emitted text of a callee / tag path whose root may be a binding: the
 * root as `emitBindingRootName` emits it, the rest of the path unchanged.
 */
export function emittedPathName(ctx: CompilerContext, path: string): string {
  const rootName = path.split(/[?.[]/)[0];
  const emitted = emitBindingRootName(ctx, rootName);
  return emitted === rootName ? path : emitted + path.slice(rootName.length);
}

/**
 * `head` followed by the dotted `path` as member reads: a segment that is not a
 * JS identifier is a computed member (`this["each-in"]`, `this.a["b-c"]`).
 * A path that is not a plain dotted path is appended as it is.
 */
function memberPathText(head: string, path: string): string {
  if (path.includes('?.') || path.includes('[')) return `${head}.${path}`;
  let text = head;
  for (const segment of path.split('.')) {
    text += /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment)
      ? `.${segment}`
      : `[${JSON.stringify(segment)}]`;
  }
  return text;
}

/**
 * The emitted JS root identifier of a template name (`emitBindingRootName`),
 * exported for the element serializer's component-tag references.
 */
export function emittedRootName(ctx: CompilerContext, rootName: string): string {
  return emitBindingRootName(ctx, rootName);
}

export interface BuildPathExpressionOptions {
  preferCellValue?: boolean;
}

/**
 * Process-monotonic `{{log}}` site-id counter.
 *
 * The compat-mode `{{log}}` transform prepends a `__logSite:N` id as the first
 * argument so re-evaluations of the same site can be de-duped at runtime
 * (src/core/helpers/log.ts keys `$__logSiteSignatures` on this string). That
 * de-dup Map is a SINGLE process-global structure, so a per-compilation counter
 * (reset to 0 for every template) makes distinct templates collide on
 * `__logSite:0`, `__logSite:1`, … and cross-contaminate each other's dedup
 * state. Making the counter module-global (monotonic across every compilation
 * in the process) guarantees every emitted site id is unique — no host-side
 * renumber pass is needed (the Ember bridge previously re-numbered these).
 *
 * Determinism: exact-code snapshot tests must not pin a specific `__logSite:N`
 * (they don't today — they assert `toContain('__logSite')` / `/__logSite/`).
 * `resetLogSiteCounter()` is exported for any test that wants a stable starting
 * point, mirroring the `resetNodeCounter` / `resetContextCounter` idioms.
 */
let _logSiteCounter = 0;

/** Allocate the next process-unique `{{log}}` site id. */
function nextLogSiteId(): string {
  return `__logSite:${_logSiteCounter++}`;
}

/** Reset the process-global `{{log}}` site-id counter (test hook). */
export function resetLogSiteCounter(): void {
  _logSiteCounter = 0;
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
        const siteId = nextLogSiteId();
        const innerHelper = value.value;
        const siteIdExpr = B.string(siteId);
        const originalArgs = innerHelper.positional.map(arg => buildValue(ctx, arg, ctxName));
        const logSymbol = getBuiltInHelperSymbol('log')!;
        const logCallWithId = B.call(logSymbol, [siteIdExpr, ...originalArgs], innerHelper.sourceRange);
        // Comma expression: ($__log("siteId", args), "") — evaluates log, returns empty string
        // Must be "" not undefined, because GXT renders undefined as text node.
        // Pass the emission report so the raw-embedded $__log (and any nested
        // symbols in its args) land in emittedSymbols.
        return B.raw(
          `(${serializeJS(logCallWithId, { report: ctx.emissionReport })}, "")`,
          value.sourceRange
        );
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

// The source text of a path argument as the template wrote it (`this.foo`,
// `@bar`, `item.name`): no whitespace, quotes, parentheses or braces.
const ARG_LABEL_TEXT = /^[@A-Za-z_$][^\s'"(){}=]*$/;

function argLabel(ctx: CompilerContext, value: SerializedValue): string | null {
  if (value.kind !== 'path' || !value.sourceRange) return null;
  const text = ctx.source.slice(value.sourceRange.start, value.sourceRange.end);
  return ARG_LABEL_TEXT.test(text) ? text : null;
}

/**
 * EMBER_ARG_LABELS: the labels argument of an Ember helper / modifier call
 * site — `{ positional: [...], named: {...} }` with the source text of each
 * path argument (`null` for a positional argument that is not a path; a named
 * argument that is not a path is left out, and so is a part without labels).
 * `null` when the flag is off, outside the Ember dialect
 * (WITH_EMBER_INTEGRATION), or when no argument is a path: the call keeps its
 * shape. The host gives the argument references these debug labels, as
 * Glimmer labels a path reference with its path.
 */
export function buildArgLabels(
  ctx: CompilerContext,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>
): JSExpression | null {
  if (ctx.flags.EMBER_ARG_LABELS !== true || ctx.flags.WITH_EMBER_INTEGRATION !== true) return null;
  const positionalLabels = positional.map((arg) => argLabel(ctx, arg));
  const namedLabels = [];
  for (const [key, val] of named) {
    const label = argLabel(ctx, val);
    if (label !== null) namedLabels.push(B.prop(key, B.string(label)));
  }
  const parts = [];
  if (positionalLabels.some((label) => label !== null)) {
    parts.push(
      B.prop(
        'positional',
        B.array(positionalLabels.map((label) => (label === null ? B.nil() : B.string(label))))
      )
    );
  }
  if (namedLabels.length > 0) parts.push(B.prop('named', B.object(namedLabels)));
  return parts.length > 0 ? B.object(parts) : null;
}

/**
 * EMBER_NATIVE argument convention (Ember native layer, G4/G9): every argument
 * of a helper / modifier / curry call site is either a primitive LITERAL or a
 * zero-arg THUNK (`() => expr`) — never an eagerly evaluated value. The host
 * managers then unwrap EXACTLY (call a function argument once) instead of
 * guessing with the arrow-function heuristic (`$_unwrapHelperArg`), which
 * wrongly calls an arrow-function VALUE (e.g. the result of a nested
 * `(fn …)` / user helper). Laziness is also what Glimmer does: a nested
 * sub-expression is a reference read only when the consumer reads it, and a
 * modifier's arguments are read by the modifier (inside its own tracking
 * frame), not by the element-creation formula.
 */
export function buildNativeArg(
  ctx: CompilerContext,
  value: SerializedValue,
  ctxName: string
): JSExpression {
  switch (value.kind) {
    case 'literal':
      return buildLiteral(value.value, value.sourceRange);
    case 'path': {
      const expr = buildPathExpression(ctx, value, false, ctxName);
      // A statically folded path (type hints) is a literal — keep it one.
      return expr.type === 'literal' ? expr : B.getter(expr, value.sourceRange);
    }
    case 'getter':
      return B.getter(buildValueNoGetter(ctx, value.value, ctxName), value.sourceRange);
    case 'spread':
      return buildValue(ctx, value, ctxName);
    default:
      // helper / raw / concat: a sub-expression, evaluated when read.
      return B.getter(buildValue(ctx, value, ctxName), value.sourceRange);
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
      // Ember native layer (EMBER_SELF / EMBER_PROPERTY_TAGS): the implicit
      // head is the template's SELF (never a block render context).
      if (ctx.flags.EMBER_SELF || ctx.flags.EMBER_PROPERTY_TAGS) {
        const implicit = buildEmberMemberChain(
          ctx,
          B.runtimeRef(selfRootName(ctx), value.sourceRange),
          expression.split('.').map((name) => ({ name })),
          0,
          value.sourceRange
        );
        return wrapInGetter ? B.reactiveGetter(implicit, value.sourceRange) : implicit;
      }
      // Treat as this.expression — Ember's implicit this (a segment that is
      // not a JS identifier, `{{each-in}}`, is a computed member).
      const thisPath = memberPathText(ctxName, expression);
      if (wrapInGetter) {
        return B.reactiveGetter(B.id(thisPath), value.sourceRange);
      }
      return B.id(thisPath);
    }
    // Non-Ember compat or eval mode: use $_maybeHelper for dynamic resolution.
    // Ground-truth: the first arg is the string-form lookup name.
    ctx.emissionReport.maybeHelperNames.add(expression);
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

  // Ember native layer: `this` heads read the template self (G6 EMBER_SELF)
  // and `this.*` / `@arg.*` member segments go through the property-tag tap
  // (G8 EMBER_PROPERTY_TAGS).
  if (ctx.flags.EMBER_SELF || ctx.flags.EMBER_PROPERTY_TAGS) {
    const emberPath = buildEmberHeadPath(ctx, value);
    if (emberPath !== null) {
      return wrapInGetter ? B.reactiveGetter(emberPath, value.sourceRange) : emberPath;
    }
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
  ctx: CompilerContext,
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
    // Rename the root segment when it is a reserved-word block/let param, so a
    // bare `{{if}}` reference emits `__bp_if` (matching the declaration site)
    // instead of the SyntaxError `if`. The rest of the path is preserved.
    const rootSeg = resolved.split(/[?.[]/)[0];
    const emittedRoot = emitBindingRootName(ctx, rootSeg);
    if (emittedRoot !== rootSeg) {
      return B.runtimeRef(emittedRoot + resolved.slice(rootSeg.length), value.sourceRange);
    }
    return B.runtimeRef(resolved, value.sourceRange);
  }

  let expr: JSExpression;
  let startIndex: number;
  let optionalStartIndex: number;
  let mappingStartIndex: number;

  if (value.isArg) {
    // Ground-truth signal for the preamble injector: an @-arg read is emitted
    // as `$a` + member(s) (dot OR bracket), so the `const $a = this[$args]`
    // local is required. The bracket form (`$a["foo-bar"]`, built below) is the
    // case the old `code.includes('$a.')` scan false-negatived.
    ctx.usedArgsAlias = true;
    expr = B.runtimeRef(SYMBOLS.ARGS_ALIAS, rootRange ?? value.sourceRange);
    startIndex = 0;
    optionalStartIndex = 1;
    // Always map the first arg segment (e.g., @user.name -> map "user")
    mappingStartIndex = 0;
  } else {
    const rootName = parts[0] ?? resolved.split('.')[0] ?? resolved;
    expr = B.runtimeRef(emitBindingRootName(ctx, rootName), rootRange ?? value.sourceRange);
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
  if (!binding) return null;
  // EMBER_PROPERTY_TAGS (G8): `{{#let}}` aliases are block params in Glimmer —
  // their member reads are property reads too.
  const tappable =
    binding.kind === 'block-param' ||
    (binding.kind === 'let-binding' && ctx.flags.EMBER_PROPERTY_TAGS === true);
  if (!tappable) return null;
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
    binding.emitName ?? escapeBindingName(head),
    segs[0].range ?? value.rootRange ?? value.sourceRange
  );
  // EMBER_NATIVE: the non-defining tap (never installs an own accessor that
  // would shadow a host `@tracked` prototype accessor).
  const tapSymbol =
    ctx.flags.EMBER_NATIVE || ctx.flags.EMBER_PROPERTY_TAGS ? SYMBOLS.TAG_TAP : SYMBOLS.CELL_FOR;
  for (let i = 1; i < segs.length; i++) {
    expr = B.call(
      tapSymbol,
      [expr, B.string(segs[i].name, segs[i].range)],
      value.sourceRange
    );
  }
  return expr;
}

/**
 * EMBER_SELF (G6): the emitted name of a `this` path head — the self alias `$s`
 * (declared by the template wrapper as `const $s = $_self(this)`) under the
 * flag, else `this`. Records the ground-truth `usedSelf` preamble flag.
 */
export function selfRootName(ctx: CompilerContext): string {
  if (ctx.flags.EMBER_SELF) {
    ctx.usedSelf = true;
    return SYMBOLS.SELF_ALIAS;
  }
  return 'this';
}

/**
 * EMBER_SELF (G6): rewrite a `this`-headed callee / tag string (`this.helper`,
 * `this.foo.Bar`, `this["x"]`) to read the self alias. Any other string is
 * returned unchanged; with the flag off the input is always returned as-is.
 */
export function selfHeadedName(ctx: CompilerContext, name: string): string {
  if (!ctx.flags.EMBER_SELF) return name;
  if (name === 'this') return selfRootName(ctx);
  if (name.startsWith('this.') || name.startsWith('this[') || name.startsWith('this?.')) {
    return selfRootName(ctx) + name.slice(4);
  }
  return name;
}

/**
 * Build `segments[startIndex…]` as member reads of `root`: under
 * EMBER_PROPERTY_TAGS each segment is the non-defining property-tag tap
 * `$__tag(obj, "key")` (Glimmer `getProp`: consumes the property tag through the
 * host `getProp` hook, returns the value; nullish-safe), otherwise a plain
 * member read (optional from the second member on, like buildPathBase).
 */
function buildEmberMemberChain(
  ctx: CompilerContext,
  root: JSExpression,
  segments: ReadonlyArray<{ name: string; range?: SourceRange }>,
  startIndex: number,
  sourceRange: SourceRange | undefined
): JSExpression {
  let expr = root;
  for (let i = startIndex; i < segments.length; i++) {
    const { name, range } = segments[i];
    if (ctx.flags.EMBER_PROPERTY_TAGS) {
      expr = B.call(SYMBOLS.TAG_TAP, [expr, B.string(name, range)], sourceRange);
      continue;
    }
    const useOptional = i > startIndex;
    if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
      expr = B.computedMember(expr, B.string(name, range), undefined, useOptional);
    } else {
      expr = useOptional
        ? B.optionalMember(expr, name, undefined, range)
        : B.member(expr, name, undefined, range);
    }
  }
  return expr;
}

/**
 * Ember native layer: a path whose head is `this` (G6 self alias + G8 taps)
 * or an `@arg` with member segments (G8 taps after the arg read — the arg
 * itself is already reactive through gxt's args). Returns null for paths this
 * does not own (block params, let-bindings, scope bindings, a bare `@arg`).
 */
function buildEmberHeadPath(ctx: CompilerContext, value: PathValue): JSExpression | null {
  const expression = value.expression;
  if (value.isArg) {
    if (!ctx.flags.EMBER_PROPERTY_TAGS) return null;
    const segs = value.parts && value.parts.length > 0
      ? value.parts.map((p) => ({ name: p.name, range: p.range }))
      : null;
    if (segs === null || segs.length < 2) return null;
    ctx.usedArgsAlias = true;
    const argName = segs[0].name;
    const alias = B.runtimeRef(SYMBOLS.ARGS_ALIAS, value.rootRange ?? value.sourceRange);
    const argRead = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName)
      ? B.member(alias, argName, undefined, segs[0].range)
      : B.computedMember(alias, B.string(argName, segs[0].range), undefined, false);
    return buildEmberMemberChain(ctx, argRead, segs, 1, value.sourceRange);
  }
  const isThis =
    expression === 'this' ||
    expression.startsWith('this.') ||
    expression.startsWith('this?.') ||
    expression.startsWith('this[');
  if (!isThis) return null;
  const segs = getPathSegments(value);
  if (segs === null || segs[0].name !== 'this' || segs.some((seg) => seg.name.length === 0)) {
    // A shape the segment builder does not own (bracket access): the plain
    // path, with the head read from the self alias.
    if (!ctx.flags.EMBER_SELF) return null;
    return B.runtimeRef(selfHeadedName(ctx, toSafeJSPath(expression)), value.sourceRange);
  }
  const root = B.runtimeRef(selfRootName(ctx), segs[0].range ?? value.rootRange ?? value.sourceRange);
  return buildEmberMemberChain(ctx, root, segs, 1, value.sourceRange);
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
 * Build a concat expression.
 *
 * Default emission: `[part1, part2, ...].join('')` — plain string coercion.
 * Parts use direct references (no reactive getter) since the outer getter
 * handles reactivity; the parts are read (and their reactive deps tracked)
 * while the array literal is built, exactly as `.join('')` consumed them.
 *
 * Under the `EMBER_ATTR_CONCAT` flag: `$_qStr([part1, part2, ...])` — a runtime
 * helper that applies Ember/Glimmer string-coercion semantics per part
 * (null/undefined → '', Symbol via String(), object-without-toString → '') and
 * returns `null` when every dynamic part is nullish so the attribute writer
 * drops the attribute instead of writing `"undefined"` or an empty string.
 * The parts array is identical either way, so the only difference is the
 * consuming call.
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
  if (ctx.flags.EMBER_ATTR_CONCAT) {
    return B.call(SYMBOLS.QUOTED_STR, [B.array(exprs)], sourceRange);
  }
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
  // Trusting mustache marker (`{{{expr}}}` under EMBER_TRUSTED_HTML): the
  // mustache visitor wrapped the normal (already getter-wrapped) inner value in
  // `helper(TRUSTED_HTML, [inner])`. Lower it to `$_html(() => inner, ctx)` —
  // the runtime raw-HTML node helper. `inner` is a getter SerializedValue, so
  // `buildValue` yields the `() => inner` thunk `$_html` expects; the second arg
  // is the render context (`ctxName`). SYMBOLS.HTML ($_html) lands in
  // emittedSymbols automatically at the serialize choke point.
  if (name === INTERNAL_HELPERS.TRUSTED_HTML) {
    const inner = positional[0];
    const innerExpr = inner ? buildValue(ctx, inner, ctxName) : B.string('', sourceRange);
    return B.call(SYMBOLS.HTML, [innerExpr, B.id(ctxName)], sourceRange);
  }
  // Ember `{{outlet}}` marker (EMBER_OUTLET, G3): `$_outlet(ctx)` renders the
  // host outlet component with the enclosing render context (`ctxName` — `this`
  // at template level, the block context inside a block) as its tree parent.
  if (name === INTERNAL_HELPERS.OUTLET) {
    return B.call(SYMBOLS.OUTLET, [B.id(ctxName)], sourceRange);
  }
  // Ember loose-mode ambiguous append (EMBER_LOOSE_COMPONENTS, G11):
  // `$_looseAppend("name", [args], {named}, ctx, site, optional)` with the
  // native literal-or-thunk argument convention (like `$_maybeHelper`) and the
  // call site's helper-site index (a helper resolution keys its instance on
  // (ctx, site)). positional[0] / [1] are the name and `optional` literals.
  if (name === INTERNAL_HELPERS.LOOSE_APPEND) {
    const [nameValue, optionalValue, ...args] = positional;
    const looseName = nameValue && nameValue.kind === 'literal' ? String(nameValue.value) : '';
    const optional = optionalValue !== undefined && optionalValue.kind === 'literal' && optionalValue.value === true;
    const posArgs = args.map(arg => buildNativeArg(ctx, arg, ctxName));
    const namedProps = [];
    for (const [key, val] of named) {
      namedProps.push(B.prop(key, buildNativeArg(ctx, val, ctxName), false, val.sourceRange));
    }
    return B.call(SYMBOLS.LOOSE_APPEND, [
      B.string(looseName, pathRange),
      B.array(posArgs),
      namedProps.length > 0 ? B.object(namedProps) : B.emptyObject(),
      B.id(ctxName),
      B.num(ctx.helperSiteCounter++),
      B.bool(optional),
    ], sourceRange);
  }
  // A trusting `style` attribute value (EMBER_NATIVE): `$_trustAttr(value)`,
  // read in place — the call already runs inside the attribute's getter.
  if (name === INTERNAL_HELPERS.TRUSTED_ATTR) {
    const value = positional[0];
    const valueExpr =
      value === undefined
        ? B.nil()
        : value.kind === 'path'
          ? buildPathExpression(ctx, value, false, ctxName)
          : value.kind === 'getter'
            ? buildValueNoGetter(ctx, value.value, ctxName)
            : buildValue(ctx, value, ctxName);
    return B.call(SYMBOLS.TRUST_ATTR, [valueExpr], sourceRange);
  }
  // `{{#each-in}}` iteration source (EMBER_NATIVE, G5): `$__eachIn(obj)`, or
  // `$__eachIn(obj, "key")` when the block has a non-identity `key=` option
  // (#21340 N21-N25) — `$__eachIn` resolves the key against each entry.
  if (name === INTERNAL_HELPERS.EACH_IN) {
    const source = positional[0];
    // Read in place: the call already runs inside the each's source getter.
    const sourceExpr =
      source === undefined
        ? B.nil()
        : source.kind === 'path'
          ? buildPathExpression(ctx, source, false, ctxName)
          : source.kind === 'getter'
            ? buildValueNoGetter(ctx, source.value, ctxName)
            : buildValue(ctx, source, ctxName);
    const keyArg = positional[1];
    if (keyArg !== undefined) {
      return B.call(SYMBOLS.EACH_IN, [sourceExpr, buildValue(ctx, keyArg, ctxName)], sourceRange);
    }
    return B.call(SYMBOLS.EACH_IN, [sourceExpr], sourceRange);
  }
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
    // @-arg used as a helper reference resolves through $a (dot or bracket),
    // so the `const $a = this[$args]` preamble local is required.
    ctx.usedArgsAlias = true;
    const argName = name.slice(1);
    // Use bracket notation for names with special characters (like hyphens)
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName);
    resolvedName = needsBracket
      ? `${SYMBOLS.ARGS_ALIAS}["${argName}"]`
      : `${SYMBOLS.ARGS_ALIAS}.${argName}`;
  } else {
    // EMBER_SELF (G6): a `this.helper` callee reads the template self; a
    // binding is referenced under the name it is declared under.
    resolvedName = emittedPathName(ctx, selfHeadedName(ctx, name));
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
  if (!isKnown) {
    recordLooseBuiltin(ctx, name);
  }

  // Compat-mode `{{unique-id}}` / `(unique-id)`: emit a stable per-(context,
  // call-site) id via the $_uid runtime helper instead of routing through
  // $_maybeHelper. Each source call-site gets a per-template site index
  // (ctx.uniqueIdCounter); the runtime keeps a WeakMap<ctx, string[]> so the id
  // is STABLE across re-renders of the same instance and DISTINCT across
  // instances and sibling sites. Both the mustache form (wrapped in a plain
  // getter by the caller) and the sub-expression form (e.g.
  // `{{#let (unique-id) as |id|}}`) reach here, so this single site replaces
  // the Ember bridge's `$_maybeHelper("unique-id",…)` → `unique_id()` → `_uid[N]`
  // positional rewrite AND its `uidOuterScope` pre-computed-array injection.
  // Skipped when a scope binding shadows `unique-id` (isKnown).
  if (name === 'unique-id' && !isKnown && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    const siteIndex = ctx.uniqueIdCounter++;
    return B.call(
      SYMBOLS.UNIQUE_ID,
      [B.id(ctxName), B.num(siteIndex)],
      sourceRange
    );
  }

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
        // unless(cond, true) -> if(cond, "", true). Ember (EMBER_NATIVE): the
        // missing branch is `undefined`, like the inline `if` without an inverse.
        const missing = ctx.flags.EMBER_NATIVE === true ? undefined : '';
        transformedPositional = [positional[0], { kind: 'literal', value: missing }, positional[1]];
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
    // Pass the emission report so the raw-embedded $_maybeHelper lands in
    // emittedSymbols (buildMaybeHelper already recorded the lookup name).
    const serialized = serializeJS(maybeHelperExpr, { report: ctx.emissionReport });
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
  const callee = pathRange ? B.id(name, pathRange, 'PathExpression', name) : name;

  // Ember native layer (G9): every curry argument — the definition included —
  // follows the literal-or-thunk convention; the runtime builds a curried
  // value whose arguments stay lazy until the curried value is invoked.
  if (ctx.flags.EMBER_NATIVE) {
    return buildNativeCurryCall(ctx, callee, positional, named, ctxName, sourceRange);
  }

  const posArgs = positional.map(arg => buildValue(ctx, arg, ctxName));

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
 * Ember native layer (G9): `$_componentHelper` / `$_helperHelper` /
 * `$_modifierHelper([definition, ...positional], {named})` with every argument
 * — the definition included — in the literal-or-thunk convention
 * (buildNativeArg). The runtime (EMBER_NATIVE) returns a curried value.
 */
function buildNativeCurryCall(
  ctx: CompilerContext,
  callee: string | JSExpression,
  positional: readonly SerializedValue[],
  named: ReadonlyMap<string, SerializedValue>,
  ctxName: string,
  sourceRange?: SourceRange
): JSExpression {
  const posArgs = positional.map(arg => buildNativeArg(ctx, arg, ctxName));
  const props = [];
  for (const [key, val] of named) {
    props.push(B.prop(key, buildNativeArg(ctx, val, ctxName), false, val.sourceRange));
  }
  const namedObj = props.length > 0 ? B.object(props) : B.emptyObject();
  // The render context (3rd argument): the curried value keeps it so a
  // curried HELPER rendered without arguments (`{{helper "name"}}`, `{{h}}`)
  // reaches the host helper manager with its owner (a by-name definition).
  return B.call(callee, [B.array(posArgs), namedObj, B.id(ctxName)], sourceRange);
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
  // Ember native layer (G4): literal-or-thunk arguments (buildNativeArg).
  const native = ctx.flags.EMBER_NATIVE === true;
  const buildArg = native ? buildNativeArg : buildValue;
  const posArgs = positional.map(arg => buildArg(ctx, arg, ctxName));

  // Build named args
  const namedProps = [];
  for (const [key, val] of named) {
    namedProps.push(B.prop(key, buildArg(ctx, val, ctxName), false, val.sourceRange));
  }

  // For unknown bindings, context is passed directly as last arg
  // $_maybeHelper accesses ctx.$_eval and ctx[$args].$_scope directly
  // This avoids creating closure functions on every reactive update

  // For known bindings, pass the function reference; for unknown, pass string name.
  // Ground-truth: only the string-form (unresolved) lookup contributes its name
  // to maybeHelperNames — a resolved reference passes a function, not a string.
  const helperRef = resolvedRef
    ? B.id(resolvedRef, nameRange, 'PathExpression', name)
    : B.string(name, nameRange);
  if (!resolvedRef) {
    ctx.emissionReport.maybeHelperNames.add(name);
    if (ctx.strictMode) {
      // Glimmer strict mode: no resolver — a free name is not in scope.
      addError(
        ctx,
        `Attempted to resolve a helper in a strict mode template, but that value was not in scope: ${name}`,
        'E002',
        nameRange ?? sourceRange
      );
    }
  }

  // Ember native layer (G4): one uniform 5-argument shape for known AND
  // unknown helpers — `$_maybeHelper(ref, [args], {named}, ctx, site)`. `ctx`
  // is the enclosing render context (the host reads its owner from it; a
  // per-call-site helper instance lives — and is destroyed — with it) and
  // `site` the per-template call-site index: (ctx, site) identifies one call
  // site INSTANCE, exactly the lifetime of a Glimmer helper reference (one
  // helper per call site per block instance, destroyed with the block). Like
  // `$_uid(ctx, N)`, a per-compilation index is enough — the ctx key keeps
  // templates / instances apart.
  // EMBER_ARG_LABELS: the source paths of the arguments, after the context
  // and the call-site index (`undefined` where the call has none).
  const labels = buildArgLabels(ctx, positional, named);
  if (native) {
    const namedObj = namedProps.length > 0 ? B.object(namedProps) : B.emptyObject();
    const nativeArgs: JSExpression[] = [
      helperRef,
      B.array(posArgs),
      namedObj,
      B.id(ctxName),
      B.num(ctx.helperSiteCounter++),
    ];
    if (labels !== null) nativeArgs.push(labels);
    return B.call(SYMBOLS.MAYBE_HELPER, nativeArgs, sourceRange);
  }

  if (labels !== null) {
    // One shape for known and unknown helpers: `(ref, [args], {named}, ctx,
    // undefined, labels)`. A known binding passes no context, as without
    // labels; the host reads the hash from the 3rd argument when there are 4
    // or more.
    return B.call(SYMBOLS.MAYBE_HELPER, [
      helperRef,
      B.array(posArgs),
      namedProps.length > 0 ? B.object(namedProps) : B.emptyObject(),
      resolvedRef ? B.undef() : B.id(ctxName),
      B.undef(),
      labels,
    ], sourceRange);
  }

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
    // Emits a free `$slots` reference (`.bind(ctx, $slots)`) → the
    // `const $slots = $_GET_SLOTS(...)` preamble local is required.
    ctx.usedSlots = true;
    const bindTarget = typeof helperId === 'string' ? B.id(helperId) : helperId;
    const bindCall = B.methodCall(bindTarget, 'bind', [B.id(ctxName), B.id('$slots')], sourceRange);
    return B.call(bindCall, args, sourceRange);
  }

  // Special handling for debugger - prepend this and use .call
  if (symbol === SYMBOLS.DEBUGGER) {
    const callArgs = [B.id(ctxName), ...args];
    // Ember (compat and native): `{{debugger}}` passes the scope it can
    // inspect (`buildDebuggerScope`).
    if (ctx.flags.WITH_EMBER_INTEGRATION === true && args.length === 0) {
      callArgs.push(buildDebuggerScope(ctx, ctxName, sourceRange));
    }
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
    if (ctx.flags.EMBER_NATIVE) {
      return buildNativeCurryCall(ctx, helperId, positional, named, ctxName, sourceRange);
    }
    const posArgs = positional.map(arg => buildValue(ctx, arg, ctxName));
    const namedObj = buildNamedArgsObject(ctx, named, ctxName);
    return B.call(helperId, [B.array(posArgs), namedObj], sourceRange);
  }

  return B.call(helperId, args, sourceRange);
}

/**
 * Ember `{{debugger}}`: the scope a debugger callback inspects, read lazily —
 * `{ self: () => <template self>, locals: { name: () => <read>, … },
 * args: () => $a }`. `self` is the template's self (compat: the template's
 * `this`, native: `$s`), not the block render context the call runs on;
 * `locals` are the block params and `{{#let}}` bindings visible at the
 * statement (inner ones shadow outer ones), read as the template reads them;
 * `args` is the component's named arguments (`get('@name')`). The runtime
 * resolves a debugger `get(path)` over them (helpers/debugger.ts).
 */
function buildDebuggerScope(
  ctx: CompilerContext,
  ctxName: string,
  sourceRange?: SourceRange
): JSExpression {
  const locals = [];
  for (const [name, info] of ctx.scopeTracker.getAllBindings()) {
    if (info.kind !== 'block-param' && info.kind !== 'let-binding') continue;
    if (name.startsWith('$')) continue;
    const read = buildPathExpression(ctx, path(name, false, sourceRange), false, ctxName);
    locals.push(B.prop(name, B.arrow([], read)));
  }
  ctx.usedArgsAlias = true;
  return B.object([
    B.prop('self', B.arrow([], B.runtimeRef(selfRootName(ctx), sourceRange))),
    B.prop('locals', locals.length > 0 ? B.object(locals) : B.emptyObject()),
    B.prop('args', B.arrow([], B.runtimeRef(SYMBOLS.ARGS_ALIAS, sourceRange))),
  ]);
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
