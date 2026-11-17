/**
 * Native `{{#each-in}}` keying, rendered (emberjs/ember.js#21340: the native
 * "{{#each-in}} with the key option" tests).
 *
 * The rows of an each-in are keyed by the row keys `$__eachIn` gives the
 * entries for the `key=` option, whatever object the each-in iterates: a row
 * is kept (its DOM node), moved or re-created as in Glimmer, also when the
 * source is replaced by a new object. A kept row reads its key and value
 * through the reference to its entry, so it shows the entry's current key and
 * value. Mirrors the EMBER_NATIVE render harness in list.native-rows.test.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as main from './index';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, COMPONENT_ID_PROPERTY, addToTree, $template } from './shared';
import { $SELF } from './self';
import { cId } from './tree';
import { $_c, $_args, $_edp, bindNativeContent } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { renderElement } from './render-core';
import { tagFor, dirtyCell } from './tags';
import { syncDom } from './runtime';
import { setNativeContentBinding } from './native-content';
import { HOST_HOOKS } from './host-hooks';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { registerItemReferenceRuntime } from './item-references';

const NATIVE_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};
type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

function compileNative(tpl: string) {
  const { source, scopeNames, errors } = compileTemplateSource(tpl, { flags: NATIVE_FLAGS });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
  ) as unknown;
}

function withSelf(tpl: unknown, self: object) {
  return function SelfComponent() {
    return { [COMPONENT_ID_PROPERTY]: cId(), [$SELF]: self, [$template]: tpl };
  };
}

describe('native {{#each-in}} keying, rendered (each-in key option)', () => {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;

  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = true;
    runtime.WITH_EMBER_INTEGRATION = true;
    // an Ember host installs the item reference runtime ({{#each-in}} rows)
    registerItemReferenceRuntime();
    fixture = createDOMFixture();
    setNativeContentBinding(bindNativeContent);
  });
  afterEach(() => {
    setNativeContentBinding(null);
    delete (HOST_HOOKS as Record<string, unknown>).eachInEntries;
    fixture.cleanup();
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
  });

  function render(tpl: unknown) {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_c(tpl as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
  }
  async function replace(obj: Record<string, unknown>, key: string, value: unknown) {
    obj[key] = value;
    dirtyCell(tagFor(obj, key));
    await syncDom();
  }
  const lis = () => Array.from(fixture.container.querySelectorAll('li'));
  const texts = () => lis().map((li) => li.textContent);

  // `<li>{{name}}: {{value}}</li>` rows over `this.hash` with `key=KEY`.
  function renderHash(self: { hash: unknown }, key: string | null, value = 'value') {
    const keyOption = key === null ? '' : ` key="${key}"`;
    render(
      withSelf(
        compileNative(
          `<ul>{{#each-in this.hash${keyOption} as |name value|}}<li>{{name}}: {{${value}}}</li>{{/each-in}}</ul>`,
        ),
        self,
      ),
    );
  }

  test("by default the entry's value is the key: a changed value replaces its row, also in a new object", async () => {
    const self = { hash: { a: 1, b: 2 } as unknown };
    renderHash(self, null);
    const before = lis();
    expect(texts()).toEqual(['a: 1', 'b: 2']);

    await replace(self, 'hash', { a: 1, b: 3 });
    const after = lis();
    expect(texts()).toEqual(['a: 1', 'b: 3']);
    expect(after[0]).toBe(before[0]); // unchanged entry keeps its node
    expect(after[1]).not.toBe(before[1]); // changed entry gets a new node
  });

  test('key="@key": keyed by the property name, a changed value updates its row in place', async () => {
    const self = { hash: { a: 1, b: 2 } as unknown };
    renderHash(self, '@key');
    const before = lis();

    await replace(self, 'hash', { a: 1, b: 3 });
    const after = lis();
    expect(texts()).toEqual(['a: 1', 'b: 3']);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  test('key="@index": keyed by the property name, so a row moves with its name and keeps its node through a new value', async () => {
    const self = { hash: { a: 1, b: 2 } as unknown };
    renderHash(self, '@index');
    const before = lis();

    await replace(self, 'hash', { b: 2, a: 9 });
    const after = lis();
    expect(texts()).toEqual(['b: 2', 'a: 9']);
    expect(after[0]).toBe(before[1]); // b's node moves with its name
    expect(after[1]).toBe(before[0]); // a's node moves and survives its new value
  });

  test("a path key is looked up on the entry's value", async () => {
    const self = { hash: { a: { id: 1 }, b: { id: 2 } } as unknown };
    renderHash(self, 'id', 'value.id');
    const before = lis();
    expect(texts()).toEqual(['a: 1', 'b: 2']);

    await replace(self, 'hash', { a: { id: 9 }, b: { id: 2 } });
    const after = lis();
    expect(texts()).toEqual(['a: 9', 'b: 2']);
    expect(after[0]).not.toBe(before[0]); // a changed value.id gets a new node
    expect(after[1]).toBe(before[1]); // an unchanged value.id keeps its node
  });

  test('key="@index" over a Map keyed by objects: every key stringifies alike, so rows are reused by position', async () => {
    HOST_HOOKS.eachInEntries = (obj: object) =>
      obj instanceof Map ? Array.from(obj.entries()) : Object.entries(obj);
    const a = { name: 'a' };
    const b = { name: 'b' };
    const self = {
      map: new Map<unknown, unknown>([
        [a, 1],
        [b, 2],
      ]) as unknown,
    };
    render(
      withSelf(
        compileNative(
          '<ul>{{#each-in this.map key="@index" as |name value|}}<li>{{name.name}}: {{value}}</li>{{/each-in}}</ul>',
        ),
        self,
      ),
    );
    const before = lis();
    expect(texts()).toEqual(['a: 1', 'b: 2']);

    await replace(self, 'map', new Map<unknown, unknown>([
      [b, 2],
      [a, 1],
    ]));
    const after = lis();
    expect(texts()).toEqual(['b: 2', 'a: 1']);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  test("a nested each-in row reads the outer row's key and value, not its own", async () => {
    const self = {
      groups: { g1: { title: 'T1', a: 1 }, g2: { title: 'T2', b: 2 } } as unknown,
    };
    render(
      withSelf(
        compileNative(
          '<ul>{{#each-in this.groups as |gName group|}}{{#each-in group as |field val|}}<li>{{gName}}.{{field}}={{val}}/{{group.title}}</li>{{/each-in}}{{/each-in}}</ul>',
        ),
        self,
      ),
    );
    expect(texts()).toEqual(['g1.title=T1/T1', 'g1.a=1/T1', 'g2.title=T2/T2', 'g2.b=2/T2']);

    await replace(self as Record<string, unknown>, 'groups', {
      g2: { title: 'T2', b: 3 },
      g1: { title: 'T1', a: 1 },
    });
    expect(texts()).toEqual(['g2.title=T2/T2', 'g2.b=3/T2', 'g1.title=T1/T1', 'g1.a=1/T1']);
  });

  test('a positional each in an each-in row, and an each-in in a positional row, each read their own items', async () => {
    const self = {
      lists: { x: ['a', 'b'] } as unknown,
      rows: [{ p: 1 }, { q: 2 }] as unknown,
    };
    render(
      withSelf(
        compileNative(
          '<p>{{#each-in this.lists as |name list|}}{{#each list key="@index" as |item|}}<i>{{name}}:{{item}}</i>{{/each}}{{/each-in}}</p>' +
            '<ul>{{#each this.rows key="@index" as |row|}}{{#each-in row as |k v|}}<li>{{k}}={{v}}</li>{{/each-in}}{{/each}}</ul>',
        ),
        self,
      ),
    );
    const is = () => Array.from(fixture.container.querySelectorAll('i')).map((i) => i.textContent);
    expect(is()).toEqual(['x:a', 'x:b']);
    expect(texts()).toEqual(['p=1', 'q=2']);

    await replace(self as Record<string, unknown>, 'rows', [{ q: 2 }, { p: 1 }]);
    expect(texts()).toEqual(['q=2', 'p=1']);
    await replace(self as Record<string, unknown>, 'lists', { x: ['b', 'a'] });
    expect(is()).toEqual(['x:b', 'x:a']);
  });

  test('a kept row whose entry did not change is not re-rendered', async () => {
    let reads = 0;
    const counted = {
      get label() {
        reads++;
        return 'x';
      },
    };
    const self = { hash: { a: counted } as unknown };
    renderHash(self, '@key', 'value.label');
    expect(texts()).toEqual(['a: x']);
    const readsAfterRender = reads;

    // a new object with the same entry: the row's entry reads the same
    await replace(self, 'hash', { a: counted });
    expect(texts()).toEqual(['a: x']);
    expect(reads).toBe(readsAfterRender);
  });
});
