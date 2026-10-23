/**
 * R12 (ember.js#21340 N21-N25): native `{{#each-in}}` keying, rendered.
 *
 * With a path `key=`, replacing an entry's value with a new object that keeps
 * the key value RETAINS the row (same DOM node — the lowered `each` keeps the
 * retained pair). With `@identity` the same replace RE-CREATES the row (a new
 * node). Mirrors the EMBER_NATIVE render harness in list.native-rows.test.ts.
 *
 * (The retained row's displayed value re-reads through the host body-proxy;
 * standalone gxt observes the keying — node identity — which this pins.)
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
import { compileTemplateSource } from '../../plugins/runtime-compiler';

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

describe('native {{#each-in}} keying, rendered (R12)', () => {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;

  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = true;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
    setNativeContentBinding(bindNativeContent);
  });
  afterEach(() => {
    setNativeContentBinding(null);
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

  const TPL = (key: string) =>
    `<ul>{{#each-in this.obj key="${key}" as |k v|}}<li>{{k}}</li>{{/each-in}}</ul>`;

  test('path key: replacing a value (same id) RETAINS the row node', async () => {
    const self = { obj: { x: { id: 1, label: 'a' }, y: { id: 2, label: 'b' } } as Record<string, { id: number; label: string }> };
    render(withSelf(compileNative(TPL('id')), self));
    const before = lis();
    expect(before.map((li) => li.textContent)).toEqual(['x', 'y']);

    await replace(self.obj, 'x', { id: 1, label: 'a2' }); // same id → retain
    const after = lis();
    expect(after.map((li) => li.textContent)).toEqual(['x', 'y']);
    expect(after[0]).toBe(before[0]); // same DOM node — row kept
    expect(after[1]).toBe(before[1]);
  });

  test('@identity: replacing a value RE-CREATES the row node', async () => {
    const self = { obj: { x: { id: 1, label: 'a' }, y: { id: 2, label: 'b' } } as Record<string, { id: number; label: string }> };
    render(withSelf(compileNative(TPL('@identity')), self));
    const before = lis();
    expect(before.map((li) => li.textContent)).toEqual(['x', 'y']);

    await replace(self.obj, 'x', { id: 1, label: 'a2' }); // identity change → new row
    const after = lis();
    expect(after.map((li) => li.textContent)).toEqual(['x', 'y']);
    expect(after[0]).not.toBe(before[0]); // row re-created
  });
});
