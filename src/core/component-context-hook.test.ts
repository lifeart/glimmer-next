/**
 * @vitest-environment happy-dom
 *
 * Coverage for the `onComponentContextCreated` host hook — the COMPONENT twin
 * of the per-each-row `onRowContextCreated` seam. An Ember host uses it to
 * attach one pre-detach destructor per component (via `registerDestructor(ctx,
 * …)`) and retire its own component-liveness re-derivation.
 *
 * Pins:
 *   (a) fires once per component (class-based AND template-only) with the tree
 *       ctx, parent before child;
 *   (b) does NOT fire for each-`{{#each}}` rows — no double-fire against
 *       `onRowContextCreated`, nor for `{{#if}}` branch wrappers;
 *   (c) a registered destructor fires pre-DOM-removal (element still connected)
 *       on single-component teardown;
 *   (d) whole-subtree (route-transition style) teardown is deterministic
 *       parent-before-child; the destroy-root sees connected DOM, descendants
 *       see their DOM already detached;
 *   (e) `{{#if}}` branch swap containing a component fires that component's
 *       destructor on collapse;
 *   (f) unregistered (or no-op) = zero behavior change.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import {
  settle,
  setupRuntimeTemplateGlobals,
} from './__test-utils__/list-harness';
import { registerHostHooks, HOST_HOOKS } from './host-hooks';
import { registerDestructor } from './glimmer/destroyable';
import { destroyElementSync } from './destroy';
import { template } from '../../plugins/runtime-compiler';
import { $_c, $_args, $_edp } from './dom';
import {
  $template,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  addToTree,
  TREE,
} from './shared';
import { renderElement } from './render-core';
import { cellFor } from './reactive';

type Ctx = Record<symbol, unknown> & {
  [RENDERED_NODES_PROPERTY]: Array<Node>;
  [COMPONENT_ID_PROPERTY]: number;
};

function resetHooks(): void {
  for (const key of Object.keys(HOST_HOOKS)) {
    delete (HOST_HOOKS as Record<string, unknown>)[key];
  }
  delete (globalThis as Record<string, unknown>).__gxtHostHooksInstalled;
}

/**
 * Render `Comp` into the fixture container under a fresh tree-anchored parent
 * (a bare `new Component({})`, which never calls `$_GET_ARGS`, so it does NOT
 * fire the hook). Returns the rendered component ctx — for template-only AND
 * `template()`-class components `$_c` returns the instance itself.
 */
function render(
  fixture: DOMFixture,
  Comp: unknown,
  args: Record<string, unknown> = {},
): Ctx {
  const parent = new Component({});
  (parent as unknown as Record<symbol, unknown>)[RENDERED_NODES_PROPERTY] = [];
  addToTree(fixture.root as never, parent as never);
  const rendered = $_c(
    Comp as never,
    $_args(args, false, $_edp as never) as never,
    parent as never,
  );
  renderElement(
    fixture.api,
    parent as never,
    fixture.container,
    rendered as never,
  );
  return rendered as unknown as Ctx;
}

const firstNode = (ctx: Ctx): Node | undefined =>
  ctx[RENDERED_NODES_PROPERTY]?.[0];

// ---------------------------------------------------------------------------

let fixture: DOMFixture;
beforeEach(() => {
  fixture = createDOMFixture();
  setupRuntimeTemplateGlobals();
});
afterEach(() => {
  fixture?.cleanup();
  resetHooks();
});

describe('onComponentContextCreated — fires once per component with the tree ctx', () => {
  test('class parent + class child: each fires once, parent-before-child, with the render-tree ctx', () => {
    const captured: Ctx[] = [];
    registerHostHooks({
      onComponentContextCreated: (ctx) => captured.push(ctx as Ctx),
    });

    class Child extends Component {
      [$template] = template('<b class="child">child</b>');
    }
    class Parent extends Component {
      [$template] = template('<div class="parent"><Child /></div>', {
        scope: { Child },
      });
    }

    const rendered = render(fixture, Parent);

    // Exactly one fire for the parent and one for the child (the bare tree
    // anchor `new Component({})` does not fire — it never calls `$_GET_ARGS`).
    expect(captured).toHaveLength(2);
    const [parentCtx, childCtx] = captured;
    expect(parentCtx).not.toBe(childCtx);

    // The FIRST fire is the parent (its `$_GET_ARGS` runs before it renders the
    // `<Child />` that triggers the child's `$_GET_ARGS`).
    expect(parentCtx).toBe(rendered);
    expect(parentCtx).toBeInstanceOf(Component);
    expect(childCtx).toBeInstanceOf(Component);

    // Each ctx is the real render-tree node: it carries a numeric COMPONENT_ID
    // and is the value `TREE`/`registerDestructor` key on.
    for (const ctx of captured) {
      expect(typeof ctx[COMPONENT_ID_PROPERTY]).toBe('number');
      expect(TREE.get(ctx[COMPONENT_ID_PROPERTY])).toBe(ctx);
    }

    // Both actually rendered.
    expect(fixture.container.querySelector('.parent .child')).not.toBeNull();
  });

  test('template-only components fire too, parent-before-child, and accept a destructor', () => {
    const captured: Ctx[] = [];
    let parentDestructorRan = false;
    registerHostHooks({
      onComponentContextCreated: (ctx) => {
        captured.push(ctx as Ctx);
        if (captured.length === 1) {
          // Prove the ctx is a valid `registerDestructor` target (i.e. "the ctx
          // that registerDestructor accepts").
          registerDestructor(ctx, () => {
            parentDestructorRan = true;
          });
        }
      },
    });

    const Child = template('<b class="tchild">child</b>');
    const Parent = template('<div class="tparent"><Child /></div>', {
      scope: { Child },
    });

    const rendered = render(fixture, Parent);

    expect(captured).toHaveLength(2);
    expect(captured[0]).toBe(rendered); // parent fired first
    expect(captured[0]).not.toBe(captured[1]);
    for (const ctx of captured) {
      expect(typeof ctx[COMPONENT_ID_PROPERTY]).toBe('number');
    }
    expect(fixture.container.querySelector('.tparent .tchild')).not.toBeNull();

    destroyElementSync(rendered as never, false, fixture.api);
    expect(parentDestructorRan).toBe(true);
  });
});

describe('onComponentContextCreated — excludes rows / branch wrappers', () => {
  test('does NOT fire for {{#each}} rows (no double-fire with onRowContextCreated)', () => {
    const comps: Ctx[] = [];
    const rows: object[] = [];
    registerHostHooks({
      onComponentContextCreated: (ctx) => comps.push(ctx as Ctx),
      onRowContextCreated: (ctx) => rows.push(ctx),
    });

    class RowRoot extends Component {
      items = ['a', 'b', 'c'];
      [$template] = template(
        '<ul>{{#each this.items as |x|}}<li>{{x}}</li>{{/each}}</ul>',
      );
    }

    const rendered = render(fixture, RowRoot);

    // Only the ROOT component fires the component hook; the 3 rows fire the ROW
    // hook. The row block wrappers ($_ucw) are excluded from the component hook.
    expect(comps).toHaveLength(1);
    expect(comps[0]).toBe(rendered);
    expect(rows).toHaveLength(3);

    // The two hooks observe disjoint ctxs (a row is never reported as a
    // component and vice-versa).
    for (const rowCtx of rows) {
      expect(comps).not.toContain(rowCtx);
    }
    expect(fixture.container.querySelectorAll('li')).toHaveLength(3);
  });
});

describe('onComponentContextCreated — destructor ordering', () => {
  test('single-component teardown: destructor fires while element still connected (pre-DOM-removal)', () => {
    let connectedAtDestroy: boolean | undefined;
    registerHostHooks({
      onComponentContextCreated: (ctx) => {
        registerDestructor(ctx, () => {
          connectedAtDestroy = firstNode(ctx as Ctx)?.isConnected;
        });
      },
    });

    const Solo = template('<div id="solo">hi</div>');
    const rendered = render(fixture, Solo);
    expect(fixture.container.querySelector('#solo')).not.toBeNull();

    destroyElementSync(rendered as never, false, fixture.api);

    // runDestructorsSync fires a node's destructors BEFORE removing its DOM, so
    // the registered destructor saw the element still attached.
    expect(connectedAtDestroy).toBe(true);
    expect(fixture.container.querySelector('#solo')).toBeNull();
  });

  test('whole-subtree teardown is deterministic parent-before-child', () => {
    const captured: Ctx[] = [];
    const order: Array<{ ctx: Ctx; connected: boolean | undefined }> = [];
    registerHostHooks({
      onComponentContextCreated: (ctx) => {
        captured.push(ctx as Ctx);
        registerDestructor(ctx, () => {
          order.push({
            ctx: ctx as Ctx,
            connected: firstNode(ctx as Ctx)?.isConnected,
          });
        });
      },
    });

    const Child = template('<b class="child">child</b>');
    const Parent = template('<div class="parent"><Child /></div>', {
      scope: { Child },
    });

    const parentCtx = render(fixture, Parent);
    // Hook fired parent-first, so captured = [parentCtx, childCtx].
    expect(captured[0]).toBe(parentCtx);
    const childCtx = captured[1];

    destroyElementSync(parentCtx as never, false, fixture.api);

    // Parent's destructor fires first (the cascade is a pre-order stack walk),
    // then the child's.
    expect(order.map((o) => o.ctx)).toEqual([parentCtx, childCtx]);
    // The destroy ROOT (parent) still had its DOM attached when it fired; the
    // descendant's DOM was already detached with the ancestor's subtree removal.
    expect(order[0].connected).toBe(true);
    expect(order[1].connected).toBe(false);
    expect(fixture.container.querySelector('.parent')).toBeNull();
  });

  test('{{#if}} branch swap: an inner component fires its destructor on collapse', async () => {
    const comps: Ctx[] = [];
    let childDestroyed = false;
    registerHostHooks({
      onComponentContextCreated: (ctx) => {
        comps.push(ctx as Ctx);
        registerDestructor(ctx, () => {
          if (
            (ctx as Ctx)[RENDERED_NODES_PROPERTY]?.[0] &&
            ((ctx as Ctx)[RENDERED_NODES_PROPERTY][0] as HTMLElement).classList?.contains(
              'child',
            )
          ) {
            childDestroyed = true;
          }
        });
      },
    });

    const Child = template('<b class="child">child</b>');
    class IfRoot extends Component {
      _flag = true;
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_flag');
      }
      get flag() {
        return this._flag;
      }
      [$template] = template('<div>{{#if this.flag}}<Child />{{/if}}</div>', {
        scope: { Child },
      });
    }

    const rendered = render(fixture, IfRoot) as unknown as {
      _flag: boolean;
    };
    // Root + Child both fired while the branch is live.
    expect(comps).toHaveLength(2);
    expect(fixture.container.querySelector('.child')).not.toBeNull();

    // Collapse the branch → the inner component tears down.
    rendered._flag = false;
    await settle();

    expect(childDestroyed).toBe(true);
    expect(fixture.container.querySelector('.child')).toBeNull();
  });
});

describe('onComponentContextCreated — inert when unregistered', () => {
  test('unregistered: render + destroy behave identically (no hook, no throw)', () => {
    expect(HOST_HOOKS.onComponentContextCreated).toBeUndefined();

    const Child = template('<b class="child">child</b>');
    const Parent = template('<div class="parent"><Child /></div>', {
      scope: { Child },
    });

    const rendered = render(fixture, Parent);
    const html = fixture.container.innerHTML;
    expect(fixture.container.querySelector('.parent .child')).not.toBeNull();

    expect(() =>
      destroyElementSync(rendered as never, false, fixture.api),
    ).not.toThrow();
    expect(fixture.container.querySelector('.parent')).toBeNull();

    // A no-op registration produces byte-identical DOM (zero behavior change).
    resetHooks();
    registerHostHooks({ onComponentContextCreated: () => {} });
    const rendered2 = render(fixture, Parent);
    expect(fixture.container.innerHTML).toBe(html);
    destroyElementSync(rendered2 as never, false, fixture.api);
  });
});
