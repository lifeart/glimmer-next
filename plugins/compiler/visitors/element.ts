/**
 * Element Node Visitor
 *
 * Handles element and component nodes in the template AST.
 */

import type { ASTv1 } from '@glimmer/syntax';
import type { CompilerContext, VisitFn } from '../context';
import type {
  HBSNode,
  AttributeTuple,
  PropertyTuple,
  EventTuple,
  HBSChild,
  SerializedValue,
  SourceRange,
} from '../types';
import { literal, helper, getter, isSerializedValue, runtimeTag } from '../types';
import { getNodeRange, serializeValueToString, getAttributeNameRange, getPathExpressionString, getElementBlockParamRanges } from './utils';
import { withElementContext, addWarning } from '../context';
import { SYMBOLS, INTERNAL_HELPERS } from '../serializers/symbols';

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
 * Attributes that should be treated as HTML attributes (not properties).
 */
const HTML_ATTRIBUTES = new Set([
  'class',
  'id',
  'href',
  'src',
  'alt',
  'title',
  'type',
  'name',
  // Note: 'value' is intentionally NOT here - it should be a property
  // for proper reactivity with input elements and user input syncing
  'placeholder',
  'for',
  'role',
  'aria-*',
  'data-*',
  // indeterminate is a property-only in DOM, but we treat it as attribute
  // so hasAttribute works in tests (it won't make checkbox indeterminate though)
  'indeterminate',
]);

/**
 * Boolean attributes that don't need a value.
 */
const BOOLEAN_ATTRIBUTES = new Set([
  'disabled',
  'checked',
  'readonly',
  'required',
  'autofocus',
  'multiple',
  'selected',
  'hidden',
  'open',
  // Form attributes
  'formnovalidate',
  'novalidate',
  // Media attributes
  'muted',
  'playsinline',
  'autoplay',
  'controls',
  'loop',
  // List attributes
  'reversed',
  // Frame attributes
  'allowfullscreen',
  // Other
  'default',
  'defer',
  'async',
  'nomodule',
  'ismap',
  'itemscope',
  'inert',
  'translate',
  'contenteditable',
  // Note: 'indeterminate' is NOT a boolean attribute - it's a DOM property only
  // and should be set via attribute for hasAttribute to work
]);

/**
 * Property name mappings (HTML attr -> DOM property).
 */
const PROPERTY_MAPPINGS: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  readonly: 'readOnly',
  tabindex: 'tabIndex',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  maxlength: 'maxLength',
  cellpadding: 'cellPadding',
  cellspacing: 'cellSpacing',
  usemap: 'useMap',
  frameborder: 'frameBorder',
  contenteditable: 'contentEditable',
};

/**
 * Event type constants.
 */
const EVENT_TYPE = {
  ON_CREATED: '@oncreated',
  TEXT_CONTENT: '@textContent',
} as const;

/**
 * Set of HTML event names that can appear as on<event> attributes.
 * Used in compat mode to transform onclick={{expr}} → {{on "click" expr}}.
 */
const HTML_EVENT_NAMES = new Set([
  'click', 'mousedown', 'mouseup', 'mousemove', 'mouseenter', 'mouseleave',
  'keydown', 'keyup', 'keypress', 'input', 'change', 'submit',
  'focus', 'blur', 'focusin', 'focusout',
  'touchstart', 'touchend', 'touchmove',
]);

/**
 * Check if an attribute name is an HTML attribute (vs property).
 * Note: @-prefixed args are also treated as attributes for component serialization,
 * except for special event-like attributes (@oncreated, @textContent).
 */
function isAttribute(name: string): boolean {
  if (HTML_ATTRIBUTES.has(name)) return true;
  if (name.startsWith('aria-')) return true;
  if (name.startsWith('data-')) return true;
  // Special @-prefixed attributes that become events
  if (name === '@oncreated' || name === '@textContent') return false;
  if (name.startsWith('@')) return true; // Component args go in attributes
  if (name === '...attributes') return true; // Splat attributes
  return false;
}

/**
 * Check if element has a stable child (for DOM stability optimization).
 */
function hasStableChild(element: ASTv1.ElementNode): boolean {
  return element.children.some(
    (child) => child.type === 'ElementNode' || child.type === 'TextNode'
  );
}

/**
 * Check if a tag name likely refers to a component (vs a standard element).
 * Standard components start with uppercase or contain dots/paths.
 */
function isComponentName(name: string): boolean {
  // Starts with uppercase (PascalCase component)
  if (name[0] >= 'A' && name[0] <= 'Z') return true;
  // Contains a dot (Path-based component)
  if (name.includes('.')) return true;
  // Starts with @ (Argument-based component)
  if (name.startsWith('@')) return true;
  // Special namespaced components (like <:named>)
  if (name.startsWith(':')) return true;
  return false;
}

/**
 * Visit an ElementNode.
 *
 * @param ctx - The compiler context
 * @param node - The ElementNode to visit
 */
export function visitElement(
  ctx: CompilerContext,
  node: ASTv1.ElementNode
): HBSNode {
  const range = getNodeRange(node);
  let actualTag = node.tag;

  // In compat mode, transform Foo::Bar namespaced components to foo--bar kebab-case.
  // The Glimmer parser preserves :: in tag names, so we convert here.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && actualTag.indexOf('::') !== -1) {
    actualTag = transformNamespacedTag(actualTag);
  }

  // In compat mode, transform known PascalCase built-in component names to kebab-case.
  // e.g. <LinkTo> → <link-to>, <Outlet> → <outlet>
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    actualTag = transformPascalToKebab(actualTag);
    // Mutate node.tag so downstream processing (namespace checks, etc.) sees the kebab name
    (node as any).tag = actualTag;
  }

  // In compat mode, add @__hasBlock__="default" to empty component invocations.
  // <Foo></Foo> gets the marker; self-closing <Foo /> does not.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE && !node.selfClosing && node.children.length === 0) {
    if (isComponentName(actualTag) || actualTag.includes('-')) {
      const hasMarker = node.attributes.some(a => a.name === '@__hasBlock__');
      if (!hasMarker) {
        node.attributes.push({
          type: 'AttrNode',
          name: '@__hasBlock__',
          value: {
            type: 'TextNode',
            chars: 'default',
            loc: node.loc,
          } as ASTv1.TextNode,
          loc: node.loc,
        } as ASTv1.AttrNode);
      }
    }
  }

  // Manual component name customization for traceability
  if (ctx.customizeComponentName && isComponentName(actualTag)) {
    actualTag = ctx.customizeComponentName(actualTag);
  }

  // Handle namespace wrappers (math, svg)
  if (node.tag === 'math' || node.tag === 'svg') {
    return visitNamespacedElement(ctx, node, range);
  }

  // Handle foreignObject (HTML inside SVG)
  if (node.tag === 'foreignObject') {
    return visitForeignObject(ctx, node, range);
  }

  // Restore original tag names for wrapped elements
  if (node.tag === '__wrapped_math__') {
    actualTag = 'math';
  } else if (node.tag === '__wrapped_svg__') {
    actualTag = 'svg';
  }

  // In Ember compat mode, transform onclick={{expr}} attributes to {{on "click" expr}} modifiers.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    rewriteOnEventAttributes(node);
  }

  // In Ember compat mode, mark attributes after ...attributes as local overrides.
  if (ctx.flags.IS_GLIMMER_COMPAT_MODE) {
    rewriteSplatLocalOverrides(node);
  }

  // Add block params to a fresh scope frame so nested elements with matching
  // block-param names shadow rather than clobber the outer binding.
  ctx.scopeTracker.enterScope('element-block');
  for (const param of node.blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Visit children
  const children = getVisitChildren(ctx)(ctx, node.children);

  // Exit scope, restoring outer bindings.
  ctx.scopeTracker.exitScope();

  // Process style.* attributes
  const { styleEvents, regularAttrs } = processStyleAttributes(ctx, node);

  // Check for splat attributes (...attributes) - needed for class merging
  const hasSplatAttrs = node.attributes.some(attr => attr.name === '...attributes');
  const blockParamRanges = getElementBlockParamRanges(node);

  // Build the HBSNode
  const attributes = processAttributes(ctx, regularAttrs, hasSplatAttrs);
  const properties = processProperties(ctx, regularAttrs, hasSplatAttrs);
  const baseEvents = processEvents(ctx, node, styleEvents);

  // Optimize text children (pure function)
  const { children: optimizedChildren, additionalEvents } = optimizeTextChild(actualTag, children);
  const events = [...baseEvents, ...additionalEvents];

  // Compute tag name source range: starts after '<', spans ORIGINAL tag name length
  // This preserves source mapping integrity even if the name is customized.
  const tagRange = range ? {
    start: range.start + 1,
    end: range.start + 1 + node.tag.length,
  } : undefined;

  // Manual component name customization for traceability
  if (ctx.customizeComponentName && isComponentName(actualTag)) {
    actualTag = ctx.customizeComponentName(actualTag);
  }

  const hbsNode: HBSNode = {
    _nodeType: 'element',
    tag: actualTag,
    selfClosing: node.selfClosing,
    blockParams: node.blockParams,
    blockParamRanges: blockParamRanges ?? undefined,
    hasStableChild: hasStableChild(node),
    attributes,
    properties,
    events,
    children: optimizedChildren,
    sourceRange: range,
    tagRange,
  };

  return hbsNode;
}

/**
 * Handle math/svg elements with namespace context.
 * Wraps the element in a namespace provider component.
 */
function visitNamespacedElement(
  ctx: CompilerContext,
  node: ASTv1.ElementNode,
  range?: SourceRange
): HBSNode {
  const namespace = node.tag === 'math' ? 'mathml' : 'svg';
  const providerTag = node.tag === 'math'
    ? runtimeTag(SYMBOLS.MATH_NAMESPACE)
    : runtimeTag(SYMBOLS.SVG_NAMESPACE);

  return withElementContext(
    ctx,
    { namespace, parentNamespace: ctx.elementContext.namespace },
    () => {
      // Process the actual element within the namespace context
      const clonedNode = { ...node, tag: `__wrapped_${node.tag}__` };
      const innerElement = visitElementInner(ctx, clonedNode as ASTv1.ElementNode, range);

      // Return wrapper node that contains the namespace provider
      // The provider is a component that sets up the namespace context
      return {
        _nodeType: 'element',
        tag: providerTag,
        selfClosing: false,
        blockParams: [],
        hasStableChild: true,
        attributes: [],
        properties: [],
        events: [],
        children: [innerElement],
        sourceRange: range,
      };
    }
  );
}

/**
 * Handle foreignObject element (switches back to HTML namespace for children).
 * foreignObject is an SVG element, but its children should be in HTML namespace.
 */
function visitForeignObject(
  ctx: CompilerContext,
  node: ASTv1.ElementNode,
  range?: SourceRange
): HBSNode {
  // Process children in HTML namespace context
  const childrenInHtmlContext = withElementContext(
    ctx,
    { namespace: 'html', parentNamespace: ctx.elementContext.namespace },
    () => getVisitChildren(ctx)(ctx, node.children)
  );

  // Process style attributes
  const { styleEvents, regularAttrs } = processStyleAttributes(ctx, node);

  // Build foreignObject as SVG element but with HTML-namespaced children wrapper
  const attributes = processAttributes(ctx, regularAttrs);
  const properties = processProperties(ctx, regularAttrs);
  const events = processEvents(ctx, node, styleEvents);

  // If there are children, wrap them with HTMLProvider
  const wrappedChildren = childrenInHtmlContext.length > 0 ? [{
    _nodeType: 'element' as const,
    tag: runtimeTag(SYMBOLS.HTML_NAMESPACE),
    selfClosing: false,
    blockParams: [],
    hasStableChild: true,
    attributes: [],
    properties: [],
    events: [],
    children: childrenInHtmlContext,
    sourceRange: undefined,
  } as HBSNode] : [];

  return {
    _nodeType: 'element',
    tag: 'foreignObject',
    selfClosing: node.selfClosing,
    blockParams: [],
    hasStableChild: hasStableChild(node),
    attributes,
    properties,
    events,
    children: wrappedChildren,
    sourceRange: range,
  };
}

/**
 * Inner element visitor (after namespace handling).
 */
function visitElementInner(
  ctx: CompilerContext,
  node: ASTv1.ElementNode,
  range?: SourceRange
): HBSNode {
  let actualTag = node.tag;

  // Restore original tag names
  if (node.tag === '__wrapped_math__') {
    actualTag = 'math';
  } else if (node.tag === '__wrapped_svg__') {
    actualTag = 'svg';
  }

  // NOTE: rewriteOnEventAttributes and rewriteSplatLocalOverrides are called
  // in visitElement (the outer entry point), not here, to avoid double-processing.

  // Add block params to a fresh scope frame so nested elements with matching
  // block-param names shadow rather than clobber the outer binding.
  ctx.scopeTracker.enterScope('element-block');
  for (const param of node.blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Visit children
  const children = getVisitChildren(ctx)(ctx, node.children);

  // Exit scope, restoring outer bindings.
  ctx.scopeTracker.exitScope();

  // Process attributes
  const { styleEvents, regularAttrs } = processStyleAttributes(ctx, node);
  const attributes = processAttributes(ctx, regularAttrs);
  const properties = processProperties(ctx, regularAttrs);
  const baseEvents = processEvents(ctx, node, styleEvents);

  // Optimize text children (pure function)
  const { children: optimizedChildren, additionalEvents } = optimizeTextChild(actualTag, children);
  const events = [...baseEvents, ...additionalEvents];

  // Compute tag name source range for the original tag (handles wrapped names)
  const tagRange = range ? {
    start: range.start + 1,
    end: range.start + 1 + node.tag.length,
  } : undefined;

  // Manual component name customization for traceability
  if (ctx.customizeComponentName && isComponentName(actualTag)) {
    actualTag = ctx.customizeComponentName(actualTag);
  }

  return {
    _nodeType: 'element',
    tag: actualTag,
    selfClosing: node.selfClosing,
    blockParams: node.blockParams,
    hasStableChild: hasStableChild(node),
    attributes,
    properties,
    events,
    children: optimizedChildren,
    sourceRange: range,
    tagRange,
  };
}

/**
 * Warn on reserved binding names.
 */
function warnOnReservedBinding(ctx: CompilerContext, name: string): void {
  const reserved = ['window', 'document', 'console', 'this'];
  if (reserved.includes(name)) {
    addWarning(ctx, `"${name}" is a reserved binding name`, 'W002');
  }
}

/**
 * Process style.* attributes into events.
 */
function processStyleAttributes(
  ctx: CompilerContext,
  node: ASTv1.ElementNode
): {
  styleEvents: EventTuple[];
  regularAttrs: ASTv1.AttrNode[];
} {
  const styleAttrs = node.attributes.filter((attr) =>
    attr.name.startsWith('style.')
  );
  const regularAttrs = node.attributes.filter(
    (attr) => !attr.name.startsWith('style.')
  );

  const styleEvents: EventTuple[] = styleAttrs.map((attr) => {
    const propertyName = attr.name.split('.').pop()!;
    const value = visitAttributeValue(ctx, attr.value);
    const attrRange = getNodeRange(attr);
    const nameRange = getAttributeNameRange(attr);
    const propNameRange = nameRange
      ? {
          start: nameRange.start + attr.name.indexOf(propertyName),
          end: nameRange.start + attr.name.indexOf(propertyName) + propertyName.length,
        }
      : undefined;

    const styleHelper = helper(
      INTERNAL_HELPERS.STYLE_SETTER,
      [literal(propertyName, propNameRange), value],
      new Map(),
      attrRange
    );

    return [EVENT_TYPE.ON_CREATED, styleHelper, attrRange];
  });

  return { styleEvents, regularAttrs };
}

/**
 * Process attributes into AttributeTuples.
 * When splat attributes are present, exclude 'class' (it goes to properties for merging).
 */
function processAttributes(
  ctx: CompilerContext,
  attrs: ASTv1.AttrNode[],
  hasSplatAttrs = false
): AttributeTuple[] {
  return attrs
    .filter((attr) => {
      if (!isAttribute(attr.name)) return false;
      // When splat attrs present, class goes through properties for merging
      if (hasSplatAttrs && attr.name === 'class') return false;
      return true;
    })
    .map((attr) => {
      const value = visitAttributeValue(ctx, attr.value);
      const nameRange = getAttributeNameRange(attr);
      return [attr.name, value, getNodeRange(attr), nameRange] as const;
    });
}

/**
 * Check if an attribute should be processed as an event instead of property/attribute.
 */
function isEventAttribute(name: string): boolean {
  return name === '@oncreated' || name === '@textContent';
}

/**
 * Process properties into PropertyTuples.
 * When splat attributes are present, 'class' is added as a property with empty key for merging.
 */
function processProperties(
  ctx: CompilerContext,
  attrs: ASTv1.AttrNode[],
  hasSplatAttrs = false
): PropertyTuple[] {
  const result: PropertyTuple[] = [];

  for (const attr of attrs) {
    // When splat attrs present, class becomes a property with empty key for merging
    if (hasSplatAttrs && attr.name === 'class') {
      const value = visitAttributeValue(ctx, attr.value);
      // Empty key '' triggers class merging in the runtime
      result.push(['', value, getNodeRange(attr)] as const);
      continue;
    }

    // Skip attributes and event attributes
    if (isAttribute(attr.name) || isEventAttribute(attr.name)) {
      continue;
    }

    const value = visitAttributeValue(ctx, attr.value);

    // Handle boolean attributes
    if (
      BOOLEAN_ATTRIBUTES.has(attr.name) &&
      attr.value.type === 'TextNode' &&
      attr.value.chars === ''
    ) {
      const mappedName = PROPERTY_MAPPINGS[attr.name] || attr.name;
      result.push([mappedName, literal(true), getNodeRange(attr)] as const);
      continue;
    }

    const mappedName = PROPERTY_MAPPINGS[attr.name] || attr.name;
    result.push([mappedName, value, getNodeRange(attr)] as const);
  }

  return result;
}

/**
 * Visit an attribute value.
 */
function visitAttributeValue(
  ctx: CompilerContext,
  value: ASTv1.AttrValue
): SerializedValue {
  if (value.type === 'TextNode') {
    return literal(value.chars, getNodeRange(value));
  }

  if (value.type === 'MustacheStatement') {
    // In compat mode, when (has-block) or (has-block-params) is used in attribute
    // position (e.g., name={{(has-block)}}), wrap in (if ... "true" "false") so GXT
    // produces string attribute values instead of booleans which GXT would strip.
    if (ctx.flags.IS_GLIMMER_COMPAT_MODE && value.path.type === 'SubExpression') {
      const subExpr = value.path as ASTv1.SubExpression;
      if (subExpr.path.type === 'PathExpression') {
        const subName = getPathExpressionString(subExpr.path);
        if (subName === 'has-block' || subName === 'has-block-params') {
          const subResult = getVisit(ctx)(ctx, subExpr, false);
          if (subResult !== null && isSerializedValue(subResult)) {
            const range = getNodeRange(value);
            const ifResult = helper('if', [subResult, literal('true'), literal('false')], new Map(), range);
            return getter(ifResult, range);
          }
        }
      }
    }
    // Use wrap=true to ensure helper results are wrapped in getters for reactivity
    // This is critical for dynamic values like {{if condition 'a' 'b'}} or {{fn this.handler arg}}
    const result = getVisit(ctx)(ctx, value, true);
    if (result !== null && isSerializedValue(result)) {
      return result;
    }
    return literal(null);
  }

  if (value.type === 'ConcatStatement') {
    const result = getVisit(ctx)(ctx, value, false);
    if (result !== null && isSerializedValue(result)) {
      return result;
    }
    return literal('');
  }

  return literal(null);
}

/**
 * Process modifiers and events into EventTuples.
 */
function processEvents(
  ctx: CompilerContext,
  node: ASTv1.ElementNode,
  styleEvents: EventTuple[]
): EventTuple[] {
  const events: EventTuple[] = [...styleEvents];

  // Process @oncreated and @textContent attributes as events
  for (const attr of node.attributes) {
    if (attr.name === '@oncreated' || attr.name === '@textContent') {
      const attrRange = getNodeRange(attr);
      const value = visitAttributeValue(ctx, attr.value);

    if (attr.name === '@oncreated') {
      // @oncreated={{handler}} becomes a modifier-like event
      const handlerValue = value && isSerializedValue(value) ? value : literal(null);
      const onCreatedHelper = helper(
        INTERNAL_HELPERS.ON_CREATED_HANDLER,
        [handlerValue],
        new Map(),
        attrRange
      );
      events.push([EVENT_TYPE.ON_CREATED, onCreatedHelper, attrRange]);
    } else {
      // @textContent={{value}} sets text content
      events.push([EVENT_TYPE.TEXT_CONTENT, value, attrRange]);
    }
    }
  }

  for (const mod of node.modifiers) {
    // In compat mode, transform {{(modifier "name" args...) extraArgs...}} in
    // element modifier position by unwrapping the SubExpression:
    // {{(modifier "name" curriedArgs...) extraArgs...}} → {{name curriedArgs... extraArgs...}}
    if (ctx.flags.IS_GLIMMER_COMPAT_MODE && mod.path.type === 'SubExpression') {
      const subExpr = mod.path as ASTv1.SubExpression;
      if (subExpr.path.type === 'PathExpression' && getPathExpressionString(subExpr.path) === 'modifier') {
        const firstName = subExpr.params[0];
        if (firstName && firstName.type === 'StringLiteral') {
          const modRange = getNodeRange(mod);
          const modPathRange = getNodeRange(subExpr.path);
          const realModName = firstName.value;
          // Collect curried args (from SubExpression, after the name) + extra args (from modifier statement)
          const positionalValues: SerializedValue[] = [];
          for (const p of subExpr.params.slice(1)) {
            const result = getVisit(ctx)(ctx, p, false);
            positionalValues.push(result && isSerializedValue(result) ? result : literal(null));
          }
          for (const p of mod.params) {
            const result = getVisit(ctx)(ctx, p, false);
            positionalValues.push(result && isSerializedValue(result) ? result : literal(null));
          }
          const namedMap = new Map<string, SerializedValue>();
          for (const pair of subExpr.hash.pairs) {
            const value = getVisit(ctx)(ctx, pair.value, false);
            if (value && isSerializedValue(value)) namedMap.set(pair.key, value);
          }
          for (const pair of mod.hash.pairs) {
            const value = getVisit(ctx)(ctx, pair.value, false);
            if (value && isSerializedValue(value)) namedMap.set(pair.key, value);
          }
          const modValue = helper(realModName, positionalValues, namedMap, modRange, modPathRange);
          events.push([EVENT_TYPE.ON_CREATED, modValue, modRange]);
          continue;
        }
      }
    }

    if (mod.path.type !== 'PathExpression') continue;

    const modRange = getNodeRange(mod);
    const modPathRange = getNodeRange(mod.path);
    const modName = getPathExpressionString(mod.path);

    if (modName === 'on') {
      // Native event handler
      const eventName = mod.params[0];
      if (eventName?.type === 'StringLiteral') {
        const handler = mod.params[1];
        const handlerResult = handler ? getVisit(ctx)(ctx, handler, false) : null;

        const positionalValues: SerializedValue[] = [];
        if (handlerResult && isSerializedValue(handlerResult)) {
          positionalValues.push(handlerResult);
        } else if (typeof handlerResult === 'string') {
          positionalValues.push(literal(handlerResult));
        } else {
          positionalValues.push(literal(null));
        }

        for (const tailParam of mod.params.slice(2)) {
          const result = getVisit(ctx)(ctx, tailParam, false);
          if (result && isSerializedValue(result)) {
            positionalValues.push(result);
          } else if (typeof result === 'string') {
            positionalValues.push(literal(result));
          } else {
            positionalValues.push(literal(null));
          }
        }

        events.push([
          eventName.value,
          helper(INTERNAL_HELPERS.ON_HANDLER, positionalValues, new Map(), modRange),
          modRange,
        ]);
      }
    } else {
      // Custom modifier - preserve positional param source ranges
      // by using structured helper() value instead of raw string.
      // The element serializer (buildEvents) wraps this in ($n) => mod($n, ...args)
      const positionalValues: SerializedValue[] = mod.params.map((p) => {
        const result = getVisit(ctx)(ctx, p, false);
        if (result && isSerializedValue(result)) return result;
        return literal(null);
      });
      const namedMap = new Map<string, SerializedValue>();
      for (const pair of mod.hash.pairs) {
        const value = getVisit(ctx)(ctx, pair.value, false);
        if (value && isSerializedValue(value)) {
          namedMap.set(pair.key, value);
        }
      }
      const modValue = helper(modName, positionalValues, namedMap, modRange, modPathRange);
      events.push([EVENT_TYPE.ON_CREATED, modValue, modRange]);
    }
  }

  return events;
}

/**
 * Result of text child optimization.
 */
interface TextChildOptimization {
  children: HBSChild[];
  additionalEvents: EventTuple[];
}

/**
 * Optimize single text child into textContent event.
 * Returns both the optimized children array and any additional events to add.
 * This is a pure function - it does not mutate any inputs.
 */
function optimizeTextChild(
  tag: string,
  children: HBSChild[]
): TextChildOptimization {
  const noChange = { children, additionalEvents: [] };

  if (children.length !== 1) return noChange;

  const child = children[0];
  if (typeof child !== 'string' && !isSerializedValue(child)) return noChange;

  // Don't optimize for special tags or slots
  if (tag.startsWith(':') || tag.toLowerCase() !== tag) return noChange;

  // Don't optimize if child contains special symbols
  const childStr = typeof child === 'string' ? child : serializeValueToString(child);
  if (childStr.includes('SLOT') || childStr.includes('...')) return noChange;

  // Return empty children and textContent event
  const textValue = typeof child === 'string' ? literal(child) : child;
  return {
    children: [],
    additionalEvents: [[EVENT_TYPE.TEXT_CONTENT, textValue]],
  };
}

// --- Compat mode: onclick={{expr}} → {{on "click" expr}} ---

/**
 * Rewrite on<event> HTML attributes to {{on "event" expr}} modifiers on the AST.
 *
 * The Glimmer parser produces AttrNode for `onclick={{this.handler}}`.
 * We convert matching attrs to ElementModifierStatements so the existing
 * modifier processing in processEvents() handles them as proper event bindings.
 *
 * Only active in IS_GLIMMER_COMPAT_MODE.
 */
function rewriteOnEventAttributes(node: ASTv1.ElementNode): void {
  const attrsToRemove: number[] = [];

  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i]!;
    const name = attr.name.toLowerCase();

    // Match on<eventname> pattern
    if (!name.startsWith('on') || name.length <= 2) continue;
    const eventName = name.slice(2);
    if (!HTML_EVENT_NAMES.has(eventName)) continue;

    // The value must be a MustacheStatement (e.g., onclick={{this.handler}})
    if (attr.value.type !== 'MustacheStatement') continue;

    // Build an {{on "eventName" expr}} modifier
    const mustache = attr.value as ASTv1.MustacheStatement;
    const onModifier: ASTv1.ElementModifierStatement = {
      type: 'ElementModifierStatement',
      path: {
        type: 'PathExpression',
        original: 'on',
        parts: ['on'],
        head: { type: 'VarHead', name: 'on', original: 'on', loc: attr.loc } as any,
        tail: [],
        this: false,
        data: false,
        loc: attr.loc,
      } as ASTv1.PathExpression,
      params: [
        {
          type: 'StringLiteral',
          value: eventName,
          original: eventName,
          loc: attr.loc,
        } as ASTv1.StringLiteral,
        mustache.path as ASTv1.Expression,
      ],
      hash: {
        type: 'Hash',
        pairs: [],
        loc: attr.loc,
      } as ASTv1.Hash,
      loc: attr.loc,
    };

    node.modifiers.push(onModifier);
    attrsToRemove.push(i);
  }

  // Remove converted attributes (reverse order to preserve indices)
  for (let i = attrsToRemove.length - 1; i >= 0; i--) {
    node.attributes.splice(attrsToRemove[i]!, 1);
  }
}

// --- Compat mode: ...attributes local override tracking ---

/**
 * Mark attributes that appear AFTER `...attributes` as local overrides.
 *
 * In Ember, attrs after `...attributes` override forwarded attrs; attrs before
 * are overridden by forwarded values. GXT always gives forwarded attrs priority,
 * so we add a `__splatLocal__` marker attribute listing the attribute names that
 * should override forwarded values. The runtime reads this marker to apply
 * correct precedence.
 *
 * Only active in IS_GLIMMER_COMPAT_MODE.
 */
function rewriteSplatLocalOverrides(node: ASTv1.ElementNode): void {
  // Find the index of ...attributes in the attribute list
  let splatIndex = -1;
  for (let i = 0; i < node.attributes.length; i++) {
    if (node.attributes[i]!.name === '...attributes') {
      splatIndex = i;
      break;
    }
  }

  if (splatIndex === -1) return;

  // Collect attribute names that come AFTER ...attributes
  const localOverrideNames: string[] = [];
  let hasClassAfterSplat = false;

  for (let i = splatIndex + 1; i < node.attributes.length; i++) {
    const attr = node.attributes[i]!;
    const name = attr.name;
    // Skip @-prefixed args and already-existing markers
    if (name.startsWith('@') || name === '__splatLocal__') continue;
    if (name === 'class') {
      hasClassAfterSplat = true;
    } else {
      localOverrideNames.push(name);
    }
  }

  if (localOverrideNames.length === 0 && !hasClassAfterSplat) return;

  // Build marker value: non-class attrs + optional __class__ marker
  const markerParts = [...localOverrideNames];
  if (hasClassAfterSplat) markerParts.push('__class__');

  // Check if __splatLocal__ already exists
  const hasMarker = node.attributes.some(a => a.name === '__splatLocal__');
  if (hasMarker) return;

  // Add __splatLocal__ marker attribute
  node.attributes.push({
    type: 'AttrNode',
    name: '__splatLocal__',
    value: {
      type: 'TextNode',
      chars: markerParts.join(','),
      loc: node.loc,
    } as ASTv1.TextNode,
    loc: node.loc,
  } as ASTv1.AttrNode);
}

// --- Compat mode: PascalCase → kebab-case for known built-in components ---

/**
 * Known PascalCase component names that should be converted to kebab-case.
 */
const PASCAL_TO_KEBAB_MAP: Record<string, string> = {
  LinkTo: 'link-to',
  Outlet: 'outlet',
};

/**
 * Transform known PascalCase built-in component names to kebab-case.
 * e.g. "LinkTo" → "link-to", "Outlet" → "outlet"
 * Unknown PascalCase names are left unchanged.
 */
function transformPascalToKebab(tag: string): string {
  return PASCAL_TO_KEBAB_MAP[tag] ?? tag;
}

/**
 * Transform Foo::Bar namespaced component tags to foo--bar kebab-case.
 * Each PascalCase segment is converted to kebab-case, then joined with '--'.
 */
function transformNamespacedTag(tag: string): string {
  const segments = tag.split('::');
  return segments.map(toKebabCase).join('--');
}

/**
 * Convert a PascalCase string to kebab-case.
 * e.g. "FooBar" → "foo-bar", "HTMLElement" → "html-element"
 */
function toKebabCase(segment: string): string {
  let result = '';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    const upper = ch >= 'A' && ch <= 'Z';
    if (upper) {
      // Insert hyphen before uppercase letter unless at start
      // or previous char is also uppercase and next is uppercase (acronym interior)
      if (i > 0) {
        const prevUpper = segment[i - 1]! >= 'A' && segment[i - 1]! <= 'Z';
        const nextUpper = i + 1 < segment.length && segment[i + 1]! >= 'A' && segment[i + 1]! <= 'Z';
        if (!prevUpper || !nextUpper) {
          result += '-';
        }
      }
      result += ch.toLowerCase();
    } else {
      result += ch;
    }
  }
  return result;
}
