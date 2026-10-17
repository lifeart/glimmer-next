/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): the `{{#let}}`
 * value of a helper call is a Glimmer reference.
 *
 * `{{#let (h) as |x|}}` compiled to `let x = () => $_maybeHelper(h, …)`, a
 * getter every read of `x` called, so the helper ran once per read: two
 * `{{x}}` of `{{#let (uniqueId) as |id|}}` rendered two ids, and a quoted
 * attribute `"{{prefix}}-{{id}}"` got a new id whenever `prefix` changed.
 * Glimmer's `{{#let}}` binds a reference, computed when it is first read and
 * again only when a tag it consumed changed. The value is now
 * `$__ref(() => …)` (`cachedReference`). Paths, literals and the native layer
 * (whose host helper manager keeps one helper instance per call site) are
 * unchanged, and so is standalone output.
 */
import { describe, test, expect } from 'vitest';
// The main entry first: vite-node populates `export *` namespaces in import
// order (see plugins/__tests__/template-source.test.ts).
import * as main from './index';
import { compileTemplateSource, GXT_RUNTIME_SYMBOLS } from '../../plugins/runtime-compiler';
import { nativeTemplateSymbols, templateScopeNames } from '../../plugins/template-wrapper';
import { COMPAT_FLAGS, compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom } from './runtime';

const NATIVE_FLAGS = { ...COMPAT_FLAGS, EMBER_NATIVE: true };

function code(tpl: string, flags: Record<string, boolean>, bindings: string[]) {
  const result = compileTemplateSource(tpl, { flags, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('Ember compat: a {{#let}} helper value is a cached reference (compiler)', () => {
  const tpl = '{{#let (h) "lit" this.y (concat "a" (h)) as |x l y c|}}{{x}}{{l}}{{y}}{{c}}{{/let}}';

  test('compat: helper calls become `$__ref`, paths and literals do not', () => {
    const out = code(tpl, COMPAT_FLAGS, ['h']);
    expect(out).toContain('let x = $__ref(() => $_maybeHelper(h, [], {}));');
    expect(out).toContain('let l = "lit";');
    expect(out).toContain('let y = () => this.y;');
    expect(out).toContain('let c = $__ref(() => $_maybeHelper("concat"');
    expect(out).toContain('return [() => x(), () => l, () => y(), () => c()]');
  });

  test('standalone and native output are unchanged', () => {
    expect(code(tpl, {}, ['h'])).not.toContain('$__ref');
    expect(code(tpl, {}, ['h'])).toContain('let x = () => h();');
    expect(code(tpl, NATIVE_FLAGS, ['h'])).not.toContain('$__ref');
  });

  test('compat modules import `$__ref` and runtime templates can bind it', () => {
    expect(nativeTemplateSymbols(COMPAT_FLAGS)).toContain('$__ref');
    expect(nativeTemplateSymbols({})).not.toContain('$__ref');
    expect(nativeTemplateSymbols(NATIVE_FLAGS)).not.toContain('$__ref');
    const exported = main as unknown as Record<string, unknown>;
    expect(templateScopeNames(COMPAT_FLAGS).filter((name) => !(name in exported))).toEqual([]);
    expect(typeof (GXT_RUNTIME_SYMBOLS as Record<string, unknown>).$__ref).toBe('function');
  });
});

describe('Ember compat: a {{#let}} helper value is a cached reference (runtime)', () => {
  const compat = useEmberCompatRuntime();
  const text = () => compat.fixture.container.textContent;

  test('every read of the binding sees one helper call', () => {
    let next = 0;
    const uniqueId = () => `id-${++next}`;
    compat.render(
      compileCompat('{{#let (uniqueId) as |id|}}<p>{{id}}</p><p>{{id}}</p>{{/let}}', {
        uniqueId,
      }),
    );
    const [first, second] = Array.from(compat.fixture.container.querySelectorAll('p'));
    expect(first!.textContent).toBe('id-1');
    expect(second!.textContent).toBe('id-1');
    expect(next).toBe(1);
  });

  test('a concatenated attribute keeps the id when its other part changes', async () => {
    let next = 0;
    const uniqueId = () => `id-${++next}`;
    const prefix = cell('app');
    compat.render(
      compileCompat(
        '{{#let (uniqueId) as |id|}}<label for="{{prefix.value}}-{{id}}"></label><input id="{{prefix.value}}-{{id}}" />{{/let}}',
        { uniqueId, prefix },
      ),
    );
    const label = () => compat.fixture.container.querySelector('label')!;
    const input = () => compat.fixture.container.querySelector('input')!;
    expect(label().getAttribute('for')).toBe('app-id-1');
    expect(input().id).toBe('app-id-1');

    prefix.update('melanie');
    await syncDom();
    expect(label().getAttribute('for')).toBe('melanie-id-1');
    expect(input().id).toBe('melanie-id-1');
    expect(next).toBe(1);
  });

  test('the helper runs again when a cell it read changes, once for all reads', async () => {
    const calls: string[] = [];
    const upper = (value: string) => {
      calls.push(value);
      return value.toUpperCase();
    };
    const state = cell('a');
    compat.render(
      compileCompat('{{#let (upper state.value) as |u|}}{{u}}-{{u}}{{/let}}', { upper, state }),
    );
    expect(text()).toBe('A-A');
    expect(calls).toEqual(['a']);

    state.update('b');
    await syncDom();
    expect(text()).toBe('B-B');
    expect(calls).toEqual(['a', 'b']);
  });

  test('a helper of a let binding reads the outer binding through its reference', async () => {
    const calls: string[] = [];
    const tag = (name: string) => (value: string) => {
      calls.push(`${name}:${value}`);
      return `${name}(${value})`;
    };
    const f = tag('f');
    const g = tag('g');
    const state = cell('a');
    compat.render(
      compileCompat(
        '{{#let (f state.value) as |x|}}{{#let (g x) as |y|}}{{y}}|{{y}}|{{x}}{{/let}}{{/let}}',
        { f, g, state },
      ),
    );
    expect(text()).toBe('g(f(a))|g(f(a))|f(a)');
    expect(calls).toEqual(['f:a', 'g:f(a)']);

    state.update('b');
    await syncDom();
    expect(text()).toBe('g(f(b))|g(f(b))|f(b)');
    expect(calls).toEqual(['f:a', 'g:f(a)', 'f:b', 'g:f(b)']);
  });
});
