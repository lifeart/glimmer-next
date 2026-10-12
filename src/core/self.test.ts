/**
 * Runtime tests for the Ember native layer's template self (G6, `$_self` /
 * `$SELF`) and property-tag reads (G8, `$__tag` + the host `getProp` hook), on
 * templates compiled by `compileTemplateSource` (the AOT-identical runtime
 * source) and bound to the main entry's exports — the way the Ember native
 * runtime compiler evaluates them. Also: a runtime `template()` TEMPLATE-ONLY
 * component is a real render-tree node (render contexts reach its blocks).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as main from './index';
import { $_self, $SELF } from './self';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, COMPONENT_ID_PROPERTY, addToTree, $template } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { renderElement } from './render-core';
import { destroyElementSync } from './destroy';
import { getContext, provideContext } from './context';
import { HOST_HOOKS, registerHostHooks } from './host-hooks';
import { tagFor, dirtyCell } from './tags';
import { syncDom } from './runtime';
import { cId } from './tree';
import { compileTemplateSource, template } from '../../plugins/runtime-compiler';

const FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};

/** Evaluate `compileTemplateSource` output with every scope name bound from the main entry. */
function compileNative(tpl: string): (...args: unknown[]) => unknown {
  const { source, scopeNames, errors } = compileTemplateSource(tpl, { flags: FLAGS });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
  ) as (...args: unknown[]) => unknown;
}

/** A definition rendering `tpl` on a fresh node whose self is `self` (the Ember host's selfComponent). */
function withSelf(tpl: unknown, self: object) {
  return function SelfComponent() {
    return { [COMPONENT_ID_PROPERTY]: cId(), [$SELF]: self, [$template]: tpl };
  };
}

describe('$_self', () => {
  test('a node without $SELF is its own self; $SELF wins otherwise', () => {
    const node = {};
    expect($_self(node)).toBe(node);
    const self = { a: 1 };
    expect($_self({ [$SELF]: self })).toBe(self);
  });
});

describe('EMBER_SELF + EMBER_PROPERTY_TAGS at runtime', () => {
  let fixture: DOMFixture;
  let previousGetProp: unknown;

  function render(component: unknown) {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_c(component as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    return { parent, instance };
  }

  beforeEach(() => {
    fixture = createDOMFixture();
    previousGetProp = HOST_HOOKS.getProp;
  });

  afterEach(() => {
    (HOST_HOOKS as Record<string, unknown>).getProp = previousGetProp;
    registerHostHooks({});
    fixture.cleanup();
  });

  test('`this` paths read the self; the self is never written to (it is not the node)', async () => {
    const self = { name: 'world', model: { first: 'one' } };
    const tpl = compileNative('<p>{{this.name}} {{this.model.first}}</p>');
    render(withSelf(tpl, self));
    expect(fixture.container.querySelector('p')!.textContent).toBe('world one');
    expect(Object.getOwnPropertySymbols(self)).toEqual([]);
    expect(Object.keys(self)).toEqual(['name', 'model']);
  });

  test('without a host getProp hook a tap consumes gxt tagFor: dirtyCell re-renders', async () => {
    (HOST_HOOKS as Record<string, unknown>).getProp = undefined;
    registerHostHooks({});
    const self = { model: { first: 'one' } };
    render(withSelf(compileNative('<b>{{this.model.first}}</b>'), self));
    expect(fixture.container.querySelector('b')!.textContent).toBe('one');
    self.model.first = 'two';
    dirtyCell(tagFor(self.model, 'first'));
    await syncDom();
    expect(fixture.container.querySelector('b')!.textContent).toBe('two');
  });

  test('with a host getProp hook every member read goes through it', async () => {
    const reads: string[] = [];
    registerHostHooks({
      getProp(obj: object, key: string) {
        reads.push(key);
        main.getTracker()?.add(tagFor(obj, key));
        return key === 'missing' ? `<${key}>` : (obj as Record<string, unknown>)[key];
      },
    });
    const self = { model: { first: 'one' } };
    render(withSelf(compileNative('<i>{{this.model.first}} {{this.missing}}</i>'), self));
    expect(fixture.container.querySelector('i')!.textContent).toBe('one <missing>');
    expect(reads).toContain('model');
    expect(reads).toContain('first');
    self.model = { first: 'three' };
    dirtyCell(tagFor(self, 'model'));
    await syncDom();
    expect(fixture.container.querySelector('i')!.textContent).toBe('three <missing>');
  });

  test('{{#each}} with an index over a non-array iterable (Set)', async () => {
    // The index formula located rows with `tagValue.indexOf(item)` — a TypeError
    // for a Set / forEach-able / Symbol.iterator source.
    const a = { n: 'a' };
    const b = { n: 'b' };
    const self = { items: new Set([a, b]) };
    render(withSelf(compileNative('{{#each this.items as |item i|}}[{{i}}:{{item.n}}]{{/each}}'), self));
    expect(fixture.container.textContent).toBe('[0:a][1:b]');
    self.items = new Set([b, { n: 'c' }]);
    dirtyCell(tagFor(self, 'items'));
    await syncDom();
    expect(fixture.container.textContent).toBe('[0:b][1:c]');
  });

  test('blocks and teardown: the render node owns the DOM, not the self', async () => {
    const self = { show: true, label: 'x' };
    const { parent } = render(withSelf(compileNative('{{#if this.show}}<em>{{this.label}}</em>{{/if}}'), self));
    expect(fixture.container.querySelector('em')!.textContent).toBe('x');
    self.show = false;
    dirtyCell(tagFor(self, 'show'));
    await syncDom();
    expect(fixture.container.querySelector('em')).toBeNull();
    destroyElementSync(parent, false, fixture.api);
    expect(Object.getOwnPropertySymbols(self)).toEqual([]);
  });
});

describe('runtime template(): template-only components are render-tree nodes', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
  });
  afterEach(() => fixture.cleanup());

  test('render contexts reach the yielded block of a template-only template()', () => {
    const KEY = Symbol('ctx');
    class Reader extends Component {
      get value() {
        return getContext<string>(this, KEY, false) ?? 'none';
      }
      [$template] = template('<span>{{this.value}}</span>');
    }
    const Layout = template('<div class="layout">{{yield}}</div>');
    class Root extends Component {
      constructor(args: any) {
        super(args);
        provideContext(this, KEY, 'from-root');
      }
      [$template] = template('<Layout><Reader /></Layout>', { scope: { Layout, Reader } });
    }
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_c(Root as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    expect(fixture.container.querySelector('.layout span')!.textContent).toBe('from-root');
  });
});
