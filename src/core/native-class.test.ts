/**
 * EMBER_NATIVE attribute parity with Glimmer:
 *   - the inline `{{if}}` / `{{unless}}` without an inverse is `undefined`
 *     (Ember's inlineIf / inlineUnless), so an attribute bound to it is
 *     removed rather than written as "";
 *   - an element's `class` is a Glimmer attribute (dom.ts nativeClassAttribute):
 *     one value follows normalizeValue (null / undefined / false remove it, ""
 *     keeps class="", true is ""); several — the element's own class and the
 *     ones `...attributes` forwards — merge like createClassListRef (non-empty
 *     strings joined by a space, no attribute when all are empty).
 *
 * Templates are compiled with the native flags and bound to the main entry;
 * the runtime side reads the EMBER_NATIVE / WITH_EMBER_INTEGRATION build
 * constants, which vitest exposes as globals (turned on per test, as the Ember
 * native build defines them). The attribute normalization is the host's
 * (`normalizeAttrValue`); the test registers Glimmer's rule.
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
import { registerHostHooks, HOST_HOOKS } from './host-hooks';
import { $__if } from './helpers/if';
import { compileTemplateSource } from '../../plugins/runtime-compiler';

const NATIVE_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_IN_ELEMENT: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

/** Glimmer's normalizeValue for an attribute write (`undefined` = remove). */
function glimmerAttrValue(_name: string, value: unknown, _el: Element, isProp: boolean) {
  if (isProp) return value;
  if (
    value === false ||
    value === undefined ||
    value === null ||
    typeof value === 'function' ||
    typeof (value as { toString?: unknown }).toString !== 'function'
  ) {
    return undefined;
  }
  return value === true ? '' : String(value);
}

function compileNative(tpl: string) {
  const { source, scopeNames, errors } = compileTemplateSource(tpl, { flags: NATIVE_FLAGS });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
  ) as (...args: unknown[]) => unknown;
}

function withSelf(tpl: unknown, self: object) {
  return function SelfComponent() {
    return { [COMPONENT_ID_PROPERTY]: cId(), [$SELF]: self, [$template]: tpl };
  };
}

describe('compiler: EMBER_NATIVE inline unless without an inverse', () => {
  const compile = (flags: Record<string, boolean>) =>
    compileTemplateSource('<p title={{unless this.on "x"}}></p>', { flags }).source;

  test('the missing branch is undefined natively, "" otherwise', () => {
    expect(compile(NATIVE_FLAGS)).toMatch(/\$__if\(.*\), undefined, "x"\)/);
    expect(compile({})).toMatch(/\$__if\(.*, "", "x"\)/);
  });
});

describe('EMBER_NATIVE attribute parity', () => {
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
    registerHostHooks({ normalizeAttrValue: glimmerAttrValue });
  });

  afterEach(() => {
    (HOST_HOOKS as Record<string, unknown>).normalizeAttrValue = undefined;
    registerHostHooks({});
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

  async function set(obj: object, key: string, value: unknown) {
    (obj as Record<string, unknown>)[key] = value;
    dirtyCell(tagFor(obj, key));
    await syncDom();
  }

  test('$__if: no inverse is undefined; an explicit inverse is kept', () => {
    expect($__if(false, 'x')).toBe(undefined);
    expect($__if(false, 'x', undefined)).toBe(undefined);
    expect($__if(false, 'x', '')).toBe('');
    expect($__if(true, 'x')).toBe('x');
    runtime.EMBER_NATIVE = false;
    expect($__if(false, 'x')).toBe(''); // standalone / compat: unchanged
  });

  test('one class value: Glimmer normalizeValue', async () => {
    const self = { c: 'x' as unknown };
    render(withSelf(compileNative('<div class={{this.c}}></div>'), self));
    const div = fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('x');
    for (const [value, expected] of [
      [false, null],
      ['', ''],
      [undefined, null],
      ['y', 'y'],
      [null, null],
      [true, ''],
    ] as const) {
      await set(self, 'c', value);
      expect(div.getAttribute('class'), String(value)).toBe(expected);
    }
  });

  test('class={{if …}} / title={{if …}} without an inverse: falsy removes the attribute', async () => {
    const self = { on: true };
    render(withSelf(compileNative('<div class={{if this.on "foo-bar"}} title={{if this.on "t"}}></div>'), self));
    const div = fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('foo-bar');
    await set(self, 'on', false);
    expect(div.hasAttribute('class')).toBe(false);
    expect(div.hasAttribute('title')).toBe(false);
    await set(self, 'on', true);
    expect(div.getAttribute('class')).toBe('foo-bar');
    expect(div.getAttribute('title')).toBe('t');
  });

  test('a re-evaluated class whose value did not change writes nothing', async () => {
    const self = { n: 1 };
    render(withSelf(compileNative('<div class={{if (eq this.n 1) "one"}}></div>'), self));
    const div = fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('one');
    await set(self, 'n', 2);
    expect(div.hasAttribute('class')).toBe(false);
    const writes: string[] = [];
    const setAttribute = div.setAttribute.bind(div);
    const removeAttribute = div.removeAttribute.bind(div);
    div.setAttribute = (name: string, value: string) => {
      writes.push(`set ${name}`);
      setAttribute(name, value);
    };
    div.removeAttribute = (name: string) => {
      writes.push(`remove ${name}`);
      removeAttribute(name);
    };
    await set(self, 'n', 3); // still not 1: the class stays absent
    expect(writes).toEqual([]);
    await set(self, 'n', 1);
    expect(writes).toEqual(['set class']);
    expect(div.getAttribute('class')).toBe('one');
  });

  test('own + forwarded classes merge like createClassListRef', async () => {
    const self = { own: 'own' as unknown, fw: 'fw' as unknown };
    const Inner = compileNative('<div class={{@own}} ...attributes></div>');
    const outer = compileTemplateSource('<Inner class={{this.fw}} @own={{this.own}} />', {
      flags: NATIVE_FLAGS,
      bindings: new Set(['Inner']),
    });
    expect(outer.errors).toHaveLength(0);
    const exported = main as unknown as Record<string, unknown>;
    // eslint-disable-next-line no-new-func
    const Outer = new Function(...outer.scopeNames, 'Inner', `"use strict"; return ${outer.source};`)(
      ...outer.scopeNames.map((name) => exported[name]),
      Inner,
    );
    render(withSelf(Outer, self));
    const div = fixture.container.querySelector('div')!;
    expect(div.getAttribute('class')).toBe('own fw');
    await set(self, 'fw', undefined);
    expect(div.getAttribute('class')).toBe('own');
    await set(self, 'own', '');
    expect(div.hasAttribute('class')).toBe(false);
    await set(self, 'fw', false);
    expect(div.getAttribute('class')).toBe('false');
    await set(self, 'own', 'a');
    expect(div.getAttribute('class')).toBe('a false');
  });
});
