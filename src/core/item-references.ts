/**
 * `@lifeart/gxt/item-references` — the item reference runtime.
 *
 * A list keyed by position (`key="@index"`) or the rows of a native
 * `{{#each-in}}` build each row with a reference to its item; another item
 * comes to stand in it while the row stays (control-flow/list.ts). This
 * runtime makes those references `ItemReference`s, whose reads are counted, and
 * makes what reads a value once follow such a reference: a standalone yielded
 * block is rendered again for the object now at the row (`followSlot`), an
 * `{{#in-element}}` moves to the destination of the item now at the row
 * (`followInElement`). It is kept out of the main runtime
 * (item-reference-runtime.ts), like `@lifeart/gxt/recycle`:
 *   - AOT (plugins/test.ts) imports `$_itemRefKey` from this entry for a
 *     template that keys a list by position or renders a native
 *     `{{#each-in}}`, in every dialect (the compiler's
 *     `CompileResult.usedItemRefs`); calling it installs the runtime.
 *   - A template compiled at runtime binds `$_itemRefKey` from the main entry
 *     (`templateScopeNames`), or from the globals the runtime compiler's
 *     `setupGlobalScope` installs (it also calls `registerItemReferenceRuntime`).
 *   - A host whose rows reach a list without `$_itemRefKey` installs it itself
 *     (`registerItemReferenceRuntime`, also exported by
 *     `@lifeart/gxt/glimmer-compatibility`).
 * A list keyed by position without it throws (list.ts).
 */
import { Cell, formula, applyCellUpdateSync, DEBUG_CELLS } from './reactive';
import { opcodeFor } from './vm';
import { initDOM } from './context';
import { renderElement } from './render-core';
import { destroyElementSync, unregisterFromParent } from './destroy';
import { registerDestructor } from './glimmer/destroyable';
import { HOST_HOOKS } from './host-hooks';
import {
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
  RENDERING_CONTEXT_PROPERTY,
  type ComponentLike,
  type DOMApi,
} from './types';
import {
  installItemReferenceRuntime,
  noteItemRead,
  type RowRefs,
} from './item-reference-runtime';

// The keys of the lists whose rows are built with a reference to their item
// (list.ts `POSITIONAL_KEY` / `EACH_IN_KEY`).
const EACH_IN_KEY = '@each-in';

/**
 * A row's reference to its item: its value is the item the row stands for
 * now. Its reads are counted (`itemReads`), so that a construct that reads a
 * value once can tell that the value came through such a reference.
 */
class ItemReference<T> extends Cell<T> {
  get value(): T {
    noteItemRead();
    return super.value;
  }
  set value(value: T) {
    this.update(value);
  }
}

/** A row's reference to `item` (also for tests). */
export function createItemReference<T>(item: T, debugName?: string): Cell<T> {
  return new ItemReference<T>(item, debugName);
}

// Two `{{#each-in}}` entries of one row that read the same: same key and value.
function sameEachInEntry(a: unknown, b: unknown): boolean {
  const x = a as [unknown, unknown] | undefined;
  const y = b as [unknown, unknown] | undefined;
  return (
    x !== undefined && y !== undefined && Object.is(x[0], y[0]) && Object.is(x[1], y[1])
  );
}

/**
 * The item references of the rows of one list: the reference of each row by
 * its key (`REFS`), the [reference, item] pairs a list update rebinds
 * (`PENDING`), and whether the rows are `{{#each-in}}` rows (`EACH_IN`). A
 * positional row is keyed by its position, so any item can come to stand at
 * a kept row, and its `index` is that position; an `{{#each-in}}` row is keyed
 * by the key `$__eachIn` gives its `[key, value, rowKey]` entry, and a kept row
 * gets the entry's current key and value. Kept as an array, and handled by
 * plain functions, so that a minifier shortens every name.
 */
type ListRefs = [Map<string, ItemReference<unknown>>, unknown[], boolean];
const REFS = 0;
const PENDING = 1;
const EACH_IN = 2;

function createRowRefs(key: string): RowRefs {
  const rows: ListRefs = [new Map(), [], key === EACH_IN_KEY];
  return rows;
}

function rowKey(rows: RowRefs, item: unknown, index: number): string {
  return (rows as ListRefs)[EACH_IN]
    ? (item as [unknown, unknown, string])[2]
    : String(index);
}

function rowRef(rows: RowRefs, key: string, item: unknown): unknown {
  const ref = new ItemReference<unknown>(
    item,
    IS_DEV_MODE ? `each.item[${String(key)}]` : undefined,
  );
  (rows as ListRefs)[REFS].set(key, ref);
  return ref;
}

function rowRebind(rows: RowRefs, key: string, item: unknown): void {
  const list = rows as ListRefs;
  const ref = list[REFS].get(key);
  if (
    ref !== undefined &&
    (list[EACH_IN] ? !sameEachInEntry(ref._value, item) : ref._value !== item)
  ) {
    list[PENDING].push(ref, item);
  }
}

// Each update re-renders the bindings of its row that read the item,
// synchronously (the update runs inside a DOM sync, whose own queue would drop
// a deferred cell write); then the host is told (a host that gives some
// components their argument values in a pass of its own runs it again).
function rowsFlush(rows: RowRefs): void {
  const pending = (rows as ListRefs)[PENDING];
  if (pending.length === 0) return;
  const updates = pending.splice(0);
  for (let i = 0; i < updates.length; i += 2) {
    applyCellUpdateSync(updates[i] as ItemReference<unknown>, updates[i + 1]);
  }
  HOST_HOOKS.itemReferencesChanged?.();
}

// A development build keeps every cell in `DEBUG_CELLS`, which would keep a
// destroyed row's reference — and the item it holds — alive.
function rowsForget(rows: RowRefs, key?: string): void {
  const refs = (rows as ListRefs)[REFS];
  if (key === undefined) {
    if (IS_DEV_MODE) refs.forEach((ref) => DEBUG_CELLS.delete(ref as Cell<unknown>));
    refs.clear();
    return;
  }
  const ref = refs.get(key);
  if (ref === undefined) return;
  refs.delete(key);
  if (IS_DEV_MODE) DEBUG_CELLS.delete(ref as Cell<unknown>);
}

function rowIndex(rows: RowRefs, position: number) {
  if ((rows as ListRefs)[EACH_IN]) return null;
  return formula(
    () => position,
    IS_DEV_MODE ? `each.index[@index:${position}]` : undefined,
  );
}

function isRowRef(cell: unknown): boolean {
  return cell instanceof ItemReference;
}

// Under the Ember dialect, the item references the reads of a slot's params
// added to the computation the slot is built in (`tracker`, which had `size`
// cells before them).
function paramReferences(tracker: Set<Cell>, size: number): Cell[] {
  const references: Cell[] = [];
  let index = 0;
  for (const cell of tracker) {
    if (index++ >= size && cell instanceof ItemReference) references.push(cell);
  }
  return references;
}

// The object params of `params` by position (others `undefined`).
function snapshotParams(params: unknown[]): unknown[] {
  return params.map((param) => (typeof param === 'object' ? param : undefined));
}

function sameSnapshotParams(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

// The anchor a following slot's next rendering goes before. It is a marker the
// host keeps (`registerListMarker`), as a list's markers are: a host that
// strips the empty comments of a rendering would otherwise detach it, and the
// next rendering would go nowhere.
function slotAnchor(api: DOMApi, name: string): Comment {
  const anchor = IS_DEV_MODE ? api.comment(`slot-{{${name}}}-anchor`) : api.comment();
  HOST_HOOKS.registerListMarker?.(anchor);
  return anchor;
}

/**
 * The standalone slot `initial`, rendered again in place (`render`) whenever an
 * object param is replaced or a param turns from a primitive into an object or
 * back. Laid out like a swapping `$_dc`: the content's nodes end with an anchor
 * the next rendering goes before (`slotAnchor`), and the returned object stands
 * for the current content.
 */
function followSlot(
  initial: ComponentLike,
  render: () => ComponentLike,
  params: () => unknown[],
  name: string,
  ctx: any,
): unknown {
  const api = initDOM(ctx);
  let result = initial;
  let anchor = slotAnchor(api, name);
  result[RENDERED_NODES_PROPERTY].push(anchor);
  const watch = formula(params, IS_DEV_MODE ? `slot:${name}:params` : undefined);
  let rendered: unknown[] | null = null;
  const destructor = opcodeFor(watch, (next) => {
    const nextSnapshot = snapshotParams(next as unknown[]);
    if (rendered === null || sameSnapshotParams(rendered, nextSnapshot)) {
      rendered = nextSnapshot;
      return;
    }
    rendered = nextSnapshot;
    result[RENDERED_NODES_PROPERTY].pop();
    const parent = api.parent(anchor)!;
    const nextAnchor = slotAnchor(api, name);
    api.insert(parent, nextAnchor, anchor);
    unregisterFromParent(result);
    destroyElementSync(result, false, api);
    HOST_HOOKS.unregisterListMarker?.(anchor);
    api.destroy(anchor);
    anchor = nextAnchor;
    result = render();
    result[RENDERED_NODES_PROPERTY].push(nextAnchor);
    renderElement(api, ctx, parent, result, nextAnchor);
  });
  registerDestructor(ctx, destructor, () => {
    watch.destroy();
    HOST_HOOKS.unregisterListMarker?.(anchor);
  });
  return {
    get [RENDERING_CONTEXT_PROPERTY]() {
      return result[RENDERING_CONTEXT_PROPERTY];
    },
    set [RENDERING_CONTEXT_PROPERTY](value) {
      result[RENDERING_CONTEXT_PROPERTY] = value;
    },
    get [COMPONENT_ID_PROPERTY]() {
      return result[COMPONENT_ID_PROPERTY];
    },
    set [COMPONENT_ID_PROPERTY](value) {
      result[COMPONENT_ID_PROPERTY] = value;
    },
    get [RENDERED_NODES_PROPERTY]() {
      return result[RENDERED_NODES_PROPERTY];
    },
    set [RENDERED_NODES_PROPERTY](value) {
      result[RENDERED_NODES_PROPERTY] = value;
    },
  };
}

/**
 * An `{{#in-element}}` whose destination (`current`) was read through an item
 * reference: the block moves — taken out (`remove`) and rendered again
 * (`render`) — to the destination of the item now at the row, as Glimmer's
 * in-element follows its destination reference.
 */
function followInElement(
  ctx: any,
  readDestination: () => HTMLElement,
  current: HTMLElement,
  remove: (destroyContent: boolean) => void,
  render: (destination: HTMLElement) => (destroyContent: boolean) => void,
): void {
  const watch = formula(readDestination, IS_DEV_MODE ? 'in-element:destination' : undefined);
  let first = true;
  const stop = opcodeFor(watch, (next) => {
    if (first) {
      first = false;
      return;
    }
    if (next === current) return;
    remove(true);
    current = next as HTMLElement;
    remove = render(current);
  });
  // The block's content in the destination it moved to goes with the render
  // context (the in-element's own destructor removes the first rendering).
  registerDestructor(ctx, stop, () => {
    watch.destroy();
    remove(false);
  });
}

function install(): void {
  installItemReferenceRuntime(
    createRowRefs,
    rowKey,
    rowRef,
    rowRebind,
    rowsFlush,
    rowsForget,
    rowIndex,
    isRowRef,
    paramReferences,
    followSlot,
    followInElement,
  );
}

/**
 * Install the follow runtime (idempotent): rows keyed by position or each-in
 * rows built after it get `ItemReference`s, and yielded blocks and
 * in-elements that read them follow them. A host whose templates key lists
 * without `$_itemRefKey` (the Ember dialect) installs it before it renders:
 * the runtime compiler's `setupGlobalScope` does, and the Glimmer
 * compatibility entry exports it for a host that renders AOT-compiled
 * templates.
 */
export function registerItemReferenceRuntime(): void {
  install();
}

/**
 * The key of a list keyed by position, as a standalone template's compiled
 * `{{#each}}` passes it (`$_itemRefKey("@index")`): installs the follow
 * runtime before the list builds its rows, and returns the key.
 */
export function $_itemRefKey<K extends string>(key: K): K {
  install();
  return key;
}
