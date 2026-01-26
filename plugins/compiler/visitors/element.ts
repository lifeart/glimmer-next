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
import { literal, helper, isSerializedValue, runtimeTag } from '../types';
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

  // Add block params to scope
  for (const param of node.blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Visit children
  const children = getVisitChildren(ctx)(ctx, node.children);

  // Remove block params from scope
  for (const param of node.blockParams) {
    ctx.scopeTracker.removeBinding(param);
  }

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

  // Add block params to scope
  for (const param of node.blockParams) {
    warnOnReservedBinding(ctx, param);
    ctx.scopeTracker.addBinding(param, { kind: 'block-param', name: param });
  }

  // Visit children
  const children = getVisitChildren(ctx)(ctx, node.children);

  // Remove block params from scope
  for (const param of node.blockParams) {
    ctx.scopeTracker.removeBinding(param);
  }

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
      SYMBOLS.STYLE,
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
