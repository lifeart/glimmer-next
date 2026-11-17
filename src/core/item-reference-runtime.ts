/**
 * The seam between the core runtime and the item reference follow runtime
 * (`@lifeart/gxt/item-references`, src/core/item-references.ts).
 *
 * A list keyed by position (`POSITIONAL_KEY`) or an `{{#each-in}}`
 * (`EACH_IN_KEY`) builds each row with a reference to its item, which another
 * item comes to stand in while the row stays (control-flow/list.ts). The core
 * runtime makes those references plain cells. The follow runtime makes them
 * `ItemReference`s, whose reads it counts, and makes what reads a value once —
 * a yielded block, an `{{#in-element}}` destination — follow such a
 * reference (dom.ts). It is not part of the main runtime: the compiler imports
 * it for a template that keys a list by position (`$_itemRefKey`), and the
 * runtime compiler (an Ember host's) installs it, so a build without either
 * does not carry it.
 */
import type { Cell } from './reactive';
import type { ComponentLike } from './types';

export interface ItemReferenceRuntime {
  /** A row's reference to its item. */
  createReference<T>(item: T, debugName?: string): Cell<T>;
  /** Whether `cell` is a row's item reference. */
  isReference(cell: unknown): boolean;
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
let reads = 0;

/** The installed follow runtime, `null` when none is. */
export function itemReferenceRuntime(): ItemReferenceRuntime | null {
  return runtime;
}

/** Install the follow runtime (idempotent). */
export function installItemReferenceRuntime(next: ItemReferenceRuntime): void {
  runtime = next;
}

/** Count a read of an item reference (`ItemReference`). */
export function noteItemReferenceRead(): void {
  reads++;
}

/**
 * The number of item reference reads so far: a construct compares it before
 * and after a read to tell whether the value came through an item reference.
 * It never changes while no follow runtime is installed.
 */
export function itemReferenceReadCount(): number {
  return reads;
}
