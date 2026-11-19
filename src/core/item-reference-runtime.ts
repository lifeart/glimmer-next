/**
 * The seam between the core runtime and the item reference runtime
 * (`@lifeart/gxt/item-references`, src/core/item-references.ts).
 *
 * A list keyed by position (`key="@index"`) or the rows of a native
 * `{{#each-in}}` build each row with a reference to its item, which another
 * item comes to stand in while the row stays (control-flow/list.ts): the
 * compiler reads such a row's item through `.value`. The item reference
 * runtime makes those references (`createRowRefs` and the `row*` functions),
 * counts their reads (`itemReads`), and makes what reads a value once — a
 * yielded block, an `{{#in-element}}` destination — follow such a reference
 * (dom.ts). None of it is part of the main runtime: the core only calls what
 * the runtime installed here, plain functions (`null` until then), so that a
 * build without the runtime folds every such call away. The compiler imports
 * the runtime for a template that keys a list by position or renders a native
 * `{{#each-in}}`, in every dialect (`$_itemRefKey`); a template compiled at
 * runtime gets it from the runtime compiler (`setupGlobalScope`) or binds
 * `$_itemRefKey` from the main entry, and a host can install it itself
 * (`registerItemReferenceRuntime`).
 */
import type { Cell, MergedCell } from './reactive';
import type { ComponentLike } from './types';

/** The item references of the rows of one list (the runtime's own state). */
export type RowRefs = object;

/** The key of the row `item` stands at, at `index`. */
export let rowKey: ((rows: RowRefs, item: unknown, index: number) => string) | null = null;
/** What the new row of `key` is built with: a reference to `item`. */
export let rowRef: ((rows: RowRefs, key: string, item: unknown) => unknown) | null = null;
/** The kept row of `key` stands for `item` now (applied by `rowsFlush`). */
export let rowRebind: ((rows: RowRefs, key: string, item: unknown) => void) | null = null;
/** The kept rows' references hold the items `rowRebind` gave them. */
export let rowsFlush: ((rows: RowRefs) => void) | null = null;
/** The row of `key` was destroyed (every row, without `key`). */
export let rowsForget: ((rows: RowRefs, key?: string) => void) | null = null;
/**
 * The `index` of a row built at `position` when the row's index is its key (a
 * positional row never moves), else `null` (the list computes it).
 */
export let rowIndex: ((rows: RowRefs, position: number) => MergedCell | null) | null = null;
/** The item references of a list keyed `key` (`@index` or `@each-in`). */
export let createRowRefs: ((key: string) => RowRefs) | null = null;
/** Whether `cell` is a row's item reference. */
export let isRowRef: ((cell: unknown) => boolean) | null = null;
/**
 * Ember dialect: the item references a slot's params added to `tracker` (the
 * computation the slot is built in, which had `size` cells before).
 */
export let paramRefs: ((tracker: Set<Cell>, size: number) => Cell[]) | null = null;
/**
 * A standalone slot whose params read an item reference: `initial`, rendered
 * again in place (`render`) whenever an object param is replaced or a param
 * turns from a primitive into an object or back.
 */
export let followSlot:
  | ((
      initial: ComponentLike,
      render: () => ComponentLike,
      params: () => unknown[],
      name: string,
      ctx: any,
    ) => unknown)
  | null = null;
/**
 * An `{{#in-element}}` whose destination (`current`, read through an item
 * reference) has the block rendered into it (`remove` takes it out again):
 * moves the block — `render` renders it — to the destination of the item now
 * at the row.
 */
export let followInElement:
  | ((
      ctx: any,
      readDestination: () => HTMLElement,
      current: HTMLElement,
      remove: (destroyContent: boolean) => void,
      render: (destination: HTMLElement) => (destroyContent: boolean) => void,
    ) => void)
  | null = null;

/**
 * How many times an item reference has been read: a construct compares it
 * before and after a read to tell whether the value came through one. It never
 * changes without the runtime (no item reference exists).
 */
export let itemReads = 0;

/** Count a read of an item reference (the runtime's `ItemReference`). */
export function noteItemRead(): void {
  itemReads++;
}

/** Install the item reference runtime (idempotent). */
export function installItemReferenceRuntime(
  create: NonNullable<typeof createRowRefs>,
  key: NonNullable<typeof rowKey>,
  ref: NonNullable<typeof rowRef>,
  rebind: NonNullable<typeof rowRebind>,
  flush: NonNullable<typeof rowsFlush>,
  forget: NonNullable<typeof rowsForget>,
  index: NonNullable<typeof rowIndex>,
  isRef: NonNullable<typeof isRowRef>,
  params: NonNullable<typeof paramRefs>,
  slot: NonNullable<typeof followSlot>,
  inElement: NonNullable<typeof followInElement>,
): void {
  createRowRefs = create;
  rowKey = key;
  rowRef = ref;
  rowRebind = rebind;
  rowsFlush = flush;
  rowsForget = forget;
  rowIndex = index;
  isRowRef = isRef;
  paramRefs = params;
  followSlot = slot;
  followInElement = inElement;
}
