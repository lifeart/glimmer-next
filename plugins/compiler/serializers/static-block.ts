/**
 * Static-Block Fast Path Serializer ({{#each}} bodies)
 *
 * When an each-body qualifies — a single plain-element root whose dynamic
 * parts are limited to attribute/property/class bindings, `{{on}}` event
 * bindings and sole-child text interpolations — the each serializer emits, in
 * ADDITION to the normal body callback (kept as the runtime fallback):
 *
 *   $_blk('<tr class="static">…</tr>', [{p: [0], k: "text"}, …])
 *   (item, index, ctx) => [v0, v1, …]
 *
 * The runtime (src/core/static-block.ts) then builds each row with
 * `cloneNode(true)` + a child-index path walk to the slot nodes, instead of
 * per-element `$_tag` calls. Slot values are the EXACT expressions the
 * normal serializer would have emitted for those dynamic positions, and the
 * runtime wires them through the same `$prop`/`$attr`/`$ev` helpers `_DOM`
 * uses — reactivity semantics are identical, only static DOM construction
 * changes. See RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A1 / §4.
 *
 * Qualification is deliberately conservative. The block HTML is parsed via
 * `<template>.innerHTML`, so ANY construct whose parse could diverge from
 * the imperative per-element build (foster parenting, implied elements,
 * auto-closing, RAWTEXT/RCDATA content, foreign content) bails. A bail emits
 * nothing extra — the normal body emission is byte-identical to before.
 */

import type {
  HBSControlExpression,
  HBSNode,
  SerializedValue,
} from '../types';
import { isHBSNode, isSerializedValue, isRuntimeTag } from '../types';
import type { CompilerContext } from '../context';
import { SYMBOLS } from './symbols';
import { buildValue, buildPathExpression } from './value';
import { buildEventHandlerExpr } from './element';
import { B, type JSExpression, type JSProperty } from '../builder';

export type StaticBlockSlotKind = 'text' | 'attr' | 'prop' | 'class' | 'event';

export interface StaticBlockSlotSpec {
  /** child-index path from the block root ([] = the root element itself) */
  readonly path: readonly number[];
  readonly kind: StaticBlockSlotKind;
  /** attribute / property / event name (unset for text and class slots) */
  readonly name?: string;
  /** the dynamic value — built into a JSExpression later, inside the
   * block-param scope, via buildStaticBlockValueExprs */
  readonly value: SerializedValue;
}

export interface StaticBlockParts {
  readonly html: string;
  readonly slots: readonly StaticBlockSlotSpec[];
}

// ---------------------------------------------------------------------------
// HTML-parser safety tables
// ---------------------------------------------------------------------------

/**
 * Tags that are never safe to bake into block HTML:
 * - foreign content / namespace switches (svg, math, foreignObject) — the
 *   block parses in HTML context;
 * - table machinery (implied tbody, foster parenting) — except `tr`/`td`/`th`,
 *   which ARE supported in the specific root positions `<template>` parsing
 *   handles (see nesting rules below);
 * - select machinery (content filtering, option auto-close);
 * - RAWTEXT / RCDATA / parser-special elements (script, style, textarea, …);
 * - document structure tags the template parser ignores;
 * - `pre`/`listing` (parser drops a leading newline `_DOM` would keep);
 * - `image` (parser rewrites it to `img`).
 */
const UNSAFE_TAGS = new Set([
  'html', 'head', 'body', 'frameset', 'frame',
  'table', 'thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col',
  'select', 'option', 'optgroup',
  'script', 'style', 'template', 'title', 'textarea', 'xmp', 'iframe',
  'noembed', 'noframes', 'noscript', 'plaintext',
  'pre', 'listing', 'image',
  'svg', 'math', 'foreignobject',
]);

/** Void elements — serialized without a closing tag; must have no content. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Start tags that implicitly close an open `<p>` element ("in body" parser
 * rules). A `<p>` parent with such a child would be restructured by the
 * parser while `_DOM` nests it verbatim — bail.
 */
const P_CLOSING_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl',
  'dd', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
  'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
]);

/**
 * Elements whose nested re-open triggers parser intervention anywhere in the
 * open-element/formatting stack (adoption agency for `a`/`nobr`, scope-close
 * for `button`, ignored nested `form`). Bail when an ancestor of the same
 * tag exists.
 */
const STACK_SCOPED_TAGS = new Set(['a', 'button', 'form', 'nobr']);

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** plain lowercase HTML tag (excludes components, custom elements, paths) */
const SAFE_TAG_RE = /^[a-z][a-z0-9]*$/;

/** attribute names safe to serialize literally into the HTML chunk */
const SAFE_ATTR_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_:.-]*$/;

// ---------------------------------------------------------------------------
// HTML escaping (exact-round-trip: parsed result === what _DOM would write)
// ---------------------------------------------------------------------------

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function escapeAttrValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
}

// ---------------------------------------------------------------------------
// Extraction (pure inspection — NO CompilerContext mutation, so a bail is
// guaranteed byte-identical to not having the fast path at all)
// ---------------------------------------------------------------------------

interface WalkState {
  html: string[];
  slots: StaticBlockSlotSpec[];
}

/**
 * Try to extract a static-block description from an each-control's children.
 * Returns null (bail) unless the body is exactly one qualifying element.
 */
export function extractStaticBlock(
  control: HBSControlExpression
): StaticBlockParts | null {
  const children = control.children.filter(
    (child): child is NonNullable<typeof child> => child !== null
  );
  // single element root only (multi-root / text / interpolation roots bail)
  if (children.length !== 1) return null;
  const root = children[0];
  if (typeof root === 'string') return null;
  if (isSerializedValue(root)) return null;
  if (!isHBSNode(root)) return null;

  const state: WalkState = { html: [], slots: [] };
  if (!walkElement(root, [], null, new Set(), state)) {
    return null;
  }
  return { html: state.html.join(''), slots: state.slots };
}

function hasNul(value: string): boolean {
  return value.indexOf('\u0000') !== -1;
}

function walkElement(
  node: HBSNode,
  path: readonly number[],
  parentTag: string | null,
  scopedAncestors: Set<string>,
  state: WalkState
): boolean {
  const tag = node.tag;
  if (isRuntimeTag(tag)) return false;
  if (typeof tag !== 'string' || !SAFE_TAG_RE.test(tag)) return false;
  if (UNSAFE_TAGS.has(tag)) return false;
  // Context-sensitive placement: <template> content parsing handles tr/td/th
  // at the block ROOT (the "in template" insertion mode reprocesses them in
  // the right table mode), and td/th inside tr — anywhere else the parser
  // ignores or relocates them.
  if (tag === 'tr' && parentTag !== null) return false;
  if ((tag === 'td' || tag === 'th') && parentTag !== null && parentTag !== 'tr') {
    return false;
  }
  if (parentTag === 'tr' && tag !== 'td' && tag !== 'th') return false;
  if (parentTag === 'p' && P_CLOSING_TAGS.has(tag)) return false;
  if (tag === 'li' && parentTag === 'li') return false;
  if ((tag === 'dd' || tag === 'dt') && (parentTag === 'dd' || parentTag === 'dt')) {
    return false;
  }
  if (STACK_SCOPED_TAGS.has(tag) && scopedAncestors.has(tag)) return false;
  if (HEADING_TAGS.has(tag) && parentTag !== null && HEADING_TAGS.has(parentTag)) {
    return false;
  }
  if (node.blockParams.length > 0) return false;

  const isVoid = VOID_TAGS.has(tag);

  // ----- attributes (literal strings bake; everything else becomes a slot)
  const bakedAttrs: string[] = [];
  const attrSlots: StaticBlockSlotSpec[] = [];
  const classModifiers: SerializedValue[] = [];
  const seenAttrNames = new Set<string>();
  for (const [name, value] of node.attributes) {
    if (name === '...attributes') return false;
    if (name === 'class') {
      // mirrors buildTagProps: class attributes route through the
      // classNameModifiers/$prop('className') path, not setAttribute
      classModifiers.push(value);
      continue;
    }
    // Duplicate attr names: _DOM applies them in order (last write wins for
    // dynamics); a baked duplicate would invert that (HTML keeps the FIRST
    // parsed occurrence). Bail.
    if (seenAttrNames.has(name)) return false;
    seenAttrNames.add(name);
    if (
      value.kind === 'literal' &&
      typeof value.value === 'string' &&
      SAFE_ATTR_NAME_RE.test(name) &&
      !hasNul(value.value)
    ) {
      bakedAttrs.push(` ${name}="${escapeAttrValue(value.value)}"`);
    } else {
      attrSlots.push({ path, kind: 'attr', name, value });
    }
  }

  // ----- properties (key '' = class modifier; the rest become prop slots)
  const propSlots: StaticBlockSlotSpec[] = [];
  for (const [name, value] of node.properties) {
    if (name === '') {
      classModifiers.push(value);
      continue;
    }
    // shadow DOM toggle is handled structurally by _DOM — bail
    if (name === 'shadowrootmode') return false;
    propSlots.push({ path, kind: 'prop', name, value });
  }

  // ----- class (single modifier only — the multi-class merge formula of
  // mergeClassModifiers is out of scope for v1)
  if (classModifiers.length > 1) return false;
  let bakedClass = '';
  let classSlot: StaticBlockSlotSpec | null = null;
  if (classModifiers.length === 1) {
    const value = classModifiers[0];
    if (
      value.kind === 'literal' &&
      typeof value.value === 'string' &&
      !hasNul(value.value)
    ) {
      bakedClass = ` class="${escapeAttrValue(value.value)}"`;
    } else {
      classSlot = { path, kind: 'class', value };
    }
  }

  // ----- events ('@oncreated' = modifier → bail; '@textContent' = the
  // sole-child text optimization; anything else is a real DOM event)
  const eventSlots: StaticBlockSlotSpec[] = [];
  let bakedText: string | null = null;
  let sawTextContent = false;
  for (const [name, handler] of node.events) {
    if (name === '@oncreated') return false;
    if (name === '@textContent') {
      if (sawTextContent) return false;
      sawTextContent = true;
      if (handler.kind === 'literal') {
        const lv = handler.value;
        if (lv === null || lv === undefined) {
          // mirrors $ev's isEmpty skip — nothing to write
          continue;
        }
        const text = String(lv);
        if (hasNul(text)) return false;
        // tr is the only table-context element we allow; baking
        // non-whitespace text into it would be foster-parented out by the
        // parser (a text SLOT is fine — textContent applies post-parse)
        if (tag === 'tr' && /\S/.test(text)) return false;
        bakedText = escapeText(text);
      } else {
        // preserves the event-array position so slot application order
        // matches _DOM's $ev loop order exactly
        eventSlots.push({ path, kind: 'text', value: handler });
      }
      continue;
    }
    eventSlots.push({ path, kind: 'event', name, value: handler });
  }

  // ----- children
  const children = node.children.filter(
    (child): child is NonNullable<typeof child> => child !== null
  );
  if (sawTextContent && children.length > 0) return false;
  if (isVoid && (children.length > 0 || sawTextContent)) return false;

  // open tag + slots (per-element slot order mirrors _DOM: events/text first,
  // then attrs, then props, then class — destructor order parity)
  state.html.push(`<${tag}${bakedAttrs.join('')}${bakedClass}>`);
  state.slots.push(...eventSlots, ...attrSlots, ...propSlots);
  if (classSlot !== null) state.slots.push(classSlot);

  if (isVoid) {
    // void elements: no closing tag (`</br>` would parse as a SECOND <br>)
    return true;
  }

  if (bakedText !== null) {
    state.html.push(bakedText);
  } else if (children.length > 0) {
    // child-node indices count text runs and elements exactly the way the
    // HTML parser will materialize them (adjacent strings collapse into ONE
    // text node; empty runs produce none)
    let nodeIndex = 0;
    let textRun = '';
    const flushText = (): boolean => {
      if (textRun === '') return true;
      if (hasNul(textRun)) return false;
      // tr is the only table-context element we allow; non-whitespace text
      // inside it would be foster-parented out of the row by the parser
      if (tag === 'tr' && /\S/.test(textRun)) return false;
      state.html.push(escapeText(textRun));
      textRun = '';
      nodeIndex++;
      return true;
    };
    for (const child of children) {
      if (typeof child === 'string') {
        textRun += child;
        continue;
      }
      // interpolation mixed with siblings (the sole-child case was already
      // folded into '@textContent'), nested control flow, components — bail
      if (isSerializedValue(child)) return false;
      if (!isHBSNode(child)) return false;
      if (!flushText()) return false;
      const isScoped = STACK_SCOPED_TAGS.has(tag);
      if (isScoped) scopedAncestors.add(tag);
      const ok = walkElement(
        child,
        [...path, nodeIndex],
        tag,
        scopedAncestors,
        state
      );
      if (isScoped) scopedAncestors.delete(tag);
      if (!ok) return false;
      nodeIndex++;
    }
    if (!flushText()) return false;
  }

  state.html.push(`</${tag}>`);
  return true;
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

/**
 * Build the positional slot-value expressions. MUST be called inside the
 * each block-param scope frame (the caller manages enter/exitScope), so the
 * emitted expressions are identical to what the normal body serializer
 * produces for the same bindings.
 */
export function buildStaticBlockValueExprs(
  ctx: CompilerContext,
  parts: StaticBlockParts,
  ctxName: string
): JSExpression[] {
  return parts.slots.map((slot) => {
    if (slot.kind === 'event') {
      return buildEventHandlerExpr(ctx, slot.name!, slot.value, ctxName);
    }
    if (slot.kind === 'text') {
      // mirrors buildEvents' TEXT_CONTENT special case ('1' is the runtime
      // EVENT_TYPE.TEXT_CONTENT discriminator)
      if (slot.value.kind === 'path') {
        return buildPathExpression(
          ctx,
          slot.value,
          ctx.flags.IS_GLIMMER_COMPAT_MODE,
          ctxName,
          { preferCellValue: true }
        );
      }
      return buildEventHandlerExpr(ctx, '1', slot.value, ctxName);
    }
    // attr / prop / class — exactly what buildTupleArray feeds $_tag props
    return buildValue(ctx, slot.value, ctxName);
  });
}

/**
 * Build the `$_blk('<html>', [{p, k, n?}, …])` block-definition expression.
 * `$_blk` memoizes the parsed `<template>` per (html, document) at runtime,
 * so emitting the call inline in the `$_each` args parses the HTML once.
 */
export function buildStaticBlockDefExpr(parts: StaticBlockParts): JSExpression {
  const slotObjects = parts.slots.map((slot) => {
    const props: JSProperty[] = [
      B.prop('p', B.array(slot.path.map((index) => B.num(index)))),
      B.prop('k', B.string(slot.kind)),
    ];
    if (slot.name !== undefined) {
      props.push(B.prop('n', B.string(slot.name)));
    }
    return B.object(props);
  });
  return B.call(B.id(SYMBOLS.BLOCK), [
    B.string(parts.html),
    B.array(slotObjects),
  ]);
}
