/**
 * Trusted-HTML (`$_html`) reactivity + component-context regressions.
 *
 * These cover the three gaps that blocked the Ember dual-backend from consuming
 * gxt's native trusted-HTML runtime (the `EMBER_TRUSTED_HTML` compile flag →
 * `$_html(() => expr, this)`), reproduced here in pure gxt:
 *
 *   1. component-context / top-level `{{{this.output}}}` (a class field that IS
 *      present at first eval) — renders its parsed HTML (never empty);
 *   2. absent-path `{{{this.name}}}` (undefined at first eval, `set` later) —
 *      becomes reactive via host absent-path materialization;
 *   3. null-proto `{{{this.nullObject.message}}}` (nested `set` on a held
 *      null-proto object) — becomes reactive via the host value-owner reverse
 *      lookup.
 *
 * Gaps 2 & 3 diverged from gxt's NORMAL reactive text / renderable binding
 * (`resolveRenderable` / `resolveBindingValue` / `$ev` TEXT_CONTENT), which run
 * the same getter under `materializeAbsentPathCell` + `registerLeafOwnersForFormula`.
 * `$_html` did not wire those host hooks; it now does. The hooks are no-ops
 * standalone, so a bridge-less gxt sees identical behavior — exercised by the
 * pure "tracked-cell" variants below (which never install a host hook).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree, $template } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cell, cellFor } from './reactive';
import { registerHostHooks, HOST_HOOKS } from './host-hooks';
import { renderElement } from './render-core';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
  type TemplateOptions,
} from '../../plugins/runtime-compiler';

const TRUSTED_FLAGS: TemplateOptions = {
  flags: { EMBER_TRUSTED_HTML: true },
};

describe('$_html reactivity + component-context', () => {
  let fixture: DOMFixture;

  function render<T = any>(component: T) {
    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parentComponent);
    const args = $_args({}, false, $_edp as any);
    const instance = $_c(component as any, args, parentComponent);
    renderElement(fixture.api, parentComponent, fixture.container, instance);
    return { instance, parentComponent };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 50));

  beforeEach(() => {
    fixture = createDOMFixture();
    setupGlobalScope();
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  afterEach(() => {
    fixture.cleanup();
    for (const k of Object.keys(HOST_HOOKS)) delete (HOST_HOOKS as any)[k];
  });

  // ---- GAP 1: component-context / top-level render --------------------------

  test('GAP1: top-level {{{this.output}}} (no wrapping element) renders parsed HTML', () => {
    class C extends Component {
      output = 'you need to be more <b>bold</b>';
      [$template] = template('{{{this.output}}}', TRUSTED_FLAGS);
    }
    render(C);
    expect(fixture.container.querySelector('b')?.textContent).toBe('bold');
    expect(fixture.container.textContent).toBe('you need to be more bold');
  });

  test('GAP1: top-level cell-backed field renders AND updates (Ember tracked shape)', async () => {
    class C extends Component {
      outputCell = cell('you need to be more <b>bold</b>');
      get output() {
        return this.outputCell.value;
      }
      [$template] = template('{{{this.output}}}', TRUSTED_FLAGS);
    }
    const { instance } = render(C);
    expect(fixture.container.querySelector('b')?.textContent).toBe('bold');

    (instance as any).outputCell.update('you are so <i>super</i>');
    await flush();
    expect(fixture.container.querySelector('b')).toBeNull();
    expect(fixture.container.querySelector('i')?.textContent).toBe('super');
  });

  // ---- GAPS 2 & 3: pure-gxt tracked variants (NO host hook) -----------------
  // Prove the formula + opcode re-tracking machinery is correct standalone.

  test('GAP2 (standalone): absent-then-set via a tracked cell updates', async () => {
    class C extends Component {
      nameCell = cell<string | undefined>(undefined);
      get name() {
        return this.nameCell.value;
      }
      [$template] = template('<div id="host">{{{this.name}}}</div>', TRUSTED_FLAGS);
    }
    const { instance } = render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.textContent).toBe('');

    (instance as any).nameCell.update('foo-<b>bar</b>');
    await flush();
    expect(host.querySelector('b')?.textContent).toBe('bar');
    expect(host.textContent).toBe('foo-bar');
  });

  test('GAP3 (standalone): nested tracked value mutation updates', async () => {
    const obj = { msg: cell('hello') };
    class C extends Component {
      nested = obj;
      get value() {
        return this.nested.msg.value;
      }
      [$template] = template('<div id="host">{{{this.value}}}</div>', TRUSTED_FLAGS);
    }
    render(C);
    const host = fixture.container.querySelector('#host')!;
    expect(host.textContent).toBe('hello');

    obj.msg.update('goodbye');
    await flush();
    expect(host.textContent).toBe('goodbye');
  });

  // ---- GAPS 2 & 3: through a minimal Ember-bridge simulation ----------------
  // Installs the two host hooks the Ember dual-backend provides and that gxt's
  // normal binding path consults; these previously did nothing for $_html.

  describe('through the host bridge (Ember shape)', () => {
    const valueOwners = new WeakMap<object, { obj: object; key: string }>();
    let currentThis: unknown = null;

    function installBridge() {
      registerHostHooks({
        getCurrentTemplateThis: () => currentThis,
        registerObjectValueOwner: (value, obj, key) => {
          valueOwners.set(value as object, {
            obj: obj as object,
            key: key as string,
          });
        },
      });
    }

    // Ember-like set(): dirties the directly-owned cell, plus (for a nested
    // mutation on a held leaf) the cell that OWNS the leaf via reverse lookup.
    function emberSet(obj: any, key: string, val: unknown) {
      const owner = valueOwners.get(obj);
      cellFor(obj, key as any).update(val as any);
      if (owner) {
        cellFor(owner.obj as any, owner.key as any).update(
          (owner.obj as any)[owner.key]
        );
      }
    }

    beforeEach(() => {
      currentThis = null;
    });

    test('GAP2: absent-path {{{this.name}}} becomes reactive after set()', async () => {
      installBridge();
      // `name` is a plain (undefined) property, NOT pre-celled — exactly how
      // Ember leaves an unset dynamic path until `set` materializes it.
      class C extends Component {
        name: string | undefined = undefined;
        constructor(...args: any[]) {
          // @ts-expect-error component ctor spread
          super(...args);
          currentThis = this; // host: currently-evaluating template `this`
        }
        [$template] = template(
          '<div id="host">{{{this.name}}}</div>',
          TRUSTED_FLAGS
        );
      }
      const { instance } = render(C);
      const host = fixture.container.querySelector('#host')!;
      expect(host.textContent).toBe('');

      emberSet(instance, 'name', 'foo-<b>bar</b>');
      await flush();
      expect(host.querySelector('b')?.textContent).toBe('bar');
      expect(host.textContent).toBe('foo-bar');
    });

    test('GAP3: null-proto {{{this.nullObject.message}}} reactive on nested set()', async () => {
      installBridge();
      const nullObject: any = Object.create(null);
      nullObject.message = 'hello';
      // Ember backs component properties with tracked cells, so `this.nullObject`
      // reads THROUGH a cell (materialized in the ctor here). $_html's
      // registerLeafOwnersForFormula must then register the held null-proto
      // object as owned by (component,'nullObject').
      class C extends Component {
        nullObject = nullObject;
        constructor(...args: any[]) {
          // @ts-expect-error component ctor spread
          super(...args);
          currentThis = this;
          cellFor(this, 'nullObject');
        }
        [$template] = template(
          '<div id="host">{{{this.nullObject.message}}}</div>',
          TRUSTED_FLAGS
        );
      }
      render(C);
      const host = fixture.container.querySelector('#host')!;
      expect(host.textContent).toBe('hello');

      emberSet(nullObject, 'message', 'goodbye');
      await flush();
      expect(host.textContent).toBe('goodbye');
    });
  });
});
