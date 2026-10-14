/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): Glimmer's
 * `...attributes` precedence on an element, in gxt's own `_DOM`.
 *
 * Glimmer applies an element's attributes in source order with
 * `...attributes` expanded in place: an attribute written AFTER
 * `...attributes` overrides the forwarded one, and class values concatenate in
 * source order. The compat compiler lists what follows the splat in the
 * `__splatLocal__` marker; until now only Ember's runtime-template `$_tag`
 * wrapper and the native runtime honoured it, so a build-time (.gjs) template
 * of an Ember consumer, whose `$_tag` is gxt's own, rendered `class="fw own"`
 * for `<div class="own" ...attributes>` and let a forwarded attribute beat one
 * written after `...attributes`.
 *
 * The runtime build constants are vitest globals, turned on per test as the
 * Ember compat build defines them.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as main from './index';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, COMPONENT_ID_PROPERTY, addToTree, $template } from './shared';
import { cId } from './tree';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { renderElement } from './render-core';
import { compileTemplateSource } from '../../plugins/runtime-compiler';

export const COMPAT_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  TRY_CATCH_ERROR_HANDLING: false,
  EMBER_PROPERTY_TAGS: false,
};

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

function compileCompat(tpl: string, bindings: Record<string, unknown> = {}) {
  const { source, scopeNames, errors } = compileTemplateSource(tpl, {
    flags: COMPAT_FLAGS,
    bindings: new Set(Object.keys(bindings)),
  });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  const names = Object.keys(bindings);
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, ...names, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
    ...names.map((name) => bindings[name]),
  ) as (...args: unknown[]) => unknown;
}

describe('Ember compat: `...attributes` precedence in gxt `_DOM`', () => {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;

  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = false;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
  });

  function render(inner: string, outer: string) {
    const Inner = compileCompat(inner);
    const Outer = compileCompat(outer, { Inner });
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const Host = function Host() {
      return { [COMPONENT_ID_PROPERTY]: cId(), [$template]: Outer };
    };
    const instance = $_c(Host as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    return fixture.container.querySelector('div')!;
  }

  test('own attributes and class written before `...attributes`: forwarded attribute wins, own class first', () => {
    const div = render(
      '<div class="own" data-x="own" title="own" ...attributes></div>',
      '<Inner class="fw" data-x="fw" />',
    );
    expect(div.getAttribute('class')).toBe('own fw');
    expect(div.getAttribute('data-x')).toBe('fw');
    expect(div.getAttribute('title')).toBe('own');
  });

  test('own attributes and class written after `...attributes`: own attribute wins, forwarded class first', () => {
    const div = render(
      '<div ...attributes class="own" data-x="own"></div>',
      '<Inner class="fw" data-x="fw" title="fw" />',
    );
    expect(div.getAttribute('class')).toBe('fw own');
    expect(div.getAttribute('data-x')).toBe('own');
    expect(div.getAttribute('title')).toBe('fw');
  });

  test('the marker is never written to the element', () => {
    const div = render('<div ...attributes data-x="own"></div>', '<Inner data-x="fw" />');
    expect(div.getAttribute('data-x')).toBe('own');
    expect(div.hasAttribute('__splatLocal__')).toBe(false);
    expect('__splatLocal__' in div).toBe(false);
  });
});
