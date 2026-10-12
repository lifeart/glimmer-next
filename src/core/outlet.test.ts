/**
 * Runtime tests for `$_outlet` (G3): the Ember `{{outlet}}` keyword compiled
 * under the EMBER_OUTLET flag renders the host's outlet component
 * (`HOST_HOOKS.outletComponent`) through the regular component machinery, as a
 * render-tree child of the context the `{{outlet}}` appears in — so the host
 * component can read its outlet state from that context chain.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, COMPONENT_ID_PROPERTY, addToTree, $template, PARENT, TREE } from './shared';
import { $_c, $_args, $_edp, $_outlet } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { renderElement } from './render-core';
import { destroyElementSync } from './destroy';
import { getContext, provideContext } from './context';
import { registerDestructor } from './glimmer/destroyable';
import { HOST_HOOKS, registerHostHooks } from './host-hooks';
import { cell } from './reactive';
import { syncDom } from './runtime';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../plugins/runtime-compiler';

const OUTLET_STATE = Symbol('test-outlet-state');
const OUTLET = { EMBER_OUTLET: true };

describe('$_outlet (G3: {{outlet}} → host outlet component)', () => {
  let fixture: DOMFixture;
  let previousOutlet: unknown;

  function render(component: unknown, parent = new Component({})) {
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_c(component as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    return { parent, instance };
  }

  beforeEach(() => {
    fixture = createDOMFixture();
    setupGlobalScope();
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
    previousOutlet = HOST_HOOKS.outletComponent;
  });

  afterEach(() => {
    (HOST_HOOKS as Record<string, unknown>).outletComponent = previousOutlet;
    fixture.cleanup();
  });

  test('is a runtime-compiler symbol', () => {
    expect(GXT_RUNTIME_SYMBOLS.$_outlet).toBe($_outlet);
  });

  test('throws a descriptive error when the host registered no outlet component', () => {
    (HOST_HOOKS as Record<string, unknown>).outletComponent = undefined;
    const Route = template('<main>{{outlet}}</main>', { flags: OUTLET });
    expect(() => render(Route)).toThrow(/registerHostHooks\(\{ outletComponent \}\)/);
  });

  test('renders the host outlet component where {{outlet}} appears, reading context from the enclosing template', () => {
    const seenParents: unknown[] = [];
    class HostOutlet extends Component {
      get label() {
        seenParents.push(TREE.get(PARENT.get(this[COMPONENT_ID_PROPERTY])!));
        return getContext<string>(this, OUTLET_STATE, false) ?? 'none';
      }
      [$template] = template('<span class="outlet">{{this.label}}</span>');
    }
    registerHostHooks({ outletComponent: HostOutlet });

    // The route template provides the outlet state on its own context.
    class Route extends Component {
      constructor(args: any) {
        super(args);
        provideContext(this, OUTLET_STATE, 'route-state');
      }
      [$template] = template('<h1>r</h1><main>{{outlet}}</main>', { flags: OUTLET });
    }
    const { instance } = render(Route);
    const main = fixture.container.querySelector('main')!;
    expect(main.querySelector('span.outlet')!.textContent).toBe('route-state');
    expect(main.children).toHaveLength(1);
    // The outlet's render-tree parent is the template context ({{outlet}} at
    // template level → `this`).
    expect(seenParents[0]).toBe(instance);
  });

  test('inside a yielded block the block context is the parent (context still reaches the outer template)', () => {
    class HostOutlet extends Component {
      get label() {
        return getContext<string>(this, OUTLET_STATE, false) ?? 'none';
      }
      [$template] = template('<span>{{this.label}}</span>');
    }
    registerHostHooks({ outletComponent: HostOutlet });
    // A class-based layout: a runtime-compiled TEMPLATE-ONLY `template()` is
    // constructed without a tree id (prototype-less factory), so its yielded
    // block context is not attached to the tree — unrelated to `$_outlet`.
    class Layout extends Component {
      [$template] = template('<div class="layout">{{yield}}</div>');
    }
    class Route extends Component {
      constructor(args: any) {
        super(args);
        provideContext(this, OUTLET_STATE, 'outer');
      }
      [$template] = template('<Layout>{{outlet}}</Layout>', { flags: OUTLET, scope: { Layout } });
    }
    render(Route);
    expect(fixture.container.querySelector('.layout')!.textContent).toBe('outer');
  });

  test('a block param named outlet shadows the keyword (no host component rendered)', () => {
    let rendered = 0;
    class HostOutlet extends Component {
      constructor(args: any) {
        super(args);
        rendered++;
      }
      [$template] = template('<span>outlet</span>');
    }
    registerHostHooks({ outletComponent: HostOutlet });
    const Route = template('{{#let "shadow" as |outlet|}}<p>{{outlet}}</p>{{/let}}', {
      flags: OUTLET,
    });
    render(Route);
    expect(rendered).toBe(0);
    expect(fixture.container.querySelector('p')!.textContent).toBe('shadow');
  });

  test('the outlet component is torn down with its parent (destructors run, DOM removed)', () => {
    let destroyed = 0;
    class HostOutlet extends Component {
      constructor(args: any) {
        super(args);
        registerDestructor(this, () => {
          destroyed++;
        });
      }
      [$template] = template('<span class="o">o</span>');
    }
    registerHostHooks({ outletComponent: HostOutlet });
    const Route = template('<main>{{outlet}}</main>', { flags: OUTLET });
    const { parent } = render(Route);
    expect(fixture.container.querySelector('.o')).not.toBeNull();
    destroyElementSync(parent, false, fixture.api);
    expect(destroyed).toBe(1);
    expect(fixture.container.querySelector('.o')).toBeNull();
  });

  test('the host outlet component re-renders reactively like any component', async () => {
    const state = cell('a');
    class HostOutlet extends Component {
      get value() {
        return state.value;
      }
      [$template] = template('<b>{{this.value}}</b>');
    }
    registerHostHooks({ outletComponent: HostOutlet });
    render(template('{{outlet}}', { flags: OUTLET }));
    expect(fixture.container.querySelector('b')!.textContent).toBe('a');
    state.update('b');
    await syncDom();
    expect(fixture.container.querySelector('b')!.textContent).toBe('b');
  });
});
