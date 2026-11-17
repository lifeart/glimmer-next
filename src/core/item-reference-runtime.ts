/**
 * The seam between the core runtime and the item reference runtime
 * (`@lifeart/gxt/item-references`, src/core/item-references.ts).
 *
 * A list keyed by position (`key="@index"`) or the rows of a native
 * `{{#each-in}}` build each row with a reference to its item, which another
 * item comes to stand in while the row stays (control-flow/list.ts): the
 * compiler reads such a row's item through `.value`. The item reference
 * runtime makes those references (`rows`), counts their reads (`read`), and
 * makes what reads a value once — a yielded block, an `{{#in-element}}`
 * destination — follow such a reference (dom.ts). None of it is part of the
 * main runtime: the core only asks whether the runtime is installed. The
 * compiler imports it for a standalone template that keys a list by position
 * (`$_itemRefKey`); an Ember host installs it (`registerItemReferenceRuntime`),
 * as its templates key lists by position, and its `{{#each-in}}` rows are
 * built this way. A build without either does not carry it.
 */
import type { Cell, MergedCell } from './reactive';
import type { ComponentLike } from './types';

/** The item references of the rows of one list (see `ItemReferenceRuntime.rows`). */
export interface RowReferences<T> {
  /** The key of the row `item` stands at, at `index`. */
  keyForItem(item: T, index: number): string;
  /** What the new row of `key` is built with: a reference to `item`. */
  build(key: string, item: T): T;
  /** The kept row of `key` stands for `item` now (applied by `flush`). */
  rebind(key: string, item: T): void;
  /** The kept rows' references hold the items `rebind` gave them. */
  flush(): void;
  /** The row of `key` was destroyed: release its reference. */
  forget(key: string): void;
  /** Every row was destroyed. */
  forgetAll(): void;
  /**
   * The `index` of a row built at `position` when the row's index is its key
   * (a positional row never moves), else `null` (the list computes it).
   */
  index(position: number): MergedCell | null;
}

export interface ItemReferenceRuntime {
  /** The item references of a list keyed `key` (`@index` or `@each-in`). */
  rows<T>(key: string): RowReferences<T>;
  /** Whether `cell` is a row's item reference. */
  isReference(cell: unknown): boolean;
  /** `read()`; `readItem` tells whether it read an item reference. */
  read<T>(read: () => T): T;
  readItem: boolean;
  /**
   * Ember dialect (WITH_EMBER_INTEGRATION; absent otherwise): the item
   * references a slot's params added to `tracker` (the computation the slot is
   * built in, which had `size` cells before).
   */
  paramReferences?: (tracker: Set<Cell>, size: number) => Cell[];
  /**
   * A standalone slot whose params read an item reference (`renderSlot`):
   * `initial`, rendered again in place (`render`) whenever an object param is
   * replaced or a param turns from a primitive into an object or back.
   */
  followSlot(
    initial: ComponentLike,
    render: () => ComponentLike,
    params: () => unknown[],
    name: string,
    ctx: any,
  ): unknown;
  /**
   * An `{{#in-element}}` whose destination was read through an item
   * reference: moves the block when the destination changes.
   */
  followInElement(
    ctx: any,
    readDestination: () => HTMLElement,
    move: (next: HTMLElement) => void,
  ): void;
}

let runtime: ItemReferenceRuntime | null = null;

/** The installed item reference runtime, `null` when none is. */
export function itemReferenceRuntime(): ItemReferenceRuntime | null {
  return runtime;
}

/** Install the item reference runtime (idempotent). */
export function installItemReferenceRuntime(next: ItemReferenceRuntime): void {
  runtime = next;
}
