/**
 * `@lifeart/gxt/item-references` — the item reference follow runtime.
 *
 * A list keyed by position (`key="@index"`) or an `{{#each-in}}` builds each
 * row with a reference to its item; another item comes to stand in it while
 * the row stays (control-flow/list.ts). This runtime makes those references
 * `ItemReference`s, whose reads are counted, and makes what reads a value once
 * follow such a reference: a standalone yielded block is rendered again for
 * the object now at the row (`followSlot`), an `{{#in-element}}` moves to the
 * destination of the item now at the row (`followInElement`). It is kept out
 * of the main runtime (item-reference-runtime.ts), like `@lifeart/gxt/recycle`:
 *   - AOT (plugins/test.ts) imports `$_itemRefKey` from this entry for a
 *     standalone template that keys a list by position (the compiler's
 *     `CompileResult.usedItemRefs`); calling it installs the runtime.
 *   - An Ember host installs it (`registerItemReferenceRuntime`, also exported
 *     by `@lifeart/gxt/glimmer-compatibility`; the runtime compiler's
 *     `setupGlobalScope` calls it): its templates key lists without
 *     `$_itemRefKey`, and `{{#each-in}}` rows are Ember's.
 */
import { Cell, formula } from './reactive';
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
  noteItemReferenceRead,
  type ItemReferenceRuntime,
} from './item-reference-runtime';

/**
 * A row's reference to its item: its value is the item the row stands for
 * now. Its reads are counted (`itemReferenceReadCount`), so that a construct
 * that reads a value once can tell, by comparing the count before and after
 * the read, that the value came through such a reference.
 */
class ItemReference<T> extends Cell<T> {
  get value(): T {
    noteItemReferenceRead();
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
 * An `{{#in-element}}` whose destination was read through an item reference:
 * the block moves — `move` renders it again — to the destination of the item
 * now at the row, as Glimmer's in-element follows its destination reference.
 */
function followInElement(
  ctx: any,
  readDestination: () => HTMLElement,
  move: (next: HTMLElement) => void,
): void {
  const watch = formula(readDestination, IS_DEV_MODE ? 'in-element:destination' : undefined);
  let first = true;
  const stop = opcodeFor(watch, (next) => {
    if (first) {
      first = false;
      return;
    }
    move(next as HTMLElement);
  });
  registerDestructor(ctx, stop, () => {
    watch.destroy();
  });
}

const RUNTIME: ItemReferenceRuntime = {
  createReference: createItemReference,
  isReference: (cell: unknown) => cell instanceof ItemReference,
  followSlot,
  followInElement,
};

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
  installItemReferenceRuntime(RUNTIME);
}

/**
 * The key of a list keyed by position, as a standalone template's compiled
 * `{{#each}}` passes it (`$_itemRefKey("@index")`): installs the follow
 * runtime before the list builds its rows, and returns the key.
 */
export function $_itemRefKey<K extends string>(key: K): K {
  installItemReferenceRuntime(RUNTIME);
  return key;
}
