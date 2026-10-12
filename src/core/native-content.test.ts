/**
 * Ember native runtime semantics, on templates compiled by
 * `compileTemplateSource` with the native flags and bound to the main entry
 * (the way the Ember native runtime compiler evaluates them), with the native
 * dynamic-content binding registered (dom.ts registers it at module load when
 * the EMBER_NATIVE build constant is on; vitest builds with it off, so the
 * tests register it):
 *   - G15 dynamic content: a `{{value}}` follows its value's KIND — text, DOM
 *     node, trusted HTML (host `classifyContent`), component (gxt template
 *     function), helper — and is read ONCE on create;
 *   - `{{#in-element}}` resolves its destination at MOUNT (document order);
 *     a nullish destination is a host assertion;
 *   - `{{#each}}` keys primitive rows by value (Glimmer `@identity`);
 *   - `{{#each-in}}` (G5) iterates stable `[key, value]` pairs.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as main from './index';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, COMPONENT_ID_PROPERTY, addToTree, $template } from './shared';
import { $SELF } from './self';
import { cId, nativeTreeParent } from './tree';
import { $_c, $_args, $_edp, bindNativeContent } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { renderElement } from './render-core';
import { destroyElementSync } from './destroy';
import { HOST_HOOKS, registerHostHooks } from './host-hooks';
import { tagFor, dirtyCell } from './tags';
import { syncDom } from './runtime';
import { notifyObjectKeyAdded } from './each-in-keyset';
import { $__eachIn } from './helpers/each-in';
import {
  setNativeContentBinding,
  isNativeRuntime,
  nativeContentKind,
  nativeContentText,
  nativeDeepFnValue,
  CONTENT_COMPONENT,
  CONTENT_HELPER,
  CONTENT_HTML,
  CONTENT_NODE,
  CONTENT_TEXT,
} from './native-content';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { $_curry, CURRIED_COMPONENT, CURRIED_HELPER, CURRIED_MODIFIER } from './curried';

const FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_IN_ELEMENT: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};

class SafeString {
  constructor(readonly html: string) {}
  toHTML() {
    return this.html;
  }
  toString() {
    return this.html;
  }
}

function compileNative(tpl: string, scope: Record<string, unknown> = {}) {
  const bindings = new Set(Object.keys(scope));
  const { source, scopeNames, errors } = compileTemplateSource(tpl, { flags: FLAGS, bindings });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  const names = [...scopeNames, ...bindings];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
    ...[...bindings].map((name) => scope[name]),
  ) as (...args: unknown[]) => unknown;
}

describe('Ember native runtime', () => {
  let fixture: DOMFixture;

  function render(tpl: unknown) {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_c(tpl as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    return { parent, instance };
  }

  async function set(obj: Record<string, unknown>, key: string, value: unknown) {
    obj[key] = value;
    dirtyCell(tagFor(obj, key));
    await syncDom();
  }

  beforeEach(() => {
    fixture = createDOMFixture();
    setNativeContentBinding(bindNativeContent);
    registerHostHooks({
      classifyContent: (value: unknown) => (value instanceof SafeString ? 'html' : undefined),
    });
  });

  afterEach(() => {
    setNativeContentBinding(null);
    (HOST_HOOKS as Record<string, unknown>).classifyContent = undefined;
    (HOST_HOOKS as Record<string, unknown>).assert = undefined;
    (HOST_HOOKS as Record<string, unknown>).eachInEntries = undefined;
    fixture.cleanup();
  });

  describe('G15 dynamic content', () => {
    test('classification helpers', () => {
      const api = fixture.api;
      expect(isNativeRuntime()).toBe(true);
      expect(nativeContentKind(api, 'x')).toBe(CONTENT_TEXT);
      expect(nativeContentKind(api, null)).toBe(CONTENT_TEXT);
      expect(nativeContentKind(api, { a: 1 })).toBe(CONTENT_TEXT);
      expect(nativeContentKind(api, fixture.document.createElement('b'))).toBe(CONTENT_NODE);
      expect(nativeContentKind(api, new SafeString('<b>x</b>'))).toBe(CONTENT_HTML);
      expect(nativeContentKind(api, compileNative('x'))).toBe(CONTENT_COMPONENT);
      registerHostHooks({ classifyContent: () => 'helper' });
      expect(nativeContentKind(api, () => 1)).toBe(CONTENT_HELPER);
      expect(nativeContentText(undefined)).toBe('');
      expect(nativeContentText(Object.create(null))).toBe('');
      expect(nativeContentText(12)).toBe('12');
    });

    test('nativeDeepFnValue stops at a host construct, calls plain thunks', () => {
      const Comp = compileNative('<i>c</i>');
      expect(nativeDeepFnValue(() => () => 'v')).toBe('v');
      expect(nativeDeepFnValue(() => Comp)).toBe(Comp);
    });

    test('a value switches text → node → text → trusted HTML → component → text', async () => {
      const self = { v: 'hello' as unknown };
      const Comp = compileNative('<i>component</i>');
      const tpl = compileNative('<p>[{{this.v}}]</p>');
      const { parent } = render(withSelf(tpl, self));
      const p = () => fixture.container.querySelector('p')!;
      expect(p().innerHTML).toBe('[hello]');

      const div = fixture.document.createElement('div');
      div.textContent = 'node';
      await set(self, 'v', div);
      expect(p().innerHTML).toBe('[<div>node</div>]');
      expect(p().firstElementChild).toBe(div);

      await set(self, 'v', 'text again');
      expect(p().innerHTML).toBe('[text again]');
      expect(div.isConnected).toBe(false);

      await set(self, 'v', new SafeString('<b>bold</b><u>u</u>'));
      expect(p().innerHTML).toBe('[<b>bold</b><u>u</u>]');

      await set(self, 'v', Comp);
      expect(p().textContent).toBe('[component]');
      expect(p().querySelector('i')).not.toBeNull();

      await set(self, 'v', 42);
      expect(p().innerHTML).toBe('[42]');

      destroyElementSync(parent, false, fixture.api);
      expect(fixture.container.innerHTML).toBe('');
    });

    test('a value that STARTS as a node / trusted HTML is reactive', async () => {
      const a = fixture.document.createElement('a');
      const self = { v: a as unknown };
      render(withSelf(compileNative('<p>{{this.v}}</p>'), self));
      const p = fixture.container.querySelector('p')!;
      expect(p.firstElementChild).toBe(a);
      await set(self, 'v', new SafeString('<em>e</em>'));
      expect(p.innerHTML).toBe('<em>e</em>');
      await set(self, 'v', new SafeString('<em>e</em>'));
      expect(p.innerHTML).toBe('<em>e</em>');
      await set(self, 'v', undefined);
      expect(p.innerHTML).toBe('');
    });

    test('a constant trusted-HTML value renders (no stringification)', () => {
      // (a content unit used to be spliced into the list renderElement was
      // iterating — the text after it was skipped)
      const safe = new SafeString('<s>trusted</s>');
      render(compileNative('{{safe}}|', { safe }));
      expect(fixture.container.innerHTML).toBe('<s>trusted</s>|');
    });

    test('a dynamic `{{value}}` child of an element is content, not a textContent fold', async () => {
      const self = { v: new SafeString('<b>x</b>') as unknown };
      render(withSelf(compileNative('<span>{{this.v}}</span>'), self));
      expect(fixture.container.querySelector('span')!.innerHTML).toBe('<b>x</b>');
    });

    test('a content unit replaces its anchor in the owner rendered-nodes (in place)', async () => {
      const self = { v: 'text' as unknown };
      const { instance } = render(withSelf(compileNative('{{this.v}}|'), self));
      const nodes = (instance as any)[RENDERED_NODES_PROPERTY] as unknown[];
      expect(nodes).toHaveLength(2);
      const anchor = nodes[0] as Node;
      expect(anchor.nodeType).toBe(3);
      await set(self, 'v', new SafeString('<b>1</b><b>2</b>'));
      expect(nodes).toHaveLength(2);
      const unitNodes = (nodes[0] as any)[RENDERED_NODES_PROPERTY] as Node[];
      expect(unitNodes.map((n) => n.textContent)).toEqual(['1', '2', '']);
      expect(unitNodes[2]).toBe(anchor);
      await set(self, 'v', 'text');
      expect(nodes[0]).toBe(anchor);
      expect(fixture.container.innerHTML).toBe('text|');
    });

    test('a helper value is invoked; its result is content', async () => {
      registerHostHooks({
        classifyContent: (value: unknown) =>
          typeof value === 'function' && (value as { isHelper?: boolean }).isHelper ? 'helper' : undefined,
      });
      const helper = Object.assign(() => 'from helper', { isHelper: true });
      const self = { v: helper as unknown };
      render(withSelf(compileNative('<p>{{this.v}}</p>'), self));
      expect(fixture.container.querySelector('p')!.textContent).toBe('from helper');
    });

    test('a content getter runs ONCE on create (Glimmer parity), once per update', async () => {
      let reads = 0;
      const self = {
        n: 1,
        get value() {
          reads++;
          return (this as { n: number }).n;
        },
      };
      render(withSelf(compileNative('<p>{{this.value}}</p>'), self));
      expect(fixture.container.querySelector('p')!.textContent).toBe('1');
      expect(reads).toBe(1);
      await set(self as never, 'n', 2);
      dirtyCell(tagFor(self, 'value'));
      await syncDom();
      expect(fixture.container.querySelector('p')!.textContent).toBe('2');
      expect(reads).toBe(2);
    });
  });

  describe('{{#in-element}} at mount', () => {
    test('a destination created by the same render is found', () => {
      const getEl = (id: string) => fixture.container.querySelector(`#${id}`);
      render(compileNative('[<div id="t"></div>][{{#in-element (getEl "t")}}in{{/in-element}}after]', { getEl }));
      expect(fixture.container.querySelector('#t')!.textContent).toBe('in');
      expect(fixture.container.textContent).toBe('[in][after]');
    });

    test('appending to the render target keeps document order', () => {
      const target = fixture.container;
      render(compileNative('Before{{#in-element target insertBefore=null}}Whoop!{{/in-element}}After', { target }));
      expect(fixture.container.textContent).toBe('BeforeWhoop!After');
    });

    test('a nullish destination is a host assertion', () => {
      const messages: string[] = [];
      registerHostHooks({
        assert(message: string) {
          messages.push(message);
          throw new Error(`assert: ${message}`);
        },
      });
      const nothing = null;
      expect(() => render(compileNative('{{#in-element nothing}}x{{/in-element}}', { nothing }))).toThrow(
        /assert: You cannot pass a null or undefined destination element to in-element/,
      );
      expect(messages).toHaveLength(1);
    });

    test('insertBefore=<non-null> goes through the host assertion channel', () => {
      registerHostHooks({
        assert(message: string) {
          throw new Error(`assert: ${message}`);
        },
      });
      const el = fixture.document.createElement('div');
      expect(() => render(compileNative('{{#in-element el insertBefore=".foo"}}x{{/in-element}}', { el }))).toThrow(
        /assert: Can only pass null to insertBefore in in-element, received: \.foo/,
      );
    });
  });

  describe('dynamic helper / modifier names (Glimmer -disallow-dynamic-resolution)', () => {
    test('a thunk (dynamic) string definition asserts through the host; literals and components do not', () => {
      registerHostHooks({
        assert(message: string) {
          throw new Error(`assert: ${message}`);
        },
      });
      expect(() => $_curry(CURRIED_HELPER, [() => 'hello-world'], {})).toThrow(
        /assert: Passing a dynamic string to the `\(helper\)` keyword is disallowed\./,
      );
      expect(() => $_curry(CURRIED_MODIFIER, [() => 'replace'], {})).toThrow(
        /assert: Passing a dynamic string to the `\(modifier\)` keyword is disallowed\./,
      );
      expect(() => $_curry(CURRIED_HELPER, ['hello-world'], {})).not.toThrow();
      expect(() => $_curry(CURRIED_COMPONENT, [() => 'foo-bar'], {})).not.toThrow();
      const fn = () => 'x';
      expect(() => $_curry(CURRIED_HELPER, [() => fn], {})).not.toThrow();
    });

    test('without the native runtime: no assertion (historic)', () => {
      setNativeContentBinding(null);
      expect(() => $_curry(CURRIED_HELPER, [() => 'hello-world'], {})).not.toThrow();
    });
  });

  describe('captureRenderTree bounds (native)', () => {
    test('a node whose rendered list starts with a nested component has DOM bounds', () => {
      const Inner = compileNative('<i>inner</i>');
      const Outer = compileNative('<Inner /><b>last</b>', { Inner });
      const { parent } = render(Outer);
      const [tree] = main.captureRenderTree([parent] as never);
      const outer = tree!.children[0]!;
      expect(outer.bounds).not.toBeNull();
      expect((outer.bounds!.firstNode as Element).tagName).toBe('I');
      expect((outer.bounds!.lastNode as Element).tagName).toBe('B');
      expect(outer.bounds!.parentElement).toBe(fixture.container);
    });
  });

  describe('gxt renderComponent nextSibling', () => {
    test('null appends after existing children; omitted keeps the historic placeholder', () => {
      const target = fixture.document.createElement('div');
      target.innerHTML = '<i>a</i><i>b</i>';
      main.renderComponent(compileNative('<b>x</b>') as never, {
        owner: fixture.root as never,
        element: target as never,
        nextSibling: null,
      });
      expect(target.innerHTML.replace(/ data-node-id="\d+"/g, '')).toBe('<i>a</i><i>b</i><b>x</b>');
      const second = fixture.document.createElement('div');
      second.innerHTML = '<i>a</i><i>b</i>';
      main.renderComponent(compileNative('<b>y</b>') as never, {
        owner: fixture.root as never,
        element: second as never,
      });
      expect(second.innerHTML.replace(/ data-node-id="\d+"/g, '')).toBe('<i>a</i><b>y</b><i>b</i>');
    });
  });

  describe('{{#each}} primitive rows by value (@identity)', () => {
    test('a moved primitive row is kept, and its index follows', async () => {
      const self = { items: [1, 2, 3] as unknown[] };
      render(withSelf(compileNative('{{#each this.items as |n idx|}}<i>{{idx}}:{{n}}</i>{{/each}}'), self));
      const third = fixture.container.querySelectorAll('i')[2];
      expect(third!.textContent).toBe('2:3');
      await set(self, 'items', [1, 3]);
      const rows = fixture.container.querySelectorAll('i');
      expect(Array.from(rows).map((r) => r.textContent)).toEqual(['0:1', '1:3']);
      expect(rows[1]).toBe(third);
    });

    test('duplicate primitives render as distinct rows; 1 and "1" are different keys', async () => {
      const self = { items: [1, 1, '1'] as unknown[] };
      render(withSelf(compileNative('{{#each this.items as |n|}}<i>{{n}}</i>{{/each}}'), self));
      expect(fixture.container.querySelectorAll('i')).toHaveLength(3);
      const stringRow = fixture.container.querySelectorAll('i')[2];
      await set(self, 'items', ['1', 1]);
      const rows = fixture.container.querySelectorAll('i');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toBe(stringRow);
    });
  });

  describe('{{#each-in}} (G5)', () => {
    test('pairs are stable per (key, value)', () => {
      const obj: Record<string, unknown> = { a: 1, b: 2 };
      const first = $__eachIn(obj);
      expect(first).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
      const second = $__eachIn(obj);
      expect(second[0]).toBe(first[0]);
      obj.b = 3;
      const third = $__eachIn(obj);
      expect(third[0]).toBe(first[0]);
      expect(third[1]).not.toBe(first[1]);
      expect($__eachIn(null)).toEqual([]);
      expect($__eachIn('str')).toEqual([]);
    });

    test('renders keys / values, updates a value, picks up an added key, else block', async () => {
      const obj: Record<string, unknown> = { a: 1, b: 2 };
      const self = { obj: obj as unknown };
      render(
        withSelf(
          compileNative('{{#each-in this.obj as |k v|}}<i>{{k}}:{{v}}</i>{{else}}empty{{/each-in}}'),
          self,
        ),
      );
      expect(fixture.container.textContent).toBe('a:1b:2');
      const aRow = fixture.container.querySelector('i');
      await set(obj, 'b', 3);
      expect(fixture.container.textContent).toBe('a:1b:3');
      expect(fixture.container.querySelector('i')).toBe(aRow);
      obj.c = 4;
      notifyObjectKeyAdded(obj, 'c');
      await syncDom();
      expect(fixture.container.textContent).toBe('a:1b:3c:4');
      await set(self, 'obj', {});
      expect(fixture.container.textContent).toBe('empty');
    });

    test('a host eachInEntries hook supplies the entries (Maps)', () => {
      registerHostHooks({
        eachInEntries: (obj: object) =>
          obj instanceof Map ? Array.from(obj.entries()) : Object.entries(obj),
      });
      const map = new Map<unknown, unknown>([
        ['x', 'X'],
        [2, 'two'],
      ]);
      render(compileNative('{{#each-in map as |k v|}}[{{k}}={{v}}]{{/each-in}}', { map }));
      expect(fixture.container.textContent).toBe('[x=X][2=two]');
    });
  });
});

/** A definition rendering `tpl` on a fresh node whose self is `self` (the Ember host's shape). */
function withSelf(tpl: unknown, self: object) {
  return function SelfComponent() {
    return { [COMPONENT_ID_PROPERTY]: cId(), [$SELF]: self, [$template]: tpl };
  };
}

describe('nativeTreeParent (EMBER_NATIVE if / each tree parent)', () => {
  test('a descendant active parent wins; an ancestor (the invoker) does not', () => {
    const root = { [COMPONENT_ID_PROPERTY]: cId(), [RENDERED_NODES_PROPERTY]: [] } as any;
    const invoker = { [COMPONENT_ID_PROPERTY]: cId(), [RENDERED_NODES_PROPERTY]: [] } as any;
    const component = { [COMPONENT_ID_PROPERTY]: cId(), [RENDERED_NODES_PROPERTY]: [] } as any;
    const wrapper = { [COMPONENT_ID_PROPERTY]: cId(), [RENDERED_NODES_PROPERTY]: [] } as any;
    const stranger = { [COMPONENT_ID_PROPERTY]: cId(), [RENDERED_NODES_PROPERTY]: [] } as any;
    addToTree(root, invoker);
    addToTree(invoker, component);
    addToTree(component, wrapper);
    expect(nativeTreeParent(wrapper, component)).toBe(wrapper);
    expect(nativeTreeParent(invoker, component)).toBe(component);
    expect(nativeTreeParent(stranger, component)).toBe(component);
    expect(nativeTreeParent(null, component)).toBe(component);
    expect(nativeTreeParent(component, component)).toBe(component);
  });
});
