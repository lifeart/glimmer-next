/**
 * EMBER_NATIVE attribute and block-param parity with Glimmer:
 *   - `style`: a bound `style` is written through the property side of the
 *     host's `normalizeAttrValue` hook with its value as is (`style="{{x}}"`
 *     is `style={{x}}`, Ember's transform-quoted-bindings-into-just-bindings),
 *     a trusting `style={{{x}}}` goes through `$_trustAttr` (the host's
 *     `trustedAttrValue` hook), a static `style="…"` is an attribute written
 *     verbatim — so the host can give Glimmer's DEV untrusted-style warning to
 *     exactly the bindings Glimmer gives it to;
 *   - a name the element has no property for (a custom element's
 *     `some-attr`) is an attribute (Glimmer's normalizeProperty), not an
 *     expando property;
 *   - block params that are not JS identifiers (`-in-element`) and block
 *     params that shadow the `component` / `mount` / `input` / `textarea`
 *     keywords are ordinary bindings;
 *   - an empty `<Foo></Foo>` / `<foo-bar></foo-bar>` carries no compat
 *     `@__hasBlock__` marker (no extra arg, no stray attribute); the component
 *     still gets its empty default block, so `has-block` is true.
 *
 * The runtime side reads the EMBER_NATIVE / WITH_EMBER_INTEGRATION build
 * constants, which vitest exposes as globals (turned on per test, as the Ember
 * native build defines them).
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
import { $_trustAttr } from './helpers/trusted-attr';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { nativeTemplateSymbols } from '../../plugins/template-wrapper';

const NATIVE_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_IN_ELEMENT: true,
  EMBER_ATTR_CONCAT: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};
const COMPAT_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  EMBER_ATTR_CONCAT: true,
};

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

function source(tpl: string, flags: object = NATIVE_FLAGS, bindings: string[] = []) {
  const result = compileTemplateSource(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.source;
}

function compileNative(tpl: string) {
  const { source: code, scopeNames, errors } = compileTemplateSource(tpl, { flags: NATIVE_FLAGS });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, `"use strict"; return ${code};`)(
    ...scopeNames.map((name) => exported[name]),
  ) as (...args: unknown[]) => unknown;
}

function compileNativeWith(tpl: string, scope: Record<string, unknown>) {
  const { source: code, scopeNames, errors } = compileTemplateSource(tpl, {
    flags: NATIVE_FLAGS,
    bindings: new Set(Object.keys(scope)),
  });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, ...Object.keys(scope), `"use strict"; return ${code};`)(
    ...scopeNames.map((name) => exported[name]),
    ...Object.values(scope),
  ) as (...args: unknown[]) => unknown;
}

function withSelf(tpl: unknown, self: object) {
  return function SelfComponent() {
    return { [COMPONENT_ID_PROPERTY]: cId(), [$SELF]: self, [$template]: tpl };
  };
}

const safe = (html: string) => ({ toHTML: () => html, toString: () => html });

describe('compiler: EMBER_NATIVE style attribute', () => {
  test('a bound style is a property; quoted single mustache is the same binding', () => {
    expect(source('<div style={{this.s}}></div>')).toContain('[["style", () => $__tag($s, "s")]], [], []');
    expect(source('<div style="{{this.s}}"></div>')).toContain('[["style", () => $__tag($s, "s")]], [], []');
  });

  test('a trusting style is marked $_trustAttr (also quoted)', () => {
    expect(source('<div style={{{this.s}}}></div>')).toContain('["style", () => $_trustAttr($__tag($s, "s"))]');
    expect(source('<div style="{{{this.s}}}"></div>')).toContain('["style", () => $_trustAttr($__tag($s, "s"))]');
    expect(source('<div style={{{"a: b"}}}></div>')).toContain('["style", () => $_trustAttr("a: b")]');
  });

  test('a concatenated style stays a $_qStr property; a static style is an attribute', () => {
    expect(source('<div style="a: b; {{this.s}}"></div>')).toContain('[["style", () => $_qStr(["a: b; ", $__tag($s, "s")])]], [], []');
    expect(source('<div style="a: b"></div>')).toContain('[[], [["style", "a: b"]], []]');
  });

  test('$_trustAttr is a native template symbol', () => {
    expect(nativeTemplateSymbols({ EMBER_NATIVE: true })).toContain('$_trustAttr');
    expect(nativeTemplateSymbols({})).not.toContain('$_trustAttr');
  });

  test('flag off: historic output', () => {
    expect(source('<div style={{{this.s}}}></div>', COMPAT_FLAGS)).toContain('[["style", () => this.s]]');
    expect(source('<div style="{{this.s}}"></div>', COMPAT_FLAGS)).toContain('[["style", () => $_qStr([this.s])]]');
    expect(source('<div style="a: b"></div>', COMPAT_FLAGS)).toContain('[[["style", "a: b"]], [], []]');
  });
});

describe('compiler: EMBER_NATIVE block params', () => {
  test('a name that is not a JS identifier is escaped at declaration and reference', () => {
    const let_ = source('{{#let this.v as |-in-element|}}{{-in-element}}{{/let}}');
    expect(let_).toContain('let __bp_$2d$in$2d$element = () => $__tag($s, "v")');
    expect(let_).toContain('() => __bp_$2d$in$2d$element()');
    const each = source('{{#each this.items as |foo-bar i-x|}}{{foo-bar}}{{i-x}}{{/each}}');
    expect(each).toContain('(__bp_foo$2d$bar, __bp_i$2d$x, ctx0)');
    expect(each).toContain('() => __bp_foo$2d$bar, () => __bp_i$2d$x.value');
    expect(source('<Foo as |a-b|>{{a-b}}</Foo>', NATIVE_FLAGS, ['Foo'])).toContain(
      '(ctx0, __bp_a$2d$b) => [() => __bp_a$2d$b]',
    );
  });

  test('a binding shadows the component / mount / input / textarea keywords', () => {
    for (const name of ['component', 'mount', 'input', 'textarea']) {
      expect(source(`{{#let this.v as |${name}|}}{{${name}}}{{/let}}`)).toContain(`return [() => ${name}()]`);
    }
  });

  test('compat (flag off) escapes and shadows the same way (keyword-named-block-params.test.ts)', () => {
    expect(source('{{#let this.v as |-in-element|}}{{-in-element}}{{/let}}', COMPAT_FLAGS)).toContain(
      'let __bp_$2d$in$2d$element = () => this.v',
    );
    expect(source('{{#let this.v as |input|}}{{input}}{{/let}}', COMPAT_FLAGS)).toContain('return [() => input()]');
  });
});

describe('compiler: EMBER_NATIVE empty-block invocations', () => {
  test('<Foo></Foo> gets an empty default block and no @__hasBlock__ arg', () => {
    const empty = source('<Foo @a={{1}}></Foo>', NATIVE_FLAGS, ['Foo']);
    expect(empty).not.toContain('__hasBlock__');
    expect(empty).toContain('{ default_: false, default: ctx0 => [] }');
    expect(source('<Foo as |x|></Foo>', NATIVE_FLAGS, ['Foo'])).not.toContain('__hasBlock__');
    expect(source('<Foo />', NATIVE_FLAGS, ['Foo'])).not.toContain('default:');
  });

  test('<foo-bar></foo-bar> gets no @__hasBlock__ attribute', () => {
    expect(source('<foo-bar></foo-bar>')).not.toContain('__hasBlock__');
  });

  test('flag off: the compat marker (historic)', () => {
    expect(source('<Foo></Foo>', COMPAT_FLAGS, ['Foo'])).toContain('__hasBlock__: "default"');
    expect(source('<foo-bar></foo-bar>', COMPAT_FLAGS)).toContain('["@__hasBlock__", "default"]');
  });
});

describe('EMBER_NATIVE attribute writes', () => {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;
  let writes: Array<[string, unknown, boolean]>;

  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = true;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
    setNativeContentBinding(bindNativeContent);
    writes = [];
    registerHostHooks({
      normalizeAttrValue(name, value, _element, isProp) {
        writes.push([name, value, isProp]);
        if (value !== null && typeof value === 'object' && 'trusted' in value) {
          value = (value as { trusted: unknown }).trusted;
        }
        if (isProp) {
          return value !== null && typeof value === 'object' && 'toHTML' in value
            ? (value as { toHTML(): string }).toHTML()
            : value;
        }
        return value === null || value === undefined || value === false ? undefined : String(value);
      },
    });
  });

  afterEach(() => {
    const hooks = HOST_HOOKS as Record<string, unknown>;
    hooks.normalizeAttrValue = undefined;
    hooks.trustedAttrValue = undefined;
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

  test('$_trustAttr: the host hook decides; without it the value itself', () => {
    expect($_trustAttr('a')).toBe('a');
    registerHostHooks({ trustedAttrValue: (value) => ({ trusted: value }) });
    expect($_trustAttr('a')).toEqual({ trusted: 'a' });
  });

  test('bound style values reach the host as is, on the property side', async () => {
    const value = safe('width: 1px');
    const self = { s: value as unknown };
    render(withSelf(compileNative('<p style={{this.s}}></p><b style="{{this.s}}"></b>'), self));
    expect(writes).toEqual([
      ['style', value, true],
      ['style', value, true],
    ]);
    expect(fixture.container.querySelector('p')!.getAttribute('style')).toBe('width: 1px;');
    writes = [];
    await set(self, 's', 'height: 2px');
    expect(writes).toEqual([
      ['style', 'height: 2px', true],
      ['style', 'height: 2px', true],
    ]);
  });

  test('a trusting style reaches the host through trustedAttrValue', () => {
    registerHostHooks({ trustedAttrValue: (value) => ({ trusted: value }) });
    render(withSelf(compileNative('<p style={{{this.s}}}></p>'), { s: 'width: 1px' }));
    expect(writes).toEqual([['style', { trusted: 'width: 1px' }, true]]);
    expect(fixture.container.querySelector('p')!.getAttribute('style')).toBe('width: 1px;');
  });

  test('a static style is an attribute written verbatim', () => {
    render(withSelf(compileNative('<p style="color: red"></p>'), {}));
    expect(writes).toEqual([['style', 'color: red', false]]);
    expect(fixture.container.querySelector('p')!.getAttribute('style')).toBe('color: red');
  });

  test('a custom element attribute is an attribute, static or bound', async () => {
    const self = { n: 'Robert' as unknown };
    render(
      withSelf(
        compileNative('<foo-bar some-attr="123">a</foo-bar><foo-baz some-attr="{{this.n}}">b</foo-baz>'),
        self,
      ),
    );
    const [bar, baz] = Array.from(fixture.container.children);
    expect(bar!.getAttribute('some-attr')).toBe('123');
    expect('some-attr' in bar!).toBe(false);
    expect(baz!.getAttribute('some-attr')).toBe('Robert');
    expect('some-attr' in baz!).toBe(false);
    await set(self, 'n', 'Kris');
    expect(baz!.getAttribute('some-attr')).toBe('Kris');
    await set(self, 'n', null);
    expect(baz!.hasAttribute('some-attr')).toBe(false);
  });

  test('a known property stays a property', () => {
    render(withSelf(compileNative('<input value={{this.v}}>'), { v: 'x' }));
    const input = fixture.container.querySelector('input')!;
    expect(input.value).toBe('x');
    expect(input.hasAttribute('value')).toBe(false);
    expect(writes).toEqual([['value', 'x', true]]);
  });

  test('flag off at runtime: an unknown name is still an expando property (historic)', () => {
    runtime.EMBER_NATIVE = false;
    render(withSelf(compileNative('<foo-bar some-attr="123">a</foo-bar>'), {}));
    const bar = fixture.container.querySelector('foo-bar')!;
    expect(bar.hasAttribute('some-attr')).toBe(false);
    expect((bar as unknown as Record<string, unknown>)['some-attr']).toBe('123');
  });

  test('block params that are not identifiers or shadow keywords render their value', async () => {
    const self = { v: 'a' };
    render(
      withSelf(
        compileNative(
          '{{#let this.v as |-in-element|}}{{-in-element}}{{/let}}-{{#let this.v as |component|}}{{component}}{{/let}}-{{#let this.v as |input|}}{{input}}{{/let}}',
        ),
        self,
      ),
    );
    expect(fixture.container.textContent).toBe('a-a-a');
    await set(self, 'v', 'b');
    expect(fixture.container.textContent).toBe('b-b-b');
  });

  test('an empty <Foo></Foo> has a block, <Foo /> none; <foo-bar></foo-bar> has no attribute', () => {
    const Foo = compileNative('{{#if (has-block)}}B{{else}}-{{/if}}');
    render(withSelf(compileNativeWith('<Foo></Foo><Foo />[<foo-bar></foo-bar>]', { Foo }), {}));
    expect(fixture.container.textContent).toBe('B-[]');
    // `data-node-id` is gxt's own dev-mode node id, not a template attribute.
    const names = fixture.container.querySelector('foo-bar')!.getAttributeNames();
    expect(names.filter((name) => name !== 'data-node-id')).toEqual([]);
  });
});
