/**
 * Host tag primitives — the Glimmer "tag" protocol expressed directly on gxt
 * cells, so a host (Ember's native layer) and gxt share ONE reactive system
 * instead of bridging two.
 *
 *   - `tagFor(obj, key)` returns THE per-(obj, key) `Cell` from `cellsMap` —
 *     the same store gxt `tracked` / `cellFor` / `rawCellFor` use. A missing
 *     cell is created holding the `UNSET` sentinel. It never defines an
 *     accessor and never reads `obj[key]`: for a host `@tracked` accessor that
 *     read would re-enter the accessor before the cell exists (infinite
 *     recursion). A host may store its value IN the cell (`_value`), treating
 *     `UNSET` as "not initialized"; gxt's own readers seed an `UNSET` cell in
 *     place (reactive.ts).
 *   - `dirtyCell(cell)` ALWAYS invalidates: it bumps the global revision and
 *     the cell's `_revision` even when the value did not change, unlike
 *     `Cell.update()`'s equality short-circuit. Glimmer semantics require it
 *     (`@tracked x = x`, `notifyPropertyChange` with an unchanged value). The
 *     cell is enqueued for the DOM drain only when something is subscribed to
 *     it (own opcodes or dependent formulas): an unsubscribed tag has nothing
 *     to re-execute, and enqueueing it would make the drain materialize a
 *     permanent empty `opsForTag` entry per dirtied tag.
 *   - `currentRevision()` is the global revision (Glimmer `CURRENT_TAG`);
 *     `cell._revision` is the per-tag revision (Glimmer `valueForTag`).
 *
 * Nothing in gxt calls these; behavior is unchanged unless a host does.
 */
import {
  Cell,
  UNSET,
  cellsMap,
  bumpGlobalRevision,
  currentGlobalRevision,
  tagsToRevalidate,
  relatedTags,
  opsForTag,
} from '@/core/reactive';
import { scheduleRevalidate } from '@/core/runtime';

export { UNSET };

export type TagMeta = Map<string | number | symbol, Cell<unknown>>;

/** Get-or-create the per-object tag map (the object's `cellsMap` entry). */
export function tagMetaFor(obj: object): TagMeta {
  let meta = cellsMap.get(obj);
  if (meta === undefined) {
    meta = new Map();
    cellsMap.set(obj, meta);
  }
  return meta;
}

/**
 * Get-or-create the per-(obj, key) cell. Pass `meta` (from `tagMetaFor`) to
 * skip the WeakMap lookup on hot paths.
 */
export function tagFor(
  obj: object,
  key: string | number | symbol,
  meta?: TagMeta,
): Cell<unknown> {
  const tags = meta === undefined ? tagMetaFor(obj) : meta;
  let tag = tags.get(key);
  if (tag === undefined) {
    tag = new Cell<unknown>(UNSET, IS_DEV_MODE ? `tag:${String(key)}` : undefined);
    if (IS_DEV_MODE) {
      tag._relatedObj = obj;
      tag._relatedKey = key;
    }
    tags.set(key, tag);
  }
  return tag;
}

/** The existing per-(obj, key) cell, or undefined. Never creates. */
export function peekTagFor(
  obj: object,
  key: string | number | symbol,
): Cell<unknown> | undefined {
  const tags = cellsMap.get(obj);
  return tags === undefined ? undefined : tags.get(key);
}

/** Invalidate `cell` unconditionally (see module doc). */
export function dirtyCell(cell: Cell<unknown>): void {
  cell._revision = bumpGlobalRevision();
  const id = cell.id;
  if (relatedTags.has(id) || opsForTag.has(id)) {
    tagsToRevalidate.add(cell);
    scheduleRevalidate();
  }
}

/** The global revision: advances on every value change and every `dirtyCell`. */
export function currentRevision(): number {
  return currentGlobalRevision();
}
