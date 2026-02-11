/**
 * Element and Component Serializers
 *
 * Serializes HBSNode to JavaScript code for DOM elements and components.
 * Uses the CodeBuilder pattern for clean code generation.
 */

import type { CompilerContext } from '../context';
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
import { buildValue, buildPathExpression } from './value';
import { B, serializeJS, type JSExpression, type JSProperty } from '../builder';

// Forward declarations - set from index.ts to avoid circular dependency
let buildChildrenExprs: (ctx: CompilerContext, children: readonly HBSChild[], ctxName: string) => JSExpression[];
let nextCtxName: (ctx: CompilerContext) => string;

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

  // Use formattedArray for children when formatting is enabled and there are children
  const childrenExpr = fmt.options.enabled && childExprs.length > 0
    ? B.formattedArray(childExprs, true)
    : B.array(childExprs);

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

  // Build DOM props for forwarding
  const propsExpr = buildComponentProps(ctx, properties, attrs, node.events, hasSplatAttrs, ctxName);

  // Check if props are empty (no properties, no attrs, no events, no splat)
  const isEmpty = properties.length === 0 && attrs.length === 0 && node.events.length === 0 && !hasSplatAttrs;
  const finalPropsExpr = isEmpty ? B.id(SYMBOLS.EMPTY_DOM_PROPS) : propsExpr;

  const useFormatted = ctx.formatter.options.enabled;

  if (node.selfClosing) {
    // Self-closing component - empty slots object
    const argsCall = buildComponentArgsExpr(ctx, args, B.emptyObject(), finalPropsExpr, ctxName);
    return buildComponentCall(node.tag, argsCall, ctxName, useFormatted, node.sourceRange, node.tagRange);
  }

  // Component with children/slots
  const slotsExpr = buildSlots(ctx, node);
  const argsCall = buildComponentArgsExpr(ctx, args, slotsExpr, finalPropsExpr, ctxName);
  return buildComponentCall(node.tag, argsCall, ctxName, useFormatted, node.sourceRange, node.tagRange);
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
    const elements = [
      B.array([
        B.spread(B.computedMember(B.id(SYMBOLS.LOCAL_FW), B.num(0))),
        B.spread(propsExpr),
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
 * Build a tuple array (attributes, properties).
 * Uses buildValue directly to preserve AST structure.
 * Uses formattedArray when formatting is enabled and there are multiple items.
 */
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
    } else if (handler.kind === 'helper' && eventName === EVENT_TYPE.ON_CREATED) {
      // Modifier handlers are stored as helper() values (kind === 'helper')
      // to preserve positional param source ranges. Build them as:
      // ($n) => modName($n, ...args, {hash}) or
      // ($n) => $__maybeModifier(modName, $n, [...args], {hash})
      handlerExpr = buildModifierExpr(ctx, handler as HelperValue, ctxName);
    } else {
      // Use buildValue directly to preserve AST structure for better code generation
      handlerExpr = buildValue(ctx, handler, ctxName);
    }

    return B.array([B.string(eventName), handlerExpr], range, 'AttrNode');
  });

  // Use formattedArray for better readability when formatting is enabled and there are multiple items
  if (ctx.formatter.options.enabled && items.length > 1) {
    return B.formattedArray(items, true);
  }

  return B.array(items);
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
    const argName = modName.slice(1);
    const needsBracket = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(argName);
    modName = needsBracket
      ? `${SYMBOLS.ARGS_ALIAS}["${argName}"]`
      : `${SYMBOLS.ARGS_ALIAS}.${argName}`;
  }

  // Build positional args with source ranges preserved.
  // For direct modifier calls, paths should be plain references (not reactive getters).
  const positionalExprs = mod.positional.map(arg => {
    if (arg.kind === 'path') {
      return buildPathExpression(ctx, arg, false);
    }
    return buildValue(ctx, arg, ctxName);
  });

  // Build named args object
  const namedProps = [];
  for (const [key, val] of mod.named) {
    namedProps.push(B.prop(key, buildValue(ctx, val, ctxName), false, val.sourceRange));
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

  if (ctx.flags.WITH_MODIFIER_MANAGER) {
    // ($n) => $__maybeModifier(modName, $n, [...positional], {named})
    const namedObj = namedProps.length > 0 ? B.object(namedProps) : B.emptyObject();

    // For known bindings, pass the function reference directly
    // For unknown bindings, pass the name as a string for runtime resolution
    const modRef = isKnownModifier
      ? (typeof modCallee === 'string' ? B.id(modCallee) : modCallee)
      : B.string(mod.name, mod.pathRange);

    const callExpr = B.call(SYMBOLS.MAYBE_MODIFIER, [
      modRef,
      B.id('$n'),
      B.array(positionalExprs),
      namedObj,
    ], mod.sourceRange);
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
    const valueExpr = buildValue(ctx, value, ctxName);
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

    // Add block params to scope tracker during serialization
    for (const param of blockParams) {
      ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
    }

    // Build slot children as JSExpression array (proper tree for correct indentation)
    const slotChildExprs = buildChildrenExprs(ctx, children, sContext);
    const slotArrayExpr = fmt.options.enabled && slotChildExprs.length > 0
      ? B.formattedArray(slotChildExprs, true)
      : B.array(slotChildExprs);

    // Remove block params from scope after serialization
    for (const param of blockParams) {
      ctx.scopeTracker.removeBinding(param);
    }
    const hasBlockParams = blockParams.length > 0;

    // Build the slot function: (ctx, ...blockParams) => [children]
    const params = [
      sContext,
      ...blockParams.map((name, index) => {
        const range = blockParamRanges[index];
        return range ? B.id(name, range) : name;
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
  tag: HBSTag,
  argsExpr: JSExpression,
  ctxName: string,
  formatted?: boolean,
  sourceRange?: import('../types').SourceRange,
  tagRange?: import('../types').SourceRange
): JSExpression {
  // Handle RuntimeTag (namespace providers, dynamic components)
  if (isRuntimeTag(tag)) {
    return B.call(SYMBOLS.COMPONENT, [B.id(tag.symbol), argsExpr, B.id(ctxName)], sourceRange, formatted, 'ElementNode');
  }

  // Check for dynamic component (dotted path like context.V or this.Component)
  const isDynamic = tag.includes('.');

  if (isDynamic) {
    // Wrap in reactive getter for dynamic component paths
    // This allows re-evaluation when the component reference changes
    // Use runtimeRef to preserve source map name for debugger hover
    const tagRef = B.runtimeRef(tag, tagRange);
    const tagGetter = B.reactiveGetter(tagRef, tagRange);
    return B.call(SYMBOLS.DYNAMIC_COMPONENT, [tagGetter, argsExpr, B.id(ctxName)], sourceRange, formatted, 'ElementNode');
  }

  return B.call(SYMBOLS.COMPONENT, [B.id(tag, tagRange, 'ElementNode'), argsExpr, B.id(ctxName)], sourceRange, formatted, 'ComponentNode');
}
