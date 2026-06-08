/**
 * Mustache Statement Visitor
 *
 * Handles mustache expressions like {{foo}}, {{helper arg}}, {{yield}}.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext, VisitFn } from '../context';
import type { SerializedValue, HBSControlExpression, HBSNode, SourceRange } from '../types';
import { literal, path, helper, getter, raw, isSerializedValue } from '../types';
import { getNodeRange, resolvePath, serializeValueToString, getPathPartRanges, getPathExpressionString } from './utils';
import { INTERNAL_HELPERS } from '../serializers/symbols';

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
): SerializedValue | HBSControlExpression | HBSNode | null {
  const range = getNodeRange(node);

  // Handle non-path mustache (literal values, sub-expressions)
  if (node.path.type !== 'PathExpression') {
    return visitMustacheLiteral(ctx, node, wrap, range);
  }

  const pathName = getPathExpressionString(node.path);

  // In compat mode, transform {{mount "engine-name" model=expr}} to <ember-mount> element
  if (pathName === 'mount' && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    return createMountElement(ctx, node, range);
  }

  // In compat mode, transform {{component "name" arg=val}} or {{component this.xxx arg=val}}
  // to an HBSNode (angle-bracket component element).
  // Skip when the first param is a SubExpression (e.g., {{component (component "-looked-up") arg=val}})
  // — let it fall through to normal helper processing so $_componentHelper handles chaining.
  if (pathName === 'component' && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    const firstParam = node.params[0];
    if (firstParam && firstParam.type === 'SubExpression') {
      // Fall through to helper processing — $_componentHelper will handle the chained call
    } else {
      return createComponentElement(ctx, node, range);
    }
  }

  // In compat mode, transform {{mut (get obj key)}} → {{__mutGet obj key}}
  // This enables two-way binding with dynamic property paths.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && pathName === 'mut' && node.params.length === 1) {
    const firstParam = node.params[0];
    if (firstParam.type === 'SubExpression' && firstParam.path.type === 'PathExpression' && getPathExpressionString(firstParam.path) === 'get') {
      const mutGetPositional = firstParam.params.map((param) => {
        const result = getVisit(ctx)(ctx, param, false);
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

  // In compat mode, transform bare {{this}} to {{this.__gxtSelfString__}}
  // Ember's {{this}} calls toString() on the component instance.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && node.path.type === 'PathExpression') {
    const head = node.path.head;
    if (head.type === 'ThisHead' && node.path.tail.length === 0 && node.params.length === 0 && node.hash.pairs.length === 0) {
      const resolved = resolvePath(ctx, 'this.__gxtSelfString__');
      const pathRange = getNodeRange(node.path);
      return path(resolved, false, pathRange);
    }
  }

  // In compat mode, transform {{input ...}} / {{textarea ...}} to <Input /> / <Textarea />
  if ((pathName === 'input' || pathName === 'textarea') && ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    return createInputTextareaElement(ctx, node, pathName, range);
  }

  // In compat mode, transform inline curly components: {{foo-bar arg=val}} → HBSNode
  // Hyphenated names that are not built-in helpers or known bindings are treated as components.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && isInlineCurlyComponent(ctx, node, pathName)) {
    return createInlineCurlyComponent(ctx, node, pathName, range);
  }

  // In compat mode, transform let-block param dot-path invocations with args
  // to component HBSNodes so they compile as $_dc (dynamic component).
  // e.g. {{param.prop arg=val}} where param is a let-binding → HBSNode with tag "param.prop"
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && node.path.type === 'PathExpression') {
    const headNode = node.path.head;
    if (headNode.type === 'VarHead' && node.path.tail.length > 0) {
      const headName = headNode.name ?? headNode.original;
      const binding = ctx.scopeTracker.resolve(headName);
      if (binding && binding.kind === 'let-binding' && (node.hash.pairs.length > 0 || node.params.length > 0)) {
        return createLetParamComponentInvocation(ctx, node, pathName, range);
      }
    }
  }

  // Handle yield/outlet
  if (pathName === 'yield' || pathName === 'outlet') {
    return createYieldExpression(ctx, node, range);
  }

  // Mirror the SubExpression handler for `(element "tag")` (visitors/index.ts).
  // The `element` keyword (Ember keyword helper + `@ember/helper` export)
  // produces a component-like value: a function that, when invoked as a
  // component, renders its block wrapped in the given tag. In SubExpression
  // form `(element "h1")` we emit `elementHelperWrapper`. In MustacheStatement
  // form `{{element "p"}}` (e.g. in attribute position `@tag={{element "p"}}`)
  // the runtime path routes through `$_maybeHelper("element", ...)` which
  // either fails ("element not in scope") or invokes Ember's helper and
  // returns an ElementComponentDefinition instance — neither shape works as
  // a `<Tag>` component invocation downstream. Intercept the keyword here so
  // BOTH forms produce the same elementHelperWrapper function value.
  // Skip when `element` resolves to a local binding (e.g. user-shadowed).
  if (pathName === 'element' && !ctx.scopeTracker.hasBinding('element')) {
    const pathRange = getNodeRange(node.path);
    let tagValue: SerializedValue;
    if (node.params.length !== 1) {
      tagValue = raw('(()=>{throw new Error("The `element` helper takes a single positional argument")})()');
    } else if (node.hash.pairs.length !== 0) {
      tagValue = raw('(()=>{throw new Error("The `element` helper does not take any named arguments")})()');
    } else {
      const tagParam = node.params[0];
      const tagResult = getVisit(ctx)(ctx, tagParam, false);
      tagValue = tagResult && isSerializedValue(tagResult) ? tagResult : literal('div');
    }
    const helperResult = helper(INTERNAL_HELPERS.ELEMENT_HELPER, [tagValue], new Map(), range, pathRange);
    if (wrap) {
      return getter(helperResult, range);
    }
    return helperResult;
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
 * Create an <ember-mount> HBSNode for {{mount "engine-name" model=expr}} in compat mode.
 * The engine name becomes a data-engine attribute, and an optional model hash arg becomes @model.
 */
function createMountElement(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  range?: SourceRange
): HBSNode {
  const attributes: Array<[string, SerializedValue]> = [];

  // First positional param is the engine name (string literal)
  if (node.params.length > 0) {
    const engineParam = node.params[0];
    if (engineParam.type === 'StringLiteral') {
      attributes.push(['data-engine', literal(engineParam.value)]);
    }
  }

  // Hash arg "model" becomes @model
  const modelPair = node.hash.pairs.find((p) => p.key === 'model');
  if (modelPair) {
    const modelResult = getVisit(ctx)(ctx, modelPair.value, false);
    if (modelResult !== null && isSerializedValue(modelResult)) {
      attributes.push(['@model', getter(modelResult, range)]);
    }
  }

  return {
    _nodeType: 'element',
    tag: 'ember-mount',
    selfClosing: true,
    blockParams: [],
    hasStableChild: false,
    attributes,
    properties: [],
    events: [],
    children: [],
    sourceRange: range,
  };
}

/**
 * Create an <Input /> or <Textarea /> HBSNode for {{input ...}} / {{textarea ...}} in compat mode.
 * Hash args are converted to @-prefixed attributes on the component element.
 */
function createInputTextareaElement(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  name: string,
  range?: SourceRange
): HBSNode {
  const pascalName = name === 'input' ? 'Input' : 'Textarea';
  const attributes: Array<[string, SerializedValue]> = [];

  // Convert all hash pairs to @-prefixed attributes
  for (const pair of node.hash.pairs) {
    const value = getVisit(ctx)(ctx, pair.value, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@${pair.key}`, getter(value, range)]);
    }
  }

  return {
    _nodeType: 'element',
    tag: pascalName,
    selfClosing: true,
    blockParams: [],
    hasStableChild: false,
    attributes,
    properties: [],
    events: [],
    children: [],
    sourceRange: range,
  };
}

/**
 * Convert kebab-case to PascalCase.
 * E.g. "my-component" → "MyComponent"
 */
function toPascalCase(name: string): string {
  return name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

/**
 * Create an HBSNode for {{component "name" arg=val}} or {{component this.xxx arg=val}}.
 *
 * - Static string name: {{component "foo-bar" arg=val}} → <FooBar @__fromComponentHelper__={{true}} @arg={{val}} />
 * - Dynamic path name: {{component this.xxx arg=val}} → <this.xxx @arg={{val}} />
 * - Positional params beyond the first become @__pos0__, @__pos1__, etc. with @__posCount__
 */
function createComponentElement(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  range?: SourceRange
): HBSNode | null {
  if (node.params.length === 0) return null;

  const firstParam = node.params[0];
  let tag: string;
  let isStaticName = false;

  if (firstParam.type === 'StringLiteral') {
    // Static name: {{component "foo-bar"}} → <FooBar>
    tag = toPascalCase(firstParam.value);
    isStaticName = true;
  } else if (firstParam.type === 'PathExpression') {
    // Dynamic name: {{component this.xxx}} → <this.xxx>
    tag = getPathExpressionString(firstParam);
  } else if (firstParam.type === 'SubExpression') {
    // SubExpression: {{component (someHelper)}} — skip, let existing pipeline handle
    return null;
  } else {
    return null;
  }

  const attributes: Array<[string, SerializedValue]> = [];

  // For static names, add the marker so $_tag knows this came from {{component}}
  if (isStaticName) {
    attributes.push(['@__fromComponentHelper__', literal(true)]);
  }

  // Remaining positional params (after the first which is the component name)
  const positionalParams = node.params.slice(1);
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

  // Convert hash pairs to @-prefixed attributes
  for (const pair of node.hash.pairs) {
    const value = getVisit(ctx)(ctx, pair.value, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@${pair.key}`, getter(value, range)]);
    }
  }

  return {
    _nodeType: 'element',
    tag,
    selfClosing: true,
    blockParams: [],
    hasStableChild: false,
    attributes,
    properties: [],
    events: [],
    children: [],
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
  let isArg = head.type === 'AtHead';

  // In compat mode, `this.attrs.X` is rewritten to `@X` by resolvePath —
  // mark it as an arg so serialization treats it like an @-arg reference.
  if (
    ctx.flags.IS_GLIMMER_COMPAT_MODE &&
    isThisPath &&
    pathExpr.tail.length >= 2 &&
    pathExpr.tail[0] === 'attrs'
  ) {
    isArg = true;
  }

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
    const noArgHelper = helper(pathName, [], new Map(), range, pathRange);
    // Wrap a 0-arg helper mustache (e.g. `{{hello}}` where `hello` is an unknown
    // name resolved as a custom helper) in a getter, mirroring the named-args
    // path above and the positional-args path in visitHelperMustache. Without
    // this, the runtime const-folds the bare value — `$_maybeHelper("hello", [],
    // this)` is called ONCE outside any tracker frame, so the helper's internal
    // `@tracked` reads (and the helperCell the manager-bucket path returns) are
    // never subscribed, and a later tracked mutation (which dirties the cell +
    // fires PROPERTY_DID_CHANGE) updates a cell nobody listens to. Wrapping in a
    // getter makes the binding re-evaluable inside the text-binding effect's
    // tracker frame, so the helperCell read registers and the binding re-fires
    // on the tracked change. Reactive ≠ eagerly re-evaluated: a helper that
    // reads no tracked state captures no deps → its effect is const → never
    // re-fires (so `{{unique-id}}`, `{{has-block}}`, and the classic-Helper
    // compute-count bouncer stay stable).
    //
    // Skip in attribute/named-arg position (`@content={{foo}}`): there the
    // bare `$_maybeHelper("foo", [], this)` form must survive so the
    // Ember-side guard (gxt-backend compile.ts) can detect a resolved helper
    // passed by reference and throw the standard ambiguous-named-arg error.
    // Reactivity for arg values is already provided by the component arg
    // getter, so wrapping here is both unnecessary and harmful.
    if (_wrap && !ctx.inAttributeValue) {
      return getter(noArgHelper, range);
    }
    return noArgHelper;
  }

  // Has hash args - helper call.
  // Return as structured helper value; buildHelper handles:
  // - Known bindings (direct call or maybeHelper with WITH_HELPER_MANAGER)
  // - Unknown helpers (maybeHelper with scope resolution)
  // - Built-in helpers (symbol lookup)
  const helperValue = helper(pathName, [], hashArgs, range, pathRange);
  // Wrap in a getter for reactivity, mirroring visitHelperMustache (the
  // positional-args path). Without this, a named-args-only helper mustache
  // like `{{hello foo=this.foo}}` is emitted as a bare value and the runtime
  // const-folds it (the hash getters read once, producing a static value),
  // so changes to `this.foo` never re-invoke the helper. Wrapping makes the
  // hash-value path reads reactive exactly like positional params.
  if (_wrap) {
    return getter(helperValue, range);
  }
  return helperValue;
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

// ============================================================================
// Inline curly component detection and conversion (compat mode)
// ============================================================================

/**
 * Built-in helpers with hyphens that should NOT be treated as component invocations.
 */
const BUILTIN_HYPHENATED_HELPERS = new Set([
  'unique-id', 'each-in', 'has-block', 'has-block-params', 'in-element',
]);

/**
 * Check if a mustache statement is an inline curly component invocation.
 * A hyphenated name (contains '-') that is not a built-in helper and not a known binding.
 */
function isInlineCurlyComponent(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  pathName: string
): boolean {
  // Must contain a hyphen
  if (!pathName.includes('-')) return false;
  // Must be a simple VarHead path (not this.foo.bar-baz or @arg-name)
  const pathExpr = node.path as ASTv1.PathExpression;
  if (pathExpr.head.type !== 'VarHead') return false;
  // Must not have a dotted path (e.g., foo.bar-baz)
  if (pathExpr.tail.length > 0) return false;
  // Must not have positional params — positional params indicate helper call, not component
  if (node.params.length > 0) return false;
  // Must not be a built-in hyphenated helper
  if (BUILTIN_HYPHENATED_HELPERS.has(pathName)) return false;
  // Must not be a known binding (e.g., a let-block param or imported name)
  if (ctx.scopeTracker.hasBinding(pathName)) return false;
  // Hyphenated mustaches with NO positional and NO named args are ambiguous
  // — they could be a dasherized helper (e.g. `{{x-borf}}` resolved through
  // a helper manager / runtime scope) or a self-closing component. Synthesizing
  // a component invocation here short-circuits runtime helper resolution
  // (e.g. component.args[$_scope]-based dispatch in `$_maybeHelper`), which
  // breaks the `Integration | DashHelpers | x-bar >> dashed hlpers without
  // args wrapped with helper manager` flow regardless of WITH_HELPER_MANAGER.
  // Route to `$_maybeHelper` always when no args are provided; component
  // invocations are reachable via explicit angle-bracket syntax `<XBorf />`.
  // See PR https://github.com/lifeart/glimmer-next/pull/212.
  if (node.hash.pairs.length === 0) return false;
  return true;
}

/**
 * Create an HBSNode for an inline curly component invocation.
 * {{foo-bar arg=val}} → HBSNode with tag="foo-bar" and @arg attributes.
 * Positional params become @__pos0__, @__pos1__, etc. attributes.
 */
function createInlineCurlyComponent(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  pathName: string,
  range?: SourceRange
): HBSNode {
  const attributes: Array<[string, SerializedValue]> = [];

  // Convert hash pairs to @-prefixed attributes
  for (const pair of node.hash.pairs) {
    const value = getVisit(ctx)(ctx, pair.value, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@${pair.key}`, getter(value, range)]);
    }
  }

  // Convert positional params to @__pos0__, @__pos1__, etc.
  for (let i = 0; i < node.params.length; i++) {
    const value = getVisit(ctx)(ctx, node.params[i]!, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@__pos${i}__`, getter(value, range)]);
    }
  }
  if (node.params.length > 0) {
    attributes.push([`@__posCount__`, literal(node.params.length)]);
  }

  // Convert kebab-case to PascalCase for the tag name
  const pascalTag = toPascalCase(pathName);
  return createSelfClosingComponentNode(pascalTag, attributes, range);
}

/**
 * Create an HBSNode for a let-block param dot-path component invocation.
 * {{param.prop arg=val}} where param is a let-binding → HBSNode with tag "param.prop"
 * This compiles as $_dc (dynamic component) because the tag contains a dot.
 */
function createLetParamComponentInvocation(
  ctx: CompilerContext,
  node: ASTv1.MustacheStatement,
  pathName: string,
  range?: SourceRange
): HBSNode {
  const attributes: Array<[string, SerializedValue]> = [];

  // Convert hash pairs to @-prefixed attributes
  for (const pair of node.hash.pairs) {
    const value = getVisit(ctx)(ctx, pair.value, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@${pair.key}`, getter(value, range)]);
    }
  }

  // Convert positional params to @__pos0__, @__pos1__, etc.
  for (let i = 0; i < node.params.length; i++) {
    const value = getVisit(ctx)(ctx, node.params[i]!, false);
    if (value !== null && isSerializedValue(value)) {
      attributes.push([`@__pos${i}__`, getter(value, range)]);
    }
  }
  if (node.params.length > 0) {
    attributes.push([`@__posCount__`, literal(node.params.length)]);
  }

  return createSelfClosingComponentNode(pathName, attributes, range);
}

/**
 * Build a self-closing HBSNode for component invocations.
 */
function createSelfClosingComponentNode(
  tag: string,
  attributes: Array<[string, SerializedValue]>,
  range?: SourceRange
): HBSNode {
  return {
    _nodeType: 'element',
    tag,
    selfClosing: true,
    blockParams: [],
    hasStableChild: false,
    attributes,
    properties: [],
    events: [],
    children: [],
    sourceRange: range,
  };
}
