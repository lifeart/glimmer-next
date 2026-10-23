/**
 * Block Statement Visitor
 *
 * Handles block statements like {{#if}}, {{#each}}, {{#let}}.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext, VisitFn } from '../context';
import type { SerializedValue, HBSControlExpression, HBSChild, HBSNode, AttributeTuple, SourceRange, LetBinding, InElementMode } from '../types';
import { literal, getter, helper, isSerializedValue, isHBSNode } from '../types';
import { INTERNAL_HELPERS } from '../serializers/symbols';
import { getNodeRange, serializeValueToString, getBlockParamRanges, getPathExpressionString } from './utils';
import { addWarning } from '../context';
import { isLooseBlockComponent } from './loose';

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
 * Get the visitChildren function from context.
 * Requires ctx.visitors to be initialized via initializeVisitors().
 */
function getVisitChildren(ctx: CompilerContext): (ctx: CompilerContext, children: ASTv1.Statement[]) => HBSChild[] {
  if (ctx.visitors?.visitChildren) {
    return ctx.visitors.visitChildren;
  }
  throw new Error('No visitChildren function available. Call initializeVisitors first.');
}

/**
 * Built-in block keywords that should NOT be treated as component invocations.
 */
const BUILTIN_BLOCK_KEYWORDS = new Set([
  'if',
  'each',
  'unless',
  'let',
  'in-element',
]);

/**
 * Check if a block statement is a component invocation.
 * A block is a component invocation when the name is either a known binding
 * (including user-provided scope bindings that shadow built-in keywords) or
 * contains a dot (path-based component).
 *
 * Note: a user binding that SHADOWS a built-in keyword (e.g.
 * `renderComponent(tpl, { scope: { if: Component } })`) wins over the
 * built-in. Only fall back to the built-in resolution if there is no
 * binding in scope for the name.
 */
function isComponentBlock(ctx: CompilerContext, node: ASTv1.BlockStatement): boolean {
  if (node.path.type !== 'PathExpression') return false;
  const name = getPathExpressionString(node.path);
  // Scope-value / lexical-scope bindings shadow built-in keywords.
  // Check bindings BEFORE the built-in keyword list so that
  // `{{#if}}` resolves to the user-provided `if` component when present.
  if (ctx.scopeTracker.hasBinding(name)) return true;
  if (BUILTIN_BLOCK_KEYWORDS.has(name)) return false;
  // `{{#each-in}}` is a keyword in the Ember native layer (G5).
  if (name === 'each-in' && ctx.flags.EMBER_NATIVE === true) return false;
  // Dotted path
  if (name.includes('.')) return true;
  // In compat mode, hyphenated names are component invocations (Ember convention).
  // E.g., {{#foo-bar}}...{{/foo-bar}} is a component block.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && name.includes('-')) return true;
  return false;
}

/**
 * Convert a block-mode component invocation to an HBSNode.
 * This reuses the existing angle-bracket component serialization pipeline.
 */
function convertComponentBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  range?: SourceRange,
  // Ember loose mode (G11): the block name is a component the host resolves
  // BY NAME (`$_c("foo-bar", …)`) — no compat PascalCase / synthetic binding.
  byName = false
): HBSNode {
  // isComponentBlock already verified node.path.type === 'PathExpression'
  const pathExpr = node.path as ASTv1.PathExpression;
  const rawTag = getPathExpressionString(pathExpr);
  const tagRange = getNodeRange(pathExpr);

  // In compat mode, convert hyphenated block names to PascalCase so the
  // serializer recognizes them as component-like tags (via isLikelyComponent).
  // E.g., {{#foo-bar}} → tag 'FooBar', matching how inline curlies work.
  // The node is marked as a component invoked by name (`compatComponent`), so
  // the serializer emits `$_c('FooBar', …)` with its block as a slot (block
  // params bound) at any depth. A scope binding would reach codegen only from
  // the root scope — a curly block inside an element or another block became
  // a `$_tag('FooBar', …)` element whose block params were dropped — and would
  // turn every `<FooBar>` element of the template into a component.
  const compatCurly = !byName && ctx.flags.IS_GLIMMER_COMPAT_MODE && rawTag.includes('-');
  const tag = compatCurly ? toPascalCase(rawTag) : rawTag;
  const compatComponent = compatCurly && !ctx.scopeTracker.hasBinding(tag);

  // Convert hash pairs to @-prefixed attribute tuples
  const attributes: AttributeTuple[] = node.hash.pairs.map((pair) => {
    const value = getVisit(ctx)(ctx, pair.value, false);
    const serializedValue = value !== null && isSerializedValue(value) ? value : literal(null);
    return [`@${pair.key}`, serializedValue] as const;
  });

  // Forward positional params as @__pos0__, @__pos1__, etc. when:
  //   a) Compat mode + hyphenated curly component (Ember convention), OR
  //   b) The block name is a built-in keyword shadowed by a user scope
  //      binding (e.g. `{{#if some.thing}}` where `if` is in scope). The
  //      condition/item/etc. would otherwise be silently dropped.
  const isShadowedKeyword = BUILTIN_BLOCK_KEYWORDS.has(rawTag);
  const forwardPositional = !byName && (compatCurly || isShadowedKeyword);
  if (forwardPositional && node.params.length > 0) {
    for (let i = 0; i < node.params.length; i++) {
      const param = node.params[i];
      const value = getVisit(ctx)(ctx, param, false);
      if (value !== null && isSerializedValue(value)) {
        attributes.push([`@__pos${i}__`, getter(value, range)]);
      }
    }
    attributes.push(['@__posCount__', literal(node.params.length)]);
  } else if (node.params.length > 0) {
    addWarning(
      ctx,
      `Positional parameters are not supported on component block "{{#${tag}}}" and will be ignored`,
      'W005'
    );
  }

  // Add block params to scope before visiting children.
  // Enter a new scope frame so that inner blocks using the same block-param
  // name do not permanently clobber an outer block's binding (e.g. nested
  // `{{#each ... as |x|}}{{#each ... as |x|}}...{{/each}}{{x}}{{/each}}`).
  const blockParams = node.program.blockParams;
  const blockParamRanges = getBlockParamRanges(node);
  ctx.scopeTracker.enterScope('component-block');
  for (const param of blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Visit children (default block body)
  const defaultChildren = getVisitChildren(ctx)(ctx, node.program.body);

  // Exit the default-block scope, restoring any shadowed outer bindings.
  ctx.scopeTracker.exitScope();

  // Visit inverse ({{else}} branch) if present. The inverse block has its own
  // (usually empty) block params; we emit it as a synthesized `:inverse` named
  // slot so the runtime sees `slots.inverse` and `(has-block 'inverse')` works.
  let inverseSlotNode: HBSNode | null = null;
  if (node.inverse?.body) {
    const inverseBlockParams = node.inverse.blockParams ?? [];
    ctx.scopeTracker.enterScope('component-inverse');
    for (const param of inverseBlockParams) {
      warnOnReservedBinding(ctx, param);
      ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
    }
    const inverseChildren = getVisitChildren(ctx)(ctx, node.inverse.body);
    ctx.scopeTracker.exitScope();
    inverseSlotNode = {
      _nodeType: 'element',
      tag: ':inverse',
      attributes: [],
      properties: [],
      events: [],
      children: inverseChildren,
      blockParams: inverseBlockParams,
      blockParamRanges: undefined,
      selfClosing: false,
      hasStableChild: inverseChildren.some(
        (child) => typeof child === 'string' || isHBSNode(child)
      ),
    };
  }

  // If we have an inverse slot, wrap the default children in a synthesized
  // `:default` named slot so buildSlots (which emits ONLY named slots when any
  // exist) still receives the default block body.
  let children: HBSChild[];
  if (inverseSlotNode) {
    const defaultSlotNode: HBSNode = {
      _nodeType: 'element',
      tag: ':default',
      attributes: [],
      properties: [],
      events: [],
      children: defaultChildren,
      blockParams,
      blockParamRanges: blockParamRanges ?? undefined,
      selfClosing: false,
      hasStableChild: defaultChildren.some(
        (child) => typeof child === 'string' || isHBSNode(child)
      ),
    };
    children = [defaultSlotNode, inverseSlotNode];
  } else {
    children = defaultChildren;
  }

  // Check for stable children (text or element nodes)
  const hasStable = children.some(
    (child) => typeof child === 'string' || isHBSNode(child)
  );

  return {
    _nodeType: 'element',
    tag,
    attributes,
    properties: [],
    events: [],
    children,
    blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    selfClosing: false,
    hasStableChild: hasStable,
    sourceRange: range,
    tagRange,
    ...(byName ? { byName: true } : {}),
    ...(compatComponent ? { compatComponent: true } : {}),
  };
}

/**
 * Convert kebab-case to PascalCase.
 */
function toPascalCase(name: string): string {
  return name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/**
 * Convert {{#component "name" arg=val}}...{{/component}} block to an HBSNode.
 *
 * First param is the component name (string literal or path expression).
 * Hash pairs become @-prefixed attributes.
 * Block body becomes children.
 */
function convertComponentHelperBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  range?: SourceRange
): HBSNode | null {
  const firstParam = node.params[0];
  let tag: string;
  // Ember loose mode (G11): `{{#component "foo-bar"}}` resolves `foo-bar` by
  // name through the host (`$_c("foo-bar", …)`).
  const byName = ctx.looseMode && firstParam.type === 'StringLiteral';

  if (byName) {
    tag = (firstParam as ASTv1.StringLiteral).value;
  } else if (firstParam.type === 'StringLiteral') {
    tag = toPascalCase(firstParam.value);
  } else if (firstParam.type === 'PathExpression') {
    tag = getPathExpressionString(firstParam);
  } else {
    return null;
  }

  // Convert hash pairs to @-prefixed attributes
  const attributes: AttributeTuple[] = node.hash.pairs.map((pair) => {
    const value = getVisit(ctx)(ctx, pair.value, false);
    const serializedValue = value !== null && isSerializedValue(value) ? value : literal(null);
    return [`@${pair.key}`, getter(serializedValue, range)] as const;
  });

  // Remaining positional params (after the component name)
  const positionalParams = byName ? [] : node.params.slice(1);
  if (byName && node.params.length > 1) {
    addWarning(
      ctx,
      `Positional parameters are not supported on component block "{{#component "${tag}"}}" and will be ignored`,
      'W005'
    );
  }
  for (let i = 0; i < positionalParams.length; i++) {
    const param = positionalParams[i];
    const value = getVisit(ctx)(ctx, param, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@__pos${i}__`, getter(value, range)]);
    }
  }
  if (positionalParams.length > 0) {
    attributes.push(['@__posCount__', literal(positionalParams.length)]);
  }

  // Add block params to scope before visiting children.
  // Use a dedicated scope frame so nested blocks with matching names shadow
  // instead of overwriting the parent's binding.
  const blockParams = node.program.blockParams;
  const blockParamRanges = getBlockParamRanges(node);
  ctx.scopeTracker.enterScope('component-helper-block');
  for (const param of blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Visit children
  const children = getVisitChildren(ctx)(ctx, node.program.body);

  // Exit block scope, restoring outer bindings.
  ctx.scopeTracker.exitScope();

  const hasStable = children.some(
    (child) => typeof child === 'string' || isHBSNode(child)
  );

  return {
    _nodeType: 'element',
    tag,
    attributes,
    properties: [],
    events: [],
    children,
    blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    selfClosing: false,
    hasStableChild: hasStable,
    sourceRange: range,
    ...(byName ? { byName: true } : {}),
  };
}

/**
 * Visit a BlockStatement node.
 *
 * @param ctx - The compiler context
 * @param node - The BlockStatement to visit
 */
export function visitBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement
): HBSControlExpression | SerializedValue | HBSNode | null {
  const range = getNodeRange(node);

  // Ember loose mode (G11): `{{#foo-bar …}}…{{/foo-bar}}` with no lexical
  // binding for `foo-bar` is a component resolved by name (Glimmer's block
  // syntax context), whatever its spelling.
  if (
    node.path.type === 'PathExpression' &&
    isLooseBlockComponent(
      ctx,
      getPathExpressionString(node.path),
      node.path.head.type === 'VarHead' && node.path.tail.length === 0
    )
  ) {
    return convertComponentBlock(ctx, node, range, true);
  }

  // Detect component block invocations before checking params
  if (isComponentBlock(ctx, node)) {
    return convertComponentBlock(ctx, node, range);
  }

  // In compat mode, handle {{#component "name" ...}}...{{/component}} block form
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && node.path.type === 'PathExpression') {
    const pathName = getPathExpressionString(node.path);
    if (pathName === 'component' && node.params.length > 0) {
      return convertComponentHelperBlock(ctx, node, range);
    }
  }

  // Blocks must have at least one param
  if (!node.params.length) {
    return null;
  }

  // Must have a path expression
  if (node.path.type !== 'PathExpression') {
    return null;
  }

  const name = getPathExpressionString(node.path);

  // Let blocks manage their own scope and children because they need
  // to visit binding values BEFORE adding block params to scope, and
  // the bindings use 'let-binding' kind (not 'block-param').
  if (name === 'let') {
    return createLetBlock(ctx, node, range);
  }

  // Add block params to a fresh scope frame so nested blocks using the same
  // block-param name (e.g. `{{#each ... as |x|}}{{#each ... as |x|}}`) shadow
  // rather than clobber the outer binding. Exiting the scope cleanly restores
  // any binding the inner block shadowed — this is what makes post-inner-close
  // references read the outer scope instead of falling back to a literal lookup.
  const blockParams = node.program.blockParams;
  const blockParamRanges = getBlockParamRanges(node);
  ctx.scopeTracker.enterScope(name);
  for (const param of blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Get children
  const childElements = getVisitChildren(ctx)(ctx, node.program.body);

  // Exit the default-block scope.
  ctx.scopeTracker.exitScope();

  // Visit the inverse ({{else}}) body in its own scope frame so its (usually
  // empty) block params do not leak — and so any same-named inner block params
  // shadow rather than overwrite.
  let inverseElements: HBSChild[] | null = null;
  if (node.inverse?.body) {
    const inverseBlockParams = node.inverse.blockParams ?? [];
    ctx.scopeTracker.enterScope(`${name}-inverse`);
    for (const param of inverseBlockParams) {
      warnOnReservedBinding(ctx, param);
      ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
    }
    inverseElements = getVisitChildren(ctx)(ctx, node.inverse.body);
    ctx.scopeTracker.exitScope();
  }

  // Empty block - skip (unless there's an inverse/else branch). Ember: Glimmer
  // evaluates a conditional's condition and an iteration's collection even when
  // the block renders nothing, so an empty `{{#if (foo)}}{{/if}}` still calls
  // `foo` (and asserts that it is a helper); such a block is kept.
  if (!childElements.length && !inverseElements?.length) {
    if (!(ctx.flags.WITH_EMBER_INTEGRATION && evaluatesCallParam(name, node))) {
      return null;
    }
  }

  // Extract key and sync options
  const { keyValue, syncValue } = extractBlockOptions(ctx, node);

  // Handle specific block types
  switch (name) {
    case 'in-element':
      return createInElementBlock(ctx, node, childElements, range);

    case 'unless':
      return createUnlessBlock(
        ctx,
        node,
        childElements,
        inverseElements,
        blockParams,
        blockParamRanges,
        keyValue,
        syncValue,
        range
      );

    case 'each-in':
      if (ctx.flags.EMBER_NATIVE === true) {
        return createEachInBlock(
          ctx,
          node,
          childElements,
          inverseElements,
          blockParams,
          keyValue,
          range
        );
      }
      return createControlBlock(
        ctx,
        node,
        name,
        childElements,
        inverseElements,
        blockParams,
        blockParamRanges,
        keyValue,
        syncValue,
        range
      );

    case 'if':
    case 'each':
    default:
      return createControlBlock(
        ctx,
        node,
        name,
        childElements,
        inverseElements,
        blockParams,
        blockParamRanges,
        keyValue,
        syncValue,
        range
      );
  }
}

// The blocks whose first param Glimmer evaluates to render them: a
// conditional's condition, an iteration's collection.
const EVALUATED_PARAM_BLOCKS = new Set(['if', 'unless', 'each', 'each-in']);

/**
 * Whether rendering the block `name` evaluates a param that calls something
 * (a sub-expression: a helper call), which an empty block must still do.
 */
function evaluatesCallParam(name: string, node: ASTv1.BlockStatement): boolean {
  if (!EVALUATED_PARAM_BLOCKS.has(name)) return false;
  return node.params.length > 0 && node.params[0]!.type === 'SubExpression';
}

/**
 * Warn on reserved JavaScript/browser binding names.
 */
function warnOnReservedBinding(ctx: CompilerContext, name: string): void {
  const reserved = [
    'window',
    'document',
    'console',
    'this',
    'arguments',
    'eval',
    'undefined',
    'null',
    'true',
    'false',
  ];

  if (reserved.includes(name)) {
    addWarning(
      ctx,
      `"${name}" is a reserved name and may cause unexpected behavior`,
      'W002'
    );
  }
}

/**
 * Extract key and sync options from block hash.
 */
function extractBlockOptions(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement
): { keyValue: string | null; syncValue: boolean } {
  let keyValue: string | null = null;
  let syncValue = false;

  const keyPair = node.hash.pairs.find((p) => p.key === 'key');
  const syncPair = node.hash.pairs.find((p) => p.key === 'sync');

  if (keyPair) {
    if (keyPair.value.type === 'StringLiteral') {
      keyValue = keyPair.value.original;
    } else {
      const result = getVisit(ctx)(ctx, keyPair.value, false);
      if (result !== null && isSerializedValue(result)) {
        keyValue = serializeValueToString(result, ctx);
      }
    }
  }

  if (syncPair) {
    if (syncPair.value.type === 'BooleanLiteral') {
      syncValue = syncPair.value.value;
    } else {
      const result = getVisit(ctx)(ctx, syncPair.value, false);
      if (result !== null && typeof result === 'boolean') {
        syncValue = result;
      }
    }
  }

  return { keyValue, syncValue };
}

/**
 * Create an in-element control block.
 */
function createInElementBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  children: HBSChild[],
  range?: SourceRange
): HBSControlExpression {
  // Use wrap=true for conditions to enable reactivity
  const condition = getVisit(ctx)(ctx, node.params[0], true);

  // Ember-dialect insertBefore semantics (opt-in). Off → historic 3-arg call.
  const inElementMode = ctx.flags.EMBER_IN_ELEMENT
    ? parseInElementMode(node)
    : undefined;

  return {
    _nodeType: 'control',
    type: 'in-element',
    condition: condition !== null && isSerializedValue(condition)
      ? condition
      : literal(null),
    blockParams: [],
    children,
    inverse: null,
    key: null,
    isSync: true,
    sourceRange: range,
    ...(inElementMode ? { inElementMode } : {}),
  };
}

/**
 * Map the `{{#in-element dest insertBefore=…}}` hash to a render mode
 * (EMBER_IN_ELEMENT). Mirrors Glimmer/Ember: no `insertBefore` (or the explicit
 * `undefined`) clears the target; `null` appends; any other value is
 * unsupported and carries its source text for a runtime dev-assertion.
 */
function parseInElementMode(node: ASTv1.BlockStatement): InElementMode {
  const pair = node.hash.pairs.find((p) => p.key === 'insertBefore');
  if (!pair) {
    return { kind: 'clear' };
  }
  const value = pair.value;
  if (value.type === 'NullLiteral') {
    return { kind: 'append' };
  }
  if (value.type === 'UndefinedLiteral') {
    return { kind: 'clear' };
  }
  // Some Handlebars parses surface a bare `undefined` as a local path head.
  if (value.type === 'PathExpression' && getPathExpressionString(value) === 'undefined') {
    return { kind: 'clear' };
  }
  return { kind: 'unsupported', received: describeInsertBeforeValue(value) };
}

/**
 * A readable rendering of an unsupported `insertBefore=` value for the runtime
 * assertion message (`Can only pass null to insertBefore …, received: <x>`).
 */
function describeInsertBeforeValue(value: ASTv1.Expression): string {
  switch (value.type) {
    case 'StringLiteral':
      return value.value;
    case 'NumberLiteral':
    case 'BooleanLiteral':
      return String(value.value);
    case 'PathExpression':
      return getPathExpressionString(value);
    default:
      return value.type;
  }
}

/**
 * Ember `{{#each-in obj as |key value|}}…{{else}}…{{/each-in}}` (G5, the Ember
 * native layer): an `each` over `$__eachIn(obj)` — the object's entries as
 * STABLE `[key, value]` pairs (Glimmer `@identity` keying: a row is kept while
 * its key's value is unchanged) — whose row callback destructures each pair
 * into the block params. Children were visited with `key` / `value` in scope
 * as plain block params.
 */
function createEachInBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  children: HBSChild[],
  inverse: HBSChild[] | null,
  blockParams: string[],
  keyValue: string | null,
  range?: SourceRange
): HBSControlExpression {
  const source = getVisit(ctx)(ctx, node.params[0], false);
  const sourceValue = source !== null && isSerializedValue(source) ? source : literal(null);
  // Forward the `key=` option to `$__eachIn` so it owns the keying (resolving
  // `@key`/`@index`/path keys against the ENTRY, not the `[key,value]` pair —
  // ember.js#21340 N21-N25). The lowered `each` then keys by `@identity` on the
  // returned pairs. `@identity`/default stays a 1-arg `$__eachIn(obj)` (the
  // historic shape); only a non-identity key adds the 2nd argument.
  const eachInArgs: SerializedValue[] = [sourceValue];
  if (keyValue != null && keyValue !== '@identity') {
    eachInArgs.push(literal(keyValue));
  }
  return {
    _nodeType: 'control',
    type: 'each',
    condition: getter(helper(INTERNAL_HELPERS.EACH_IN, eachInArgs, new Map(), range), range),
    blockParams: [],
    children,
    inverse,
    key: '@identity',
    isSync: true,
    sourceRange: range,
    eachInParams: blockParams.slice(0, 2),
  };
}

/**
 * Create an unless block (inverted if).
 */
function createUnlessBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  children: HBSChild[],
  inverse: HBSChild[] | null,
  blockParams: string[],
  blockParamRanges: SourceRange[] | null,
  keyValue: string | null,
  syncValue: boolean,
  range?: SourceRange
): HBSControlExpression {
  // Use wrap=true for conditions to enable reactivity
  const condition = getVisit(ctx)(ctx, node.params[0], true);

  // unless flips children and inverse
  return {
    _nodeType: 'control',
    type: 'if',
    condition: condition !== null && isSerializedValue(condition)
      ? condition
      : literal(null),
    blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    children: inverse ?? [],  // Flipped (default to empty array if null)
    inverse: children,  // Flipped
    key: keyValue,
    isSync: syncValue,
    sourceRange: range,
  };
}

/**
 * Create a let block (variable binding).
 *
 * Returns an HBSControlExpression with type 'let' and letBindings.
 * The serializer (buildLet in control.ts) handles code generation.
 */
function createLetBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  range?: SourceRange
): HBSControlExpression | null {
  const blockParams = node.program.blockParams;

  // Build let bindings: visit each param value BEFORE adding to scope
  const letBindings: LetBinding[] = node.params.map((p, index) => {
    const name = blockParams[index];
    const isPrimitive =
      p.type === 'StringLiteral' ||
      p.type === 'BooleanLiteral' ||
      p.type === 'NumberLiteral' ||
      p.type === 'NullLiteral' ||
      p.type === 'UndefinedLiteral';

    const paramValue = getVisit(ctx)(ctx, p, false);
    const value: SerializedValue =
      paramValue !== null && isSerializedValue(paramValue)
        ? paramValue
        : literal(null);

    return { name, value, isPrimitive };
  });

  // Add block params to scope as let-bindings for child resolution.
  // Use a dedicated scope frame so nested `{{#let}}` bindings with the same
  // name shadow, then cleanly restore, the outer binding.
  ctx.scopeTracker.enterScope('let');
  for (const param of blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'let-binding', name: param });
  }

  // Visit children with bindings in scope
  const children = getVisitChildren(ctx)(ctx, node.program.body);

  // Exit the let scope, restoring outer bindings.
  ctx.scopeTracker.exitScope();

  // Empty let block — skip
  if (!children.length) {
    return null;
  }

  return {
    _nodeType: 'control',
    type: 'let',
    condition: literal(null),
    blockParams,
    children,
    inverse: null,
    key: null,
    isSync: false,
    letBindings,
    sourceRange: range,
  };
}


/**
 * Create a general control block (if, each, etc.).
 */
function createControlBlock(
  ctx: CompilerContext,
  node: ASTv1.BlockStatement,
  name: string,
  children: HBSChild[],
  inverse: HBSChild[] | null,
  blockParams: string[],
  blockParamRanges: SourceRange[] | null,
  keyValue: string | null,
  syncValue: boolean,
  range?: SourceRange
): HBSControlExpression {
  // Use wrap=true for conditions to enable reactivity
  const condition = getVisit(ctx)(ctx, node.params[0], true);

  return {
    _nodeType: 'control',
    type: name as 'if' | 'each',
    condition: condition !== null && isSerializedValue(condition)
      ? condition
      : literal(null),
    blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    children,
    inverse,
    key: keyValue,
    isSync: syncValue,
    sourceRange: range,
  };
}
