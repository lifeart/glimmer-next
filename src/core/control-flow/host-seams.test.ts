/**
 * @vitest-environment happy-dom
 *
 * Focused coverage for the host-integration SEAMS added so an Ember host can
 * delegate row/branch teardown ordering + render-scope tracking to GXT natively:
 *
 *   1. `onRowContextCreated` — a destructor the host registers on a per-row /
 *      per-branch render ctx fires BEFORE that row's DOM is removed, in BOTH the
 *      per-row (`destroyItem`) and the bulk (`fastCleanup`) teardown paths.
 *   2. `onEnterRenderScope` / `onLeaveRenderScope` — fire in balanced order as
 *      GXT pushes/pops its render-scope (parent-context) stack.
 *   3. TREE-entry fix — a live `IfCondition` carries the `gxt-block-wrapper`
 *      marker, so a host renderer that re-stamps COMPONENT_IDs skips it and the
 *      IfCondition keeps its own id + TREE entry across a branch/sibling cascade.
 *
 * Every hook is no-op by default; these tests register stubs to exercise them.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  defineBenchRoot,
} from '../__test-utils__/list-harness';
import { registerHostHooks, HOST_HOOKS } from '../host-hooks';
import { registerDestructor } from '../glimmer/destroyable';
import { setParentContext, pushParentContext, popParentContext } from '../tracking';
import { IfCondition } from './if';
import { cell } from '../reactive';
import {
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
  addToTree,
  TREE,
} from '../shared';

const BLOCK_WRAPPER_SYMBOL = Symbol.for('gxt-block-wrapper');

function resetHooks(): void {
  for (const key of Object.keys(HOST_HOOKS)) {
    delete (HOST_HOOKS as Record<string, unknown>)[key];
  }
  delete (globalThis as Record<string, unknown>).__gxtHostHooksInstalled;
}

describe('onRowContextCreated — row destructors fire before DOM removal', () => {
  let fixture: DOMFixture;

  afterEach(() => {
    fixture?.cleanup();
    resetHooks();
  });

  // Register a stub `onRowContextCreated` that pushes a destructor recording how
  // many `<tr>` are still in the DOM at the moment it fires. Installing a host
  // hook also disables the static-frame fast path, so rows take the rowCtx path.
  function setup() {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
    const connectedCounts: number[] = [];
    const trCount = () =>
      fixture.container.querySelectorAll('tbody tr').length;
    registerHostHooks({
      onRowContextCreated: (ctx) => {
        registerDestructor(ctx, () => {
          connectedCounts.push(trCount());
        });
      },
    });
    const Root = defineBenchRoot('id');
    const root = mountRoot(fixture, Root) as unknown as {
      _items: ReturnType<typeof buildItems>;
    };
    return { root, connectedCounts, trCount };
  }

  test('per-row removal: the removed row destructor sees its <tr> still connected', async () => {
    const { root, connectedCounts, trCount } = setup();
    const items = buildItems(3);
    root._items = items;
    await settle();
    expect(trCount()).toBe(3);
    expect(connectedCounts).toEqual([]); // nothing torn down yet

    // Remove the middle row (keyed by id → only that row is destroyed).
    root._items = [items[0], items[2]];
    await settle();

    expect(trCount()).toBe(2);
    // destroyItem → destroyRowCtx runs the row's destructors BEFORE removing the
    // row node, so the destructor observed all 3 rows still in the DOM.
    expect(connectedCounts).toEqual([3]);
  });

  test('bulk clear: every row destructor fires before the bulk DOM clear', async () => {
    const { root, connectedCounts, trCount } = setup();
    root._items = buildItems(3);
    await settle();
    expect(trCount()).toBe(3);
    expect(connectedCounts).toEqual([]);

    // Empty the list → fastCleanup bulk path. teardownAllRowCtxs now runs BEFORE
    // clearChildren, so all 3 row destructors fire while all 3 <tr> are still
    // connected. (Pre-reorder they would have observed 0.)
    root._items = [];
    await settle();

    expect(trCount()).toBe(0);
    expect(connectedCounts).toEqual([3, 3, 3]);
  });
});

describe('onEnterRenderScope / onLeaveRenderScope', () => {
  afterEach(resetHooks);

  test('fire in balanced order as the render-scope stack is pushed/popped', () => {
    const events: string[] = [];
    registerHostHooks({
      onEnterRenderScope: (ctx) =>
        events.push(`enter:${(ctx as Record<symbol, number>)[COMPONENT_ID_PROPERTY]}`),
      onLeaveRenderScope: () => events.push('leave'),
    });

    const a = { [COMPONENT_ID_PROPERTY]: 101 } as Record<symbol, number>;
    const b = { [COMPONENT_ID_PROPERTY]: 202 } as Record<symbol, number>;

    // setParentContext(x) and pushParentContext(x) both enter; the null form and
    // popParentContext both leave. Keep the calls balanced so the global stack is
    // restored at the end.
    setParentContext(a as never);
    pushParentContext(b as never);
    popParentContext();
    setParentContext(null);

    expect(events).toEqual(['enter:101', 'enter:202', 'leave', 'leave']);
  });

  test('are inert (no throw, no events) when no host hook is registered', () => {
    const a = { [COMPONENT_ID_PROPERTY]: 303 } as Record<symbol, number>;
    expect(() => {
      setParentContext(a as never);
      setParentContext(null);
    }).not.toThrow();
  });
});

describe('TREE-entry fix — live IfCondition keeps its TREE entry', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
    resetHooks();
  });

  function makeIf(): IfCondition {
    const baseParent = new Component({});
    (baseParent as unknown as Record<symbol, unknown>)[RENDERED_NODES_PROPERTY] =
      [];
    addToTree(fixture.root as never, baseParent as never);

    const placeholder = fixture.api.comment('if-tree-test');
    const target = fixture.api.fragment();
    fixture.api.insert(target as never, placeholder);

    return new IfCondition(
      baseParent as never,
      cell(true) as never,
      target as never,
      placeholder,
      () => null,
      () => null,
    );
  }

  test('IfCondition advertises the gxt-block-wrapper marker', () => {
    const ifCond = makeIf();
    expect((ifCond as unknown as Record<symbol, unknown>)[BLOCK_WRAPPER_SYMBOL]).toBe(
      true,
    );
  });

  test('a host COMPONENT_ID re-stamp skips the IfCondition, so its TREE entry survives', () => {
    const ifCond = makeIf();
    const originalId = (ifCond as unknown as Record<symbol, number>)[
      COMPONENT_ID_PROPERTY
    ];
    expect(TREE.get(originalId)).toBe(ifCond);

    // Reproduce the ember host's `$_tag` COMPONENT_ID re-stamp: it collapses a
    // render ctx's id into the shared gxt-root id UNLESS the block-wrapper marker
    // is present. Before the fix the IfCondition lacked the marker, so it WAS
    // re-stamped — aliasing/dropping its TREE entry when a branch tore down.
    const fakeRootId = 999999;
    const sym = (ifCond as unknown as Record<symbol, unknown>)[BLOCK_WRAPPER_SYMBOL];
    if (!sym) {
      (ifCond as unknown as Record<symbol, number>)[COMPONENT_ID_PROPERTY] =
        fakeRootId;
    }

    // Marker present → re-stamp skipped → id unchanged → TREE entry intact.
    expect(
      (ifCond as unknown as Record<symbol, number>)[COMPONENT_ID_PROPERTY],
    ).toBe(originalId);
    expect(TREE.get(originalId)).toBe(ifCond);
  });

  test('control: WITHOUT the marker the same re-stamp would drop the live entry', () => {
    // Proves the marker is load-bearing: a wrapper-less ctx with the same shape
    // gets re-stamped, and a teardown keyed off the original id no longer finds
    // it — the exact failure the marker prevents for IfCondition.
    const plain = {
      [COMPONENT_ID_PROPERTY]: 4242,
      [RENDERED_NODES_PROPERTY]: [],
    } as Record<symbol, unknown>;
    addToTree(fixture.root as never, plain as never);
    const originalId = plain[COMPONENT_ID_PROPERTY] as number;
    expect(TREE.get(originalId)).toBe(plain);

    const fakeRootId = 888888;
    if (!plain[BLOCK_WRAPPER_SYMBOL]) {
      plain[COMPONENT_ID_PROPERTY] = fakeRootId;
    }
    // The live node's id moved out from under its TREE entry — a destroy keyed by
    // the new id would never reach the original registration.
    expect(plain[COMPONENT_ID_PROPERTY]).toBe(fakeRootId);
    expect(TREE.get(fakeRootId as number)).toBeUndefined();
  });
});
