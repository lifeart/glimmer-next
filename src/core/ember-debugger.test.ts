/**
 * Ember (compat and native): `{{debugger}}` calls the host's `debugger` hook
 * (Glimmer's debugger callback) with the template's self and Glimmer's
 * `get(path)`, once each time the statement renders.
 *
 * Glimmer's `{{debugger}}` is an append opcode: its callback runs when its
 * block renders, never in an update, and gets `(self, get)` where `get('this')`
 * is the self, `get('@name')` a named argument, `get('<local>')` a block param
 * or `{{#let}}` binding, and anything else a path on the self. gxt's
 * `$__debugger` only logged its render context and hit a breakpoint; the
 * compiler passed no locals.
 *
 * The Ember dialect passes the scope (`{ self, locals, args }`, read lazily);
 * the hook runs untracked. Standalone output and behaviour are unchanged.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { compile } from '../../plugins/compiler/compile';
import { COMPAT_FLAGS, compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { HOST_HOOKS } from './host-hooks';
import { cell } from './reactive';
import { syncDom, takeRenderingControl } from './runtime';

const COMPAT = { IS_GLIMMER_COMPAT_MODE: true, ...COMPAT_FLAGS };
const NATIVE = { ...COMPAT, EMBER_NATIVE: true, EMBER_SELF: true, EMBER_PROPERTY_TAGS: true };

function code(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('Ember {{debugger}}: emission', () => {
  test('compat: the scope it inspects (self, locals, args)', () => {
    expect(code('{{debugger}}', COMPAT)).toContain(
      '$__debugger.call(this, { self: () => this, locals: {}, args: () => $a })',
    );
  });

  test('a {{#let}} binding inside a block, read as the template reads it', () => {
    expect(code('{{#let this.foo as |bar|}}{{#if this.a.b}}{{debugger}}{{/if}}{{/let}}', COMPAT)).toContain(
      '$__debugger.call(ctx1, { self: () => this, locals: { bar: () => bar() }, args: () => $a })',
    );
  });

  test('block params, and an inner binding shadows an outer one', () => {
    expect(code('{{#each this.items as |item i|}}{{debugger}}{{/each}}', COMPAT)).toContain(
      'locals: { item: () => item, i: () => i }',
    );
    expect(code('<Foo as |x|>{{#let 2 as |x|}}{{debugger}}{{/let}}</Foo>', COMPAT, ['Foo'])).toContain(
      'locals: { x: () => x }',
    );
  });

  test('native: the self is the template self ($s)', () => {
    expect(code('{{debugger}}', NATIVE)).toContain('$__debugger.call(this, { self: () => $s, locals: {}, args: () => $a })');
  });

  test('standalone gxt is unchanged (guard)', () => {
    expect(code('{{debugger}}', { IS_GLIMMER_COMPAT_MODE: true })).toBe('[() => $__debugger.call(this)]');
  });
});

describe('Ember {{debugger}}: the host hook', () => {
  const compat = useEmberCompatRuntime();
  let release: () => void;
  let saved: typeof HOST_HOOKS.debugger;
  let calls: Array<{ self: unknown; get: (path: string) => unknown }>;
  beforeEach(() => {
    release = takeRenderingControl();
    saved = HOST_HOOKS.debugger;
    calls = [];
    HOST_HOOKS.debugger = (self, get) => {
      calls.push({ self, get });
    };
  });
  afterEach(() => {
    HOST_HOOKS.debugger = saved;
    release();
  });

  test('get resolves this, a path on the self, a local and a named argument', () => {
    const Child = compileCompat('{{#let "local" as |bar|}}{{debugger}}{{/let}}{{@used}}');
    compat.render(compileCompat('<Child @used="named" />', { Child }));
    expect(calls).toHaveLength(1);
    const [{ self, get }] = calls;
    expect(get('this')).toBe(self);
    expect(get('@used')).toBe('named');
    expect(get('@missing')).toBe(undefined);
    expect(get('bar')).toBe('local');
  });

  test('{{#each}} block params: the item and its index', () => {
    compat.render(compileCompat('{{#each this.items as |item i|}}{{debugger}}{{/each}}'), { items: ['a', 'b'] });
    expect(calls.map(({ get }) => [get('item'), get('i')])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });

  test('the self is the template self, not the block it runs in', () => {
    const a = { b: { c: 1 } };
    compat.render(compileCompat('{{#if this.show}}{{debugger}}{{/if}}'), { show: true, a });
    expect(calls).toHaveLength(1);
    const [{ self, get }] = calls;
    expect((self as { a: unknown }).a).toBe(a);
    expect(get('a.b.c')).toBe(1);
    expect(get('this.a.b')).toBe(a.b);
  });

  test('once per render of its block: not again on an update, again when the block renders again', async () => {
    const show = cell(true);
    const other = cell('x');
    compat.render(compileCompat('{{this.other.value}}{{#if this.show.value}}{{debugger}}{{/if}}'), { show, other });
    expect(calls).toHaveLength(1);
    other.update('y');
    await syncDom();
    expect(calls).toHaveLength(1);
    show.update(false);
    await syncDom();
    show.update(true);
    await syncDom();
    expect(calls).toHaveLength(2);
  });

  test('what the hook reads does not render the statement again', async () => {
    const count = cell(1);
    const seen: unknown[] = [];
    HOST_HOOKS.debugger = (_self, get) => {
      calls.push({ self: _self, get });
      seen.push(get('count'));
    };
    compat.render(compileCompat('{{debugger}}'), { count });
    expect(seen).toEqual([1]);
    count.update(2);
    await syncDom();
    expect(calls).toHaveLength(1);
    expect(seen).toEqual([1]);
  });
});
