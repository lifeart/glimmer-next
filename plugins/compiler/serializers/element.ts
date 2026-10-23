/**
 * Element and Component Serializers
 *
 * Serializes HBSNode to JavaScript code for DOM elements and components.
 * Uses the CodeBuilder pattern for clean code generation.
 */

import type { CompilerContext } from '../context';
import { isArgComponentTag } from '../context';
import type {
  HBSNode,
  HBSChild,
  AttributeTuple,
  PropertyTuple,
  EventTuple,
  HBSTag,
  HelperValue,
  SerializedValue,
} from '../types';
import { isSerializedValue, isRuntimeTag } from '../types';
import { SYMBOLS, EVENT_TYPE, INTERNAL_HELPERS } from './symbols';
import { buildValue, buildPathExpression, buildNativeArg, buildArgLabels, selfHeadedName, emittedRootName, emittedPathName } from './value';
import { B, serializeJS, type JSExpression, type JSProperty } from '../builder';
import { escapeBindingName } from '../utils/js-utils';

// Forward declarations - set from index.ts to avoid circular dependency
let buildChildrenExprs: (ctx: CompilerContext, children: readonly HBSChild[], ctxName: string) => JSExpression[];
let nextCtxName: (ctx: CompilerContext) => string;

/**
 * JavaScript reserved words that cannot be used as bare identifiers.
 * Used when a template scope binding shadows a GXT built-in keyword
 * (e.g. `renderComponent(tpl, { scope: { if: Component } })`) — we must
 * emit a safe alias (`__scope_if`) instead of the bare reserved word.
 */
const JS_RESERVED_WORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends',
  'false', 'finally', 'for', 'function', 'if', 'implements', 'import',
  'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package',
  'private', 'protected', 'public', 'return', 'static', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'await',
]);

/**
 * Produce a JS-safe identifier name for a template binding.
 * If the name is a JS reserved word, prefix with `__scope_` so it can be
 * used as a bare identifier. This matches the Ember compat layer's
 * `__scope_<name>` aliasing convention, so scope injection and bare-ref
 * emission agree on the symbol.
 */
function jsSafeBindingId(name: string): string {
  return JS_RESERVED_WORDS.has(name) ? `__scope_${name}` : name;
}

/**
 * Set dependencies from index.ts to break circular dependency.
 */
export function setElementDependencies(
  buildChildrenExprsFn: typeof buildChildrenExprs,
  nextCtxNameFn: typeof nextCtxName
): void {
  buildChildrenExprs = buildChildrenExprsFn;
  nextCtxName = nextCtxNameFn;
}

/**
 * Serialize an element node to JavaScript.
 */
export function serializeElement(
  ctx: CompilerContext,
  node: HBSNode,
  ctxName: string
): string {
  const result = buildElement(ctx, node, ctxName);
  const fmt = ctx.formatter.options;
  return serializeJS(result, {
    format: fmt.enabled,
    indent: fmt.indent,
    baseIndent: fmt.baseIndent,
    emitPure: fmt.emitPure,
  });
}

/**
 * Build an element node as JSExpression.
 * Uses the builder pattern for proper formatting and source mapping.
 */
export function buildElement(
  ctx: CompilerContext,
  node: HBSNode,
  ctxName: string
): JSExpression {
  const fmt = ctx.formatter;

  // Check for splat attributes
  const hasSplatAttrs = node.attributes.some(([name]) => name === '...attributes');

  // Filter out splat attributes
  const attributes = node.attributes.filter(([name]) => name !== '...attributes');

  // Build DOM properties as JSExpression
  const tagPropsExpr = buildTagProps(ctx, node.properties, attributes, node.events, hasSplatAttrs, ctxName);

  // Build children as JSExpression array (proper tree - no intermediate string serialization)
  const childExprs = buildChildrenExprs(ctx, node.children, ctxName);

  // In compat mode, wrap children of component-like $_tag calls in lazy arrow functions.
  // Detect Ember components: hyphenated names or PascalCase (angle-bracket).
  // Standard HTML elements (div, span, p, etc.) don't need lazy children, nor,
  // for an Ember host, does a custom element (`<x-foo>`): Glimmer never
  // invokes one as a component.
  const isLikelyComponent = typeof node.tag === 'string' && (
    node.tag.includes('-') || (node.tag[0] >= 'A' && node.tag[0] <= 'Z')
  ) && !(node.customElement === true && ctx.flags.WITH_EMBER_INTEGRATION === true);
  const finalChildExprs = (ctx.flags.IS_GLIMMER_COMPAT_MODE && isLikelyComponent)
    ? maybeWrapComponentChildren(childExprs)
    : childExprs;

  // Use formattedArray for children when formatting is enabled and there are children
  const childrenExpr = fmt.options.enabled && finalChildExprs.length > 0
    ? B.formattedArray(finalChildExprs, true)
    : B.array(finalChildExprs);

  // RuntimeTag should never reach buildElement - they're always components
  // If this happens, there's a bug in isComponentTag() or the calling code
  if (isRuntimeTag(node.tag)) {
    throw new Error(
      `RuntimeTag "${node.tag.symbol}" should not reach buildElement - it should be handled as a component`
    );
  }

  // Determine if we should use formatted call
  const hasContent = node.properties.length > 0 || attributes.length > 0 ||
                     node.events.length > 0 || node.children.length > 0;
  const useFormatted = fmt.options.enabled && hasContent;

  // Build the $_tag call using builder pattern
  // Use raw string for tag name to preserve single-quote format
  // Use 'ElementNode' as the mapping source for proper sourcemap type
  // Parameter order: $_tag(tag, props, ctx, children?) — children omitted when empty
  const tagArgs: JSExpression[] = [
    B.stringSingle(node.tag, node.tagRange),
    tagPropsExpr,
    B.id(ctxName),
  ];
  if (childExprs.length > 0) {
    tagArgs.push(childrenExpr);
  }
  return B.call(
    B.id(SYMBOLS.TAG),
    tagArgs,
    node.sourceRange,
    useFormatted,
    'ElementNode'
  );
}

/**
 * Serialize a component node to JavaScript.
 */
export function serializeComponent(
  ctx: CompilerContext,
  node: HBSNode,
  ctxName: string
): string {
  const result = buildComponent(ctx, node, ctxName);
  const fmt = ctx.formatter.options;
  return serializeJS(result, {
    format: fmt.enabled,
    indent: fmt.indent,
    baseIndent: fmt.baseIndent,
    emitPure: fmt.emitPure,
  });
}

/**
 * Build a component node as JSExpression.
 */
export function buildComponent(
  ctx: CompilerContext,
  node: HBSNode,
  ctxName: string
): JSExpression {
  // Check for splat attributes
  const hasSplatAttrs = node.attributes.some(([name]) => name === '...attributes');

  // A dynamic component (dotted-path tag → `$_dc`) in splat context carries
  // `$fw` as a dedicated 4th `$_dc` argument (see buildComponentCall) rather
  // than baking it into the args-props tuple. This mirrors how the static
  // element path ($_tag) passes `$fw` as a separate tuple slot, and lets the
  // runtime thread the forwarded attributes into the *resolved* component (and
  // re-thread them across a component swap). Static component invocations
  // ($_c) keep the in-args merge. The tag test mirrors buildComponentCall's
  // own `$_dc` routing rule (`typeof tag === 'string' && tag.includes('.')`).
  // A loose-mode by-name component (G11) and a compat curly component block
  // (`compatComponent`) are invoked by their name: `$_c('Name', …)`.
  const byName = node.byName === true || node.compatComponent === true;
  const isDynamicComponent =
    !byName &&
    typeof node.tag === 'string' &&
    (node.tag.includes('.') || isArgComponentTag(ctx, node.tag));
  const dynamicSplat = isDynamicComponent && hasSplatAttrs;

  // Separate @ args from regular attributes
  const attributes = node.attributes.filter(([name]) => name !== '...attributes');
  const args = attributes.filter(([name]) => name.startsWith('@'));
  const attrs = attributes.filter(([name]) => !name.startsWith('@') && name !== 'class');

  // Move ALL class attributes to properties with empty key for proper merging
  // This ensures multiple class attributes work correctly (e.g., dynamic + static class)
  const classAttrs = attributes.filter(([name]) => name === 'class');
  const classProps: PropertyTuple[] = classAttrs.map(([, value, range]) =>
    ['', value, range] as PropertyTuple
  );
  const properties = [...node.properties, ...classProps];

  // Build DOM props for forwarding. Suppress the in-args `$fw` merge for a
  // dynamic splat component — it is forwarded via the 4th `$_dc` argument.
  const propsExpr = buildComponentProps(ctx, properties, attrs, node.events, hasSplatAttrs && !dynamicSplat, ctxName);

  // Check if props are empty (no properties, no attrs, no events, no splat)
  const isEmpty = properties.length === 0 && attrs.length === 0 && node.events.length === 0 && !hasSplatAttrs;
  const finalPropsExpr = isEmpty ? B.id(SYMBOLS.EMPTY_DOM_PROPS) : propsExpr;

  const useFormatted = ctx.formatter.options.enabled;

  // Ember: an angle-bracket dynamic invocation's tag path is `$_dc`'s debug
  // label (see buildComponentCall); `{{component this.x}}` has none.
  const dcLabel = node.componentKeyword !== true;

  if (node.selfClosing) {
    // Self-closing component - empty slots object
    const argsCall = buildComponentArgsExpr(ctx, args, B.emptyObject(), finalPropsExpr, ctxName);
    return buildComponentCall(ctx, node.tag, argsCall, ctxName, useFormatted, node.sourceRange, node.tagRange, dynamicSplat, byName, dcLabel);
  }

  // Component with children/slots
  const slotsExpr = buildSlots(ctx, node);
  const argsCall = buildComponentArgsExpr(ctx, args, slotsExpr, finalPropsExpr, ctxName);
  return buildComponentCall(ctx, node.tag, argsCall, ctxName, useFormatted, node.sourceRange, node.tagRange, dynamicSplat, byName, dcLabel);
}

/**
 * Build tag properties array [props, attrs, events].
 * Uses formattedArray when formatting is enabled for better readability.
 */
function buildTagProps(
  ctx: CompilerContext,
  properties: readonly PropertyTuple[],
  attributes: readonly AttributeTuple[],
  events: readonly EventTuple[],
  hasSplatAttrs: boolean,
  ctxName: string
): JSExpression {
  // Move ALL class attributes to properties with empty key for proper merging
  // This ensures multiple class attributes work correctly (e.g., dynamic + static class)
  const classAttrs = attributes.filter(([name]) => name === 'class');
  const nonClassAttrs = attributes.filter(([name]) => name !== 'class');

  // Convert class attributes to properties with empty key for classNameModifiers
  const classProps: PropertyTuple[] = classAttrs.map(([, value, range]) =>
    ['', value, range] as PropertyTuple
  );
  const allProps = [...properties, ...classProps];

  const props = buildTupleArray(ctx, allProps, ctxName);
  const attrs = buildTupleArray(ctx, nonClassAttrs, ctxName);
  const evts = buildEvents(ctx, events, ctxName);

  // Check for empty props (optimization)
  const propsStr = serializeJS(props);
  const attrsStr = serializeJS(attrs);
  const evtsStr = serializeJS(evts);

  if (propsStr === '[]' && attrsStr === '[]' && evtsStr === '[]' && !hasSplatAttrs) {
    return B.id(SYMBOLS.EMPTY_DOM_PROPS);
  }

  const elements = [props, attrs, evts];
  if (hasSplatAttrs) {
    // Splat attributes emit a free `$fw` reference (forwarded props tuple) →
    // the `const $fw = $_GET_FW(...)` preamble local is required.
    ctx.usedFw = true;
    elements.push(B.id('$fw'));
  }

  // Use formattedArray when formatting is enabled and there's significant content
  const hasContent = allProps.length > 0 || nonClassAttrs.length > 0 || events.length > 0;
  if (ctx.formatter.options.enabled && hasContent) {
    return B.formattedArray(elements, true);
  }

  return B.array(elements);
}

/**
 * Build component props array as JSExpression.
 * Returns [props, attrs, events] or merged with splat attributes.
 * Uses formattedArray when formatting is enabled for better readability.
 */
function buildComponentProps(
  ctx: CompilerContext,
  properties: readonly PropertyTuple[],
  attrs: readonly AttributeTuple[],
  events: readonly EventTuple[],
  hasSplatAttrs: boolean,
  ctxName: string
): JSExpression {
  const propsExpr = buildTupleArray(ctx, properties, ctxName);
  const attrsExpr = buildTupleArray(ctx, attrs, ctxName);
  const evtsExpr = buildEvents(ctx, events, ctxName);

  const hasContent = properties.length > 0 || attrs.length > 0 || events.length > 0;
  const useFormatted = ctx.formatter.options.enabled && hasContent;

  if (hasSplatAttrs) {
    // Merge with forwarded attributes: [[...$fw[0], ...props], [...$fw[1], ...attrs], [...$fw[2], ...evts]]
    // Emits free `$fw` references → the `const $fw = $_GET_FW(...)` preamble
    // local is required.
    ctx.usedFw = true;
    // Ember native layer: Glimmer concatenates classes in SOURCE order, so a
    // `class` written BEFORE `...attributes` on a component invocation
    // (`<Qux class="bar" ...attributes />`) precedes the forwarded classes —
    // the compat `__splatLocal__` marker lists what comes after the splat
    // (`__class__` for a class). Other props keep the historic order.
    const nativeClassFirst =
      ctx.flags.EMBER_NATIVE === true && !classWrittenAfterSplat(properties);
    const classTuples = nativeClassFirst ? properties.filter(([key]) => key === '') : [];
    const propsHead: JSExpression[] =
      classTuples.length > 0 ? [B.spread(buildTupleArray(ctx, classTuples, ctxName))] : [];
    const propsTail =
      classTuples.length > 0
        ? buildTupleArray(ctx, properties.filter(([key]) => key !== ''), ctxName)
        : propsExpr;
    const elements = [
      B.array([
        ...propsHead,
        B.spread(B.computedMember(B.id(SYMBOLS.LOCAL_FW), B.num(0))),
        B.spread(propsTail),
      ]),
      B.array([
        B.spread(B.computedMember(B.id(SYMBOLS.LOCAL_FW), B.num(1))),
        B.spread(attrsExpr),
      ]),
      B.array([
        B.spread(B.computedMember(B.id(SYMBOLS.LOCAL_FW), B.num(2))),
        B.spread(evtsExpr),
      ]),
    ];
    return useFormatted ? B.formattedArray(elements, true) : B.array(elements);
  }

  const elements = [propsExpr, attrsExpr, evtsExpr];
  return useFormatted ? B.formattedArray(elements, true) : B.array(elements);
}

/**
 * True when the compat `__splatLocal__` marker (see visitors/element.ts
 * `rewriteSplatLocalOverrides`) says a `class` is written AFTER `...attributes`.
 */
function classWrittenAfterSplat(properties: readonly PropertyTuple[]): boolean {
  for (const [key, value] of properties) {
    if (key !== '__splatLocal__') continue;
    if (value && value.kind === 'literal' && typeof value.value === 'string') {
      return value.value.split(',').includes('__class__');
    }
  }
  return false;
}

/**
 * Build a tuple array (attributes, properties).
 * Uses buildValue directly to preserve AST structure.
 * Uses formattedArray when formatting is enabled and there are multiple items.
 */
/**
 * True when `expr` is a bare, string-form `$_maybeHelper("name", …)` call — the
 * shape the Ember named-arg resolved-helper DEBUG guard keys off when it lands
 * in a `["@name", …]` tuple. Matches only the STRING first-arg form (an
 * unresolved lookup); a resolved reference passes an identifier, not a string.
 */
function isStringFormMaybeHelperCall(expr: JSExpression): boolean {
  if (expr.type !== 'call') return false;
  const callee = expr.callee;
  const calleeName =
    callee.type === 'identifier'
      ? callee.name
      : callee.type === 'runtimeRef'
        ? callee.symbol
        : null;
  if (calleeName !== SYMBOLS.MAYBE_HELPER) return false;
  const first = expr.arguments[0];
  return !!first && first.type === 'literal' && typeof first.value === 'string';
}

function buildTupleArray(
  ctx: CompilerContext,
  tuples: readonly (AttributeTuple | PropertyTuple)[],
  ctxName: string
): JSExpression {
  if (tuples.length === 0) {
    return B.emptyArray();
  }

  const items = tuples.map((tuple) => {
    const [name, value, range, nameRange] = tuple;
    // Use buildValue directly to preserve AST structure for better code generation
    const valueExpr = buildValue(ctx, value, ctxName);
    // Ground-truth: a string-form $_maybeHelper landing in a `["@name", …]`
    // tuple is the named-arg resolved-helper shape the Ember DEBUG guard
    // rewrites. The position is known here (the tuple is built with the key).
    if (name.startsWith('@') && isStringFormMaybeHelperCall(valueExpr)) {
      ctx.emissionReport.maybeHelperInNamedArgPosition = true;
    }
    // Use nameRange for attribute names when available (AttributeTuple has 4 elements)
    const nameExpr = nameRange ? B.string(name, nameRange) : B.string(name);
    return B.array([nameExpr, valueExpr], range, 'AttrNode');
  });

  // Use formattedArray for better readability when formatting is enabled and there are multiple items
  if (ctx.formatter.options.enabled && items.length > 1) {
    return B.formattedArray(items, true);
  }

  return B.array(items);
}

/**
 * Build events array.
 * Uses buildValue directly to preserve AST structure.
 * Uses formattedArray when formatting is enabled and there are multiple items.
 */
function buildEvents(
  ctx: CompilerContext,
  events: readonly EventTuple[],
  ctxName: string
): JSExpression {
  if (events.length === 0) {
    return B.emptyArray();
  }

  const items = events.map(([name, handler, range]) => {
    // Convert event type names
    let eventName: string;
    if (name === '@oncreated') {
      eventName = EVENT_TYPE.ON_CREATED;
    } else if (name === '@textContent') {
      eventName = EVENT_TYPE.TEXT_CONTENT;
    } else {
      eventName = name;
    }

    const handlerExpr = buildEventHandlerExpr(ctx, eventName, handler, ctxName);

    return B.array([B.string(eventName), handlerExpr], range, 'AttrNode');
  });

  // Use formattedArray for better readability when formatting is enabled and there are multiple items
  if (ctx.formatter.options.enabled && items.length > 1) {
    return B.formattedArray(items, true);
  }

  return B.array(items);
}

/**
 * Build the handler expression for a single event tuple.
 *
 * Shared between `buildEvents` (the `$_tag` props emission) and the
 * static-block fast-path serializer (serializers/static-block.ts), so the
 * expression a block slot receives is byte-identical to what `$_tag` would
 * have received for the same event tuple.
 */
export function buildEventHandlerExpr(
  ctx: CompilerContext,
  eventName: string,
  handler: SerializedValue,
  ctxName: string
): JSExpression {
    let handlerExpr: JSExpression;

    // Native event handlers from {{on}} are stored as helper('$__on_handler', [handler, ...tailArgs])
    // Build: ($e, $n) => handler($e, $n, ...tailArgs) preserving source mapping
    if (handler.kind === 'helper' && handler.name === INTERNAL_HELPERS.ON_HANDLER) {
      const [handlerArg, ...tailArgs] = handler.positional;
      // Build handler as direct reference (no reactive getter wrapping)
      // since event handlers need plain function references, not getters
      const fnExpr = buildHandlerFunctionExpr(ctx, handlerArg, ctxName);
      const tailExprs = tailArgs.map(a =>
        a.kind === 'path' ? buildPathExpression(ctx, a, false) : buildValue(ctx, a, ctxName)
      );
      const callArgs: JSExpression[] = [B.id('$e'), B.id('$n'), ...tailExprs];
      handlerExpr = B.arrow(['$e', '$n'], B.call(fnExpr, callArgs));
    } else if (handler.kind === 'helper' && handler.name === INTERNAL_HELPERS.ON_CREATED_HANDLER) {
      const [handlerArg, ...tailArgs] = handler.positional;
      const fnExpr = handlerArg
        ? buildHandlerFunctionExpr(ctx, handlerArg, ctxName)
        : B.nil();
      const tailExprs = tailArgs.map(a =>
        a.kind === 'path' ? buildPathExpression(ctx, a, false) : buildValue(ctx, a, ctxName)
      );
      const callArgs: JSExpression[] = [B.id('$n'), ...tailExprs];
      handlerExpr = B.arrow(['$n'], B.call(fnExpr, callArgs));
    } else if (handler.kind === 'helper' && handler.name === INTERNAL_HELPERS.STYLE_SETTER) {
      handlerExpr = buildStyleSetterExpr(ctx, handler as HelperValue, ctxName);
    } else if (
      handler.kind === 'helper' &&
      handler.name === INTERNAL_HELPERS.DYNAMIC_MODIFIER
    ) {
      // Dynamic modifier (SubExpression in element-modifier position):
      //   positional[0] = compiled SubExpression value (the modifier ref)
      //   positional[1..] = invocation args appended after curried args
      // Emit `($n) => $_maybeModifier(expr, $n, [extraArgs], () => ({hash}))`.
      const hv = handler as HelperValue;
      const [modExprValue, ...extraArgs] = hv.positional;
      const modExpr = modExprValue
        ? buildValue(ctx, modExprValue, ctxName)
        : B.nil();
      if (ctx.flags.EMBER_NATIVE) {
        // Ember native layer: literal-or-thunk invocation arguments, a plain
        // named object (thunk values) and the render context — the same shape
        // as a static modifier (buildModifierExpr). The modifier expression
        // itself stays eager: the element-creation formula tracks it, so a
        // changed definition (e.g. `{{(if c (modifier x))}}`) re-creates it.
        const nativeExtra = extraArgs.map(a => buildNativeArg(ctx, a, ctxName));
        const nativeNamed: JSProperty[] = [];
        for (const [key, val] of hv.named) {
          nativeNamed.push(B.prop(key, buildNativeArg(ctx, val, ctxName), false, val.sourceRange));
        }
        const nativeArgs: JSExpression[] = [
          modExpr,
          B.id('$n'),
          B.array(nativeExtra),
          nativeNamed.length > 0 ? B.object(nativeNamed) : B.emptyObject(),
          B.id(ctxName),
        ];
        // EMBER_ARG_LABELS: the source paths of the invocation arguments.
        const nativeLabels = buildArgLabels(ctx, extraArgs, hv.named);
        if (nativeLabels !== null) nativeArgs.push(nativeLabels);
        const nativeCall = B.call(SYMBOLS.MAYBE_MODIFIER, nativeArgs, hv.sourceRange);
        return B.arrow(['$n'], nativeCall, hv.sourceRange);
      }
      const extraExprs = extraArgs.map(a =>
        a.kind === 'path' ? buildPathExpression(ctx, a, false) : buildValue(ctx, a, ctxName)
      );
      const namedProps: JSProperty[] = [];
      for (const [key, val] of hv.named) {
        namedProps.push(B.prop(key, buildValue(ctx, val, ctxName), false, val.sourceRange));
      }
      // Wrap the object body in parens so `() => ({...})` parses as an
      // expression-body arrow returning an object — NOT a block-body arrow
      // (`() => {}` returns `undefined`, which downstream `Object.keys(...)`
      // would explode on).
      const hashBody = namedProps.length > 0 ? B.object(namedProps) : B.emptyObject();
      // Pass the emission report so any symbols inside the raw-embedded hash
      // body (e.g. an unknown-helper value → $_maybeHelper) reach emittedSymbols.
      const hashExpr = B.raw(
        `() => (${serializeJS(hashBody, { report: ctx.emissionReport })})`,
        hv.sourceRange
      );
      const dynamicArgs: JSExpression[] = [modExpr, B.id('$n'), B.array(extraExprs), hashExpr];
      // EMBER_ARG_LABELS: the source paths of the invocation arguments, after
      // the render context compat does not pass.
      const dynamicLabels = buildArgLabels(ctx, extraArgs, hv.named);
      if (dynamicLabels !== null) dynamicArgs.push(B.undef(), dynamicLabels);
      const callExpr = B.call(SYMBOLS.MAYBE_MODIFIER, dynamicArgs, hv.sourceRange);
      handlerExpr = B.arrow(['$n'], callExpr, hv.sourceRange);
    } else if (handler.kind === 'helper' && eventName === EVENT_TYPE.ON_CREATED) {
      // Modifier handlers are stored as helper() values (kind === 'helper')
      // to preserve positional param source ranges. Build them as:
      // ($n) => modName($n, ...args, {hash}) or
      // ($n) => $__maybeModifier(modName, $n, [...args], {hash})
      handlerExpr = buildModifierExpr(ctx, handler as HelperValue, ctxName);
    } else if (eventName === EVENT_TYPE.TEXT_CONTENT && handler.kind === 'path') {
      handlerExpr = buildPathExpression(
        ctx,
        handler,
        ctx.flags.IS_GLIMMER_COMPAT_MODE,
        ctxName,
        { preferCellValue: true }
      );
    } else {
      // Use buildValue directly to preserve AST structure for better code generation
      handlerExpr = buildValue(ctx, handler, ctxName);
    }

    return handlerExpr;
}

function buildHandlerFunctionExpr(
  ctx: CompilerContext,
  handlerValue: SerializedValue,
  ctxName: string
): JSExpression {
  if (handlerValue.kind === 'path') {
    return buildPathExpression(ctx, handlerValue, false);
  }

  if (handlerValue.kind === 'helper' && handlerValue.name === 'fn') {
    return buildFnHelperDirect(ctx, handlerValue, ctxName);
  }

  return buildValue(ctx, handlerValue, ctxName);
}

function buildFnHelperDirect(
  ctx: CompilerContext,
  helperValue: HelperValue,
  ctxName: string
): JSExpression {
  const args = helperValue.positional.map(arg => {
    if (arg.kind === 'path') {
      return buildPathExpression(ctx, arg, false);
    }
    return buildValue(ctx, arg, ctxName);
  });

  return B.call(SYMBOLS.FN, args, helperValue.sourceRange);
}

/**
 * Build a modifier expression as ($n) => modName($n, ...args, {hash}).
 * Preserves positional param source ranges through buildValue.
 */
function buildModifierExpr(
  ctx: CompilerContext,
  mod: HelperValue,
  ctxName: string
): JSExpression {
  // Resolve modifier name (handle @arg references)
  let modName = mod.name;
  if (modName.startsWith('@')) {
    // @-arg modifier reference resolves through $a (dot or bracket) → the
    // `const $a = this[$args]` preamble local is required.
    ctx.usedArgsAlias = true;
    // `{{@x.foo}}`: the head is the argument name, the rest are members.
    const argPath = modName.slice(1);
    const dot = argPath.indexOf('.');
    const argName = dot === -1 ? argPath : argPath.slice(0, dot);
    const members = dot === -1 ? '' : argPath.slice(dot);
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName);
    modName =
      (needsBracket
        ? `${SYMBOLS.ARGS_ALIAS}["${argName}"]`
        : `${SYMBOLS.ARGS_ALIAS}.${argName}`) + members;
  } else {
    // EMBER_SELF (G6): a `this.modifier` reference reads the template self; a
    // binding is referenced under the name it is declared under.
    modName = emittedPathName(ctx, selfHeadedName(ctx, modName));
  }

  // Ember native layer: literal-or-thunk arguments (buildNativeArg) — the host
  // modifier manager reads them inside the modifier's own tracking frame, so
  // the element-creation formula tracks nothing and an argument change updates
  // the modifier (Glimmer `updateModifier`) instead of re-creating it.
  const native = ctx.flags.EMBER_NATIVE === true;

  // Build positional args with source ranges preserved.
  // For direct modifier calls, paths should be plain references (not reactive getters).
  const positionalExprs = mod.positional.map(arg => {
    if (native) {
      return buildNativeArg(ctx, arg, ctxName);
    }
    if (arg.kind === 'path') {
      return buildPathExpression(ctx, arg, false);
    }
    return buildValue(ctx, arg, ctxName);
  });

  // Build named args object
  const namedProps = [];
  for (const [key, val] of mod.named) {
    const valueExpr = native ? buildNativeArg(ctx, val, ctxName) : buildValue(ctx, val, ctxName);
    namedProps.push(B.prop(key, valueExpr, false, val.sourceRange));
  }

  // Check if modifier name is a known binding
  // For @args, this., or $_ prefixed names, treat as known
  // For dotted paths, check the root segment
  const rootName = mod.name.split(/[.\[]/)[0];
  const isKnownModifier = mod.name.startsWith('@') ||
    mod.name.startsWith('this.') ||
    mod.name.startsWith('this[') ||
    mod.name.startsWith('$_') ||
    ctx.scopeTracker.hasBinding(rootName);

  const modCallee = mod.pathRange
    ? B.id(modName, mod.pathRange, 'PathExpression', mod.name)
    : modName;

  // A kebab-cased (or otherwise non-identifier) UNKNOWN modifier name must not
  // be emitted as a bare callee: `($n) => my-mod($n, …)` is parsed by JS as
  // `($n) => (my - mod($n, …))` (subtraction), silently breaking the modifier.
  // Force the `$_maybeModifier("my-mod", …)` string-resolution form (which the
  // WITH_MODIFIER_MANAGER path already uses for unknown modifiers) so the name
  // is resolved at runtime instead of emitted as an invalid bare identifier.
  // Known bindings and valid-identifier (camelCase) names are unaffected.
  const needsStringModifierForm =
    !isKnownModifier &&
    !modName
      .split('.')
      .every((seg) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(seg));

  if (ctx.flags.WITH_MODIFIER_MANAGER || needsStringModifierForm) {
    // ($n) => $__maybeModifier(modName, $n, [...positional], {named})
    const namedObj = namedProps.length > 0 ? B.object(namedProps) : B.emptyObject();

    // For known bindings, pass the function reference directly
    // For unknown bindings, pass the name as a string for runtime resolution
    const modRef = isKnownModifier
      ? (typeof modCallee === 'string' ? B.id(modCallee) : modCallee)
      : B.string(mod.name, mod.pathRange);

    const callArgs: JSExpression[] = [
      modRef,
      B.id('$n'),
      B.array(positionalExprs),
      namedObj,
    ];
    if (native) {
      // The enclosing render context: the host reads the owner and the
      // interactivity of the render tree from it.
      callArgs.push(B.id(ctxName));
    }
    // EMBER_ARG_LABELS: the source paths of the arguments, after the render
    // context (`undefined` in compat, which passes none).
    const labels = buildArgLabels(ctx, mod.positional, mod.named);
    if (labels !== null) {
      if (!native) callArgs.push(B.undef());
      callArgs.push(labels);
    }
    const callExpr = B.call(SYMBOLS.MAYBE_MODIFIER, callArgs, mod.sourceRange);
    return B.arrow(['$n'], callExpr, mod.sourceRange);
  }

  // ($n) => modName($n, ...positional, {named})
  const callArgs: JSExpression[] = [B.id('$n'), ...positionalExprs];
  if (namedProps.length > 0) {
    callArgs.push(B.object(namedProps));
  }
  const callExpr = B.call(modCallee, callArgs, mod.sourceRange);
  return B.arrow(['$n'], callExpr, mod.sourceRange);
}

/**
 * Build a style setter expression for style.* attributes.
 * Generates a bound function that sets style property on creation.
 */
function buildStyleSetterExpr(
  ctx: CompilerContext,
  helperValue: HelperValue,
  ctxName: string
): JSExpression {
  const [propValue, styleValue] = helperValue.positional;
  const propertyName = propValue && propValue.kind === 'literal' && typeof propValue.value === 'string'
    ? propValue.value
    : '';
  const valueExpr = styleValue ? buildValue(ctx, styleValue, ctxName) : B.nil();

  return B.styleSetter(propertyName, valueExpr, {
    TO_VALUE: SYMBOLS.TO_VALUE,
    LOCAL_VALUE: SYMBOLS.LOCAL_VALUE,
    LOCAL_NODE: SYMBOLS.LOCAL_NODE,
  }, helperValue.sourceRange);
}

/**
 * Build component args wrapped with $_args.
 * Takes JSExpression for propsArg - cleaner than string concatenation.
 */
function buildComponentArgsExpr(
  ctx: CompilerContext,
  args: readonly AttributeTuple[],
  slotsExpr: JSExpression,
  propsExpr: JSExpression,
  ctxName: string
): JSExpression {
  const argsObj = buildArgsObject(ctx, args, ctxName);
  // Use formatted call when formatting is enabled and there are args
  const useFormatted = ctx.formatter.options.enabled && args.length > 0;
  return B.call(SYMBOLS.ARGS, [argsObj, slotsExpr, propsExpr], undefined, useFormatted);
}

/**
 * A compiler-emitted REACTIVE ARG THUNK: a zero-arg getter the arg-access layer
 * (`ArgProxyHandler` / the DEV `$_args` getter) must INVOKE on read to yield the
 * live value. These are exactly the function-valued shapes `buildValue` emits
 * for a reactive named arg in compat mode:
 *   • `reactiveGetter` / zero-arg `arrow` — `() => this.x`
 *   • `$__cached(() => …)` — the identity-memoized (hash)/(array) getter
 *     (buildMaybeMemoizedGetter; returns a getter FUNCTION) used under
 *     WITH_EMBER_INTEGRATION
 * A literal, a path member read, or an EAGER helper call (`$_maybeHelper(…)`,
 * `$__fn(…)`) is a VALUE — possibly a bound function the consumer must receive
 * as-is — and is NOT a thunk, so it is left unbranded and passes through.
 */
function isReactiveArgThunk(node: JSExpression): boolean {
  if (node.type === 'reactiveGetter') return true;
  if (node.type === 'arrow' && node.params.length === 0) return true;
  if (
    node.type === 'call' &&
    node.callee.type === 'identifier' &&
    node.callee.name === SYMBOLS.CACHED
  ) {
    return true;
  }
  return false;
}

/**
 * Build @args as an object.
 * Uses buildValue directly to preserve AST structure.
 */
function buildArgsObject(
  ctx: CompilerContext,
  args: readonly AttributeTuple[],
  ctxName: string
): JSExpression {
  if (args.length === 0) {
    return B.emptyObject();
  }

  const props: JSProperty[] = args.map(([name, value, range, nameRange]) => {
    // Remove @ prefix from arg name
    const argName = name.slice(1);
    // Use buildValue directly to preserve AST structure for better code generation
    let valueExpr = buildValue(ctx, value, ctxName);
    // Ember dialect: the arg-access layer invokes only BRANDED reactive thunks,
    // so mark the getters we emit here (ember.js#21340 C38). A plain function
    // VALUE — a host-forwarded action, a `{{fn}}`/helper result — stays
    // unbranded and is passed through un-invoked. Gated to the Ember dialect
    // (WITH_EMBER_INTEGRATION + IS_GLIMMER_COMPAT_MODE): this is the only layer
    // that forwards bare function values into gxt args. Standalone gxt keeps
    // byte-identical codegen and its invoke-every-getter arg semantics.
    if (
      ctx.flags.IS_GLIMMER_COMPAT_MODE &&
      ctx.flags.WITH_EMBER_INTEGRATION &&
      isReactiveArgThunk(valueExpr)
    ) {
      valueExpr = B.call(B.id(SYMBOLS.ARG_THUNK), [valueExpr], valueExpr.sourceRange);
    }
    // Use the arg name as-is; the serializer handles quoting non-identifier keys
    return B.prop(argName, valueExpr, false, range, nameRange);
  });

  return B.object(props);
}

/**
 * Build component slots as a JSExpression object.
 *
 * Slot structure: { slotName_: hasBlockParams, slotName: (ctx, ...params) => [children] }
 */
function buildSlots(
  ctx: CompilerContext,
  node: HBSNode
): JSExpression {
  const fmt = ctx.formatter;

  // Find named slots (children starting with :)
  const namedSlots = node.children.filter((child): child is HBSNode => {
    if (typeof child === 'string') return false;
    if (isSerializedValue(child)) return false;
    if (!('_nodeType' in child) || child._nodeType !== 'element') return false;
    // Named slots have string tags starting with :
    // RuntimeTag cannot be a named slot
    if (isRuntimeTag(child.tag)) return false;
    return child.tag.startsWith(':');
  });

  // If no named slots, the entire children is the default slot
  const slots = namedSlots.length > 0 ? namedSlots : [node];

  const properties: JSProperty[] = [];

  for (const slot of slots) {
    const sContext = nextCtxName(ctx);
    // Check if this is a named slot (string tag starting with :)
    const isNamedSlot = '_nodeType' in slot &&
      slot._nodeType === 'element' &&
      !isRuntimeTag(slot.tag) &&
      slot.tag.startsWith(':');
    const slotName = isNamedSlot && typeof slot.tag === 'string' ? slot.tag.slice(1) : 'default';

    // Get slot children
    const children = isNamedSlot ? (slot as HBSNode).children : node.children;

    // Check for block params - must happen BEFORE serializing children
    // so that block param references (e.g., `intl.name` from `as |intl|`)
    // are recognized as known bindings during serialization
    const blockParams = '_nodeType' in slot && slot._nodeType === 'element' ? slot.blockParams : [];
    const blockParamRanges = '_nodeType' in slot && slot._nodeType === 'element'
      ? slot.blockParamRanges ?? []
      : [];

    // Add block params in a dedicated scope frame so nested slots with
    // matching block-param names shadow rather than clobber outer bindings.
    ctx.scopeTracker.enterScope('slot');
    for (const param of blockParams) {
      ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
    }

    // Build slot children as JSExpression array (proper tree for correct indentation)
    const slotChildExprs = buildChildrenExprs(ctx, children, sContext);
    const slotArrayExpr = fmt.options.enabled && slotChildExprs.length > 0
      ? B.formattedArray(slotChildExprs, true)
      : B.array(slotChildExprs);

    // Exit slot scope, restoring outer bindings.
    ctx.scopeTracker.exitScope();
    const hasBlockParams = blockParams.length > 0;

    // Build the slot function: (ctx, ...blockParams) => [children]
    // Reserved-word block params (`<Comp as |if|>`) are escaped to a safe
    // identifier at the declaration site; references emit the same escaped
    // name (serializers/value.ts emitBindingRootName).
    const params = [
      sContext,
      ...blockParams.map((name, index) => {
        const emitName = escapeBindingName(name);
        const range = blockParamRanges[index];
        return range ? B.id(emitName, range) : emitName;
      }),
    ];
    const slotFunction = B.arrow(params, slotArrayExpr);

    // Add both properties: slotName_: hasBlockParams, slotName: function
    properties.push(B.prop(`${slotName}_`, B.bool(hasBlockParams)));
    properties.push(B.prop(slotName, slotFunction));
  }

  return B.object(properties);
}

/**
 * Build component call expression.
 */
function buildComponentCall(
  ctx: CompilerContext,
  tag: HBSTag,
  argsExpr: JSExpression,
  ctxName: string,
  formatted?: boolean,
  sourceRange?: import('../types').SourceRange,
  tagRange?: import('../types').SourceRange,
  // When true (dynamic component in splat context), emit the forwarded-props
  // tuple `$fw` as a dedicated 4th `$_dc` argument so the runtime can thread
  // the parent's `...attributes` into the resolved component.
  emitForwardedProps = false,
  // Ember loose mode (G11): `tag` is a component NAME the host resolves.
  byName = false,
  // Ember: pass a dynamic component's tag path to `$_dc` as its debug label.
  dcLabel = false
): JSExpression {
  // Handle RuntimeTag (namespace providers, dynamic components)
  if (isRuntimeTag(tag)) {
    return B.call(SYMBOLS.COMPONENT, [B.id(tag.symbol), argsExpr, B.id(ctxName)], sourceRange, formatted, 'ElementNode');
  }

  // Ember loose mode (G11, EMBER_LOOSE_COMPONENTS): `$_c("foo-bar", …)` — the
  // host component manager resolves the name through its registry. Also a
  // compat curly component block (`$_c('FooBar', …)`).
  if (byName) {
    return B.call(SYMBOLS.COMPONENT, [B.stringSingle(tag, tagRange), argsExpr, B.id(ctxName)], sourceRange, formatted, 'ComponentNode');
  }

  // Check for dynamic component (dotted path like context.V or this.Component)
  // Ember: an `@`-headed tag (`<@comp />`) is a dynamic component too
  // (isComponentTag routes it here).
  const isDynamic = tag.includes('.') || isArgComponentTag(ctx, tag);

  if (isDynamic) {
    // Wrap in reactive getter for dynamic component paths
    // This allows re-evaluation when the component reference changes
    // Use runtimeRef to preserve source map name for debugger hover.
    //
    // Normalize an arg-headed dynamic tag (e.g. `<@model.componentName/>` or
    // `{{component @model.componentName}}`) so the `@` head resolves through the
    // args alias ($a) instead of leaking a raw `@` token into emitted JS — a bare
    // `@ident` is only valid in decorator position, so `$_dc(() => @model.x, …)`
    // is a SyntaxError. Mirrors the @→$a rule used by the path/helper/modifier
    // serializers (serializers/value.ts:363-370). Non-arg dynamic tags such as
    // `this.foo.Bar` already emit valid JS and are left untouched.
    let dynamicTag = tag;
    if (dynamicTag.startsWith('@')) {
      // Arg-headed dynamic tag resolves through $a (dot or bracket) → the
      // `const $a = this[$args]` preamble local is required.
      ctx.usedArgsAlias = true;
      const dotIndex = dynamicTag.indexOf('.');
      const head = dotIndex === -1 ? dynamicTag.slice(1) : dynamicTag.slice(1, dotIndex);
      const rest = dotIndex === -1 ? '' : dynamicTag.slice(dotIndex);
      // Use bracket notation for head segments with special characters (hyphens etc.).
      const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(head);
      dynamicTag = needsBracket
        ? `${SYMBOLS.ARGS_ALIAS}["${head}"]${rest}`
        : `${SYMBOLS.ARGS_ALIAS}.${head}${rest}`;
    } else {
      // EMBER_SELF (G6): `<this.foo.Bar />` reads the template self.
      dynamicTag = selfHeadedName(ctx, dynamicTag);
      // A renamed `{{#let}}` head (BindingInfo.emitName) is referenced under
      // its declared name.
      const head = dynamicTag.split(/[?.[]/)[0]!;
      const emittedHead = emittedRootName(ctx, head);
      if (emittedHead !== head && ctx.scopeTracker.resolve(head)?.emitName !== undefined) {
        dynamicTag = emittedHead + dynamicTag.slice(head.length);
      }
    }
    const tagRef = B.runtimeRef(dynamicTag, tagRange);
    const tagGetter = B.reactiveGetter(tagRef, tagRange);
    const dcArgs: JSExpression[] = [tagGetter, argsExpr, B.id(ctxName)];
    if (emitForwardedProps) {
      // Splat context: forward `$fw` (the enclosing component's received
      // attributes) as the 4th `$_dc` argument. Emitting a free `$fw`
      // reference requires the `const $fw = $_GET_FW(...)` preamble local.
      ctx.usedFw = true;
      dcArgs.push(B.id(SYMBOLS.LOCAL_FW));
    }
    if (dcLabel && ctx.flags.WITH_EMBER_INTEGRATION) {
      // Ember (compat and native): the invocation's tag path as written
      // (`this.HelloWorld`, `@Greeting`) is the 5th `$_dc` argument, so the
      // host can name the component's debug render tree node as Glimmer does
      // (and its errors) without reading the getter's source.
      if (!emitForwardedProps) dcArgs.push(B.undef());
      dcArgs.push(B.string(tag, tagRange));
    }
    return B.call(SYMBOLS.DYNAMIC_COMPONENT, dcArgs, sourceRange, formatted, 'ElementNode');
  }

  // In Glimmer compat mode, emit component tags as string literals instead of
  // bare JS identifiers. The Ember compat manager resolves string component
  // names from the registry at runtime (via $_MANAGERS.component.canHandle).
  // Without this, curly-invoked components like {{#foo-bar}} get compiled to
  // $_c(FooBar, ...) which fails with "FooBar is not defined" because FooBar
  // is not a JS variable — it's an Ember registry component.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    // A tag genuinely in user scope (e.g., passed via scopeValues / strict
    // mode) is a JS binding; any other is a name for the registry lookup.
    if (!ctx.scopeTracker.hasBinding(tag)) {
      return B.call(SYMBOLS.COMPONENT, [B.stringSingle(tag, tagRange), argsExpr, B.id(ctxName)], sourceRange, formatted, 'ComponentNode');
    }
  }

  // Rewrite reserved words (e.g. `if`, `let`, `class`) to their safe alias
  // so template scope bindings that shadow GXT built-ins emit valid JS.
  const renamed = ctx.scopeTracker.resolve(tag)?.emitName;
  const safeTag = renamed ?? jsSafeBindingId(tag);
  return B.call(SYMBOLS.COMPONENT, [B.id(safeTag, tagRange, 'ElementNode'), argsExpr, B.id(ctxName)], sourceRange, formatted, 'ComponentNode');
}

/**
 * In compat mode, wrap children that contain component calls in arrow functions.
 * Returns children unchanged if no wrapping is needed.
 */
function maybeWrapComponentChildren(childExprs: JSExpression[]): JSExpression[] {
  if (childExprs.length === 0) return childExprs;
  if (!childExprs.some(expr => exprContainsComponentCall(expr))) return childExprs;
  return childExprs.map(expr => {
    if (exprContainsComponentCall(expr)) {
      // This child is a DOM producer ($_tag/$_c/$_dc/$_each…). Wrap it in a
      // lazy thunk and MARK it so hosts can identify it via a runtime predicate
      // instead of `.toString()` source-sniffing (which false-negatives under
      // minification — the $_* imports are renamed to short locals). Don't
      // double-wrap an already-arrow child; mark it in place.
      const thunk = expr.type === 'arrow' ? expr : B.getter(expr, expr.sourceRange);
      // A `<:name>` named-block child produces `$_tag(':name', …)`. Mark it
      // with $_nbt(thunk, 'name') — a superset of $_nt that also records the
      // slot name — so the host reads `getNamedBlockName(fn)` for BOTH the
      // "is a named block?" test and the name, instead of source-sniffing
      // `$_tag(':`. (`isNodeThunk` stays true: $_nbt sets the node-thunk flag
      // too, since the factory must still be invoked to yield its marker.)
      const namedBlockName = namedBlockNameFromExpr(expr);
      if (namedBlockName !== null) {
        return B.call(
          B.id(SYMBOLS.NAMED_BLOCK_THUNK),
          [thunk, B.stringSingle(namedBlockName)],
          expr.sourceRange,
        );
      }
      return B.call(B.id(SYMBOLS.NODE_THUNK), [thunk], expr.sourceRange);
    }
    return expr;
  });
}

/**
 * If `expr` is (or wraps) a `$_tag(':name', …)` producer — the shape a compat
 * `<:name>` named block compiles to — return the slot name (without the leading
 * `:`); otherwise null. Unwraps an arrow/getter thunk to reach the producing
 * call so it works whether or not the child has already been wrapped.
 */
function namedBlockNameFromExpr(expr: JSExpression): string | null {
  let target: JSExpression = expr;
  if (target.type === 'arrow' && target.expression) {
    target = target.body as JSExpression;
  }
  if (target.type === 'reactiveGetter') {
    target = target.expression;
  }
  if (target.type !== 'call') return null;
  const callee = target.callee;
  const calleeName =
    callee.type === 'identifier'
      ? callee.name
      : callee.type === 'runtimeRef'
        ? callee.symbol
        : null;
  if (calleeName !== SYMBOLS.TAG) return null;
  const first = target.arguments[0];
  if (
    first &&
    first.type === 'literal' &&
    typeof first.value === 'string' &&
    first.value.startsWith(':')
  ) {
    return first.value.slice(1);
  }
  return null;
}

/**
 * Check if a JSExpression is or contains a call to $_tag or $_c.
 * Used in compat mode to determine which children need lazy wrapping.
 */
function exprContainsComponentCall(expr: JSExpression): boolean {
  if (expr.type === 'call') {
    const callee = expr.callee;
    if (callee.type === 'identifier') {
      if (callee.name === SYMBOLS.TAG || callee.name === SYMBOLS.COMPONENT ||
          callee.name === SYMBOLS.DYNAMIC_COMPONENT) {
        return true;
      }
    }
    // Check arguments recursively
    for (const arg of expr.arguments) {
      if (exprContainsComponentCall(arg)) return true;
    }
  }
  if (expr.type === 'array' || expr.type === 'formattedArray') {
    for (const el of expr.elements) {
      if (exprContainsComponentCall(el)) return true;
    }
  }
  if (expr.type === 'reactiveGetter') {
    return exprContainsComponentCall(expr.expression);
  }
  if (expr.type === 'arrow' && expr.expression) {
    return exprContainsComponentCall(expr.body as JSExpression);
  }
  return false;
}
