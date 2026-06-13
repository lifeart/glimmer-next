/**
 * Static-Block Fast Path Runtime ({{#each}} bodies)
 *
 * The compiler (plugins/compiler/serializers/static-block.ts) emits
 * `$_blk(html, slots)` for qualifying inline-element each-bodies: the static
 * DOM structure as ONE html chunk plus a positional slot table describing the
 * dynamic positions. The html is parsed ONCE per (template, document) into a
 * shared `<template>` element; every row instance is then produced with
 * `cloneNode(true)` + a firstChild/nextSibling child-index path walk to the
 * slot nodes — instead of per-element `api.element` + per-attr `api.attr`
 * calls through `$_tag`.
 *
 * Reactivity semantics are IDENTICAL to the normal `_DOM` path: slot values
 * are wired through the very same `$prop` / `$attr` / `$ev` helpers `_DOM`
 * uses (resolveBindingValue formula resolution incl. const-collapse +
 * registerLeafOwnersForFormula, the $prop prev-value guard, the textContent
 * fast path, api.addEventListener), and the produced destructors are
 * registered by the caller (BasicListComponent) against the same per-row
 * owner context `_DOM` would have used. Only static DOM construction changes.
 *
 * See RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A1 / §4.
 */
import type { DOMApi } from '@/core/types';
import type { DestructorFn } from '@/core/glimmer/destroyable';
import { $prop, $attr, $ev, EVENT_TYPE } from '@/core/dom';

export interface StaticBlockSlot {
  /**
   * Child-index walk from the block root, resolved with
   * firstChild/nextSibling hops. `[]` = the root element itself;
   * `[1, 0]` = root's 2nd child → its 1st child. Indices count ALL child
   * nodes the compiler baked into the html chunk (it controls the markup,
   * so the indices are exact by construction).
   */
  readonly p: readonly number[];
  readonly k: 'text' | 'attr' | 'prop' | 'class' | 'event';
  /** attribute / property / event name; unset for 'text' and 'class'. */
  readonly n?: string;
}

export interface StaticBlockDef {
  /**
   * Clone the block and wire the positional `values` (matching the slot
   * table) into the slot nodes. Binding destructors are pushed into the
   * caller-owned `destructors` array — the caller registers them against
   * the row owner ctx exactly like `_DOM` does. Returns the root Node.
   */
  create(
    api: DOMApi,
    values: readonly unknown[],
    destructors: DestructorFn[],
  ): Node;
}

/**
 * Shared parse cache: one parsed `<template>` root per (html, document).
 * Keyed by the html string first so every `$_blk` evaluation of the same
 * template literal (the def is re-created per `$_each` call site execution)
 * reuses the same per-document root.
 */
const TEMPLATE_ROOTS: Map<string, WeakMap<Document, Node>> = new Map();

/** Document handle per DOMApi (the api itself doesn't expose its document). */
const DOC_BY_API: WeakMap<DOMApi, Document> = new WeakMap();

function documentFor(api: DOMApi): Document {
  let doc = DOC_BY_API.get(api);
  if (doc === undefined) {
    doc = (api.element('template') as Element).ownerDocument as Document;
    DOC_BY_API.set(api, doc);
  }
  return doc;
}

/** firstChild/nextSibling walk — the cheapest path resolution available. */
function resolvePath(root: Node, path: readonly number[]): Node {
  let node: Node = root;
  for (let i = 0; i < path.length; i++) {
    let child = node.firstChild;
    for (let j = path[i]; j > 0; j--) {
      child = child!.nextSibling;
    }
    if (import.meta.env.DEV) {
      if (!child) {
        throw new Error(
          `static-block: slot path [${path.join(',')}] does not resolve (step ${i})`,
        );
      }
    }
    node = child!;
  }
  return node;
}

class StaticBlock implements StaticBlockDef {
  private html: string;
  private slots: readonly StaticBlockSlot[];
  private roots: WeakMap<Document, Node>;
  constructor(
    html: string,
    slots: readonly StaticBlockSlot[],
    roots: WeakMap<Document, Node>,
  ) {
    this.html = html;
    this.slots = slots;
    this.roots = roots;
  }
  create(
    api: DOMApi,
    values: readonly unknown[],
    destructors: DestructorFn[],
  ): Node {
    const doc = documentFor(api);
    let proto = this.roots.get(doc);
    if (proto === undefined) {
      const tpl = doc.createElement('template') as HTMLTemplateElement;
      tpl.innerHTML = this.html;
      const content = tpl.content;
      if (import.meta.env.DEV) {
        if (
          content.firstChild === null ||
          content.firstChild !== content.lastChild
        ) {
          throw new Error(
            'static-block: block HTML must parse to exactly one root element (the compiler qualification gate guarantees this)',
          );
        }
      }
      proto = content.firstChild!;
      this.roots.set(doc, proto);
    }
    const root = proto.cloneNode(true);
    const slots = this.slots;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const node = (
        slot.p.length === 0 ? root : resolvePath(root, slot.p)
      ) as HTMLElement;
      const value = values[i];
      const kind = slot.k;
      if (kind === 'text') {
        // same code path as `_DOM`'s sole-child text optimization
        $ev(api, node, EVENT_TYPE.TEXT_CONTENT, value as never, destructors);
      } else if (kind === 'class') {
        $prop(api, node, 'className', value, destructors);
      } else if (kind === 'attr') {
        $attr(api, node, slot.n!, value, destructors);
      } else if (kind === 'prop') {
        $prop(api, node, slot.n!, value, destructors);
      } else {
        // 'event' — same registration as `$ev`'s default branch
        $ev(api, node, slot.n!, value as EventListener, destructors);
      }
    }
    return root;
  }
}

/**
 * Create a static-block definition from compiler-emitted html + slot table.
 * Cheap to call repeatedly (per `$_each` site execution): the html parse is
 * memoized module-wide per (html, document).
 */
export function $_blk(
  html: string,
  slots: readonly StaticBlockSlot[],
): StaticBlockDef {
  let roots = TEMPLATE_ROOTS.get(html);
  if (roots === undefined) {
    roots = new WeakMap();
    TEMPLATE_ROOTS.set(html, roots);
  }
  return new StaticBlock(html, slots, roots);
}
