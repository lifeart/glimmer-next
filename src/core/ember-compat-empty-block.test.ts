/**
 * Ember (compat and native compile flags): an empty `{{#if (foo)}}{{/if}}`
 * still evaluates its condition.
 *
 * The block visitor dropped a block with no content together with its
 * params, so the helper of an empty conditional was never called — and an
 * invalid helper value (a component definition in a strict-mode template)
 * never asserted. Glimmer evaluates a conditional's condition and an
 * iteration's collection whatever the block renders. A conditional or
 * iteration whose param is a sub-expression is now kept when empty; other
 * empty blocks are still dropped, and standalone output is unchanged.
 */
import { describe, test, expect } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { COMPAT_FLAGS, compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { cell } from './reactive';
import { syncDom } from './runtime';

const NATIVE_FLAGS = { ...COMPAT_FLAGS, EMBER_NATIVE: true };

function code(tpl: string, flags: Record<string, boolean>) {
  const result = compileTemplateSource(tpl, { flags, bindings: new Set(['foo']) });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('Ember: an empty block keeps the evaluation of its params (compiler)', () => {
  for (const [label, flags] of [
    ['compat', COMPAT_FLAGS],
    ['native', NATIVE_FLAGS],
  ] as const) {
    test(`${label}: {{#if (foo)}}{{/if}} evaluates (foo)`, () => {
      expect(code('{{#if (foo)}}{{/if}}', flags)).toMatch(/\$_if\(\(\) => \$_maybeHelper\(foo, \[\], \{\}/);
      expect(code('{{#if (foo)}}{{else}}{{/if}}', flags)).toMatch(/\$_if\(\(\) => \$_maybeHelper\(foo/);
      expect(code('{{#unless (foo)}}{{/unless}}', flags)).toMatch(/\$_if\(\(\) => \$_maybeHelper\(foo/);
      expect(code('{{#each (foo) as |x|}}{{/each}}', flags)).toMatch(/\$_each(Sync)?\(\(\) => \$_maybeHelper\(foo/);
    });

    test(`${label}: an empty block whose param calls nothing is still dropped`, () => {
      expect(code('{{#if this.x}}{{/if}}', flags)).toBe('[]');
      expect(code('{{#each this.list as |x|}}{{/each}}', flags)).toBe('[]');
      expect(code('{{#let (foo) as |x|}}{{/let}}', flags)).toBe('[]');
    });
  }

  test('standalone output is unchanged', () => {
    expect(code('{{#if (foo)}}{{/if}}', {})).toBe('[]');
    expect(code('{{#each (foo) as |x|}}{{/each}}', {})).toBe('[]');
  });
});

describe('Ember compat: an empty block keeps the evaluation of its params (runtime)', () => {
  const compat = useEmberCompatRuntime();

  test('the condition helper of an empty {{#if}} is called, again when what it read changes', async () => {
    const state = cell(1);
    const calls: number[] = [];
    const foo = () => {
      calls.push(state.value);
      return true;
    };
    compat.render(compileCompat('{{#if (foo)}}{{/if}}x', { foo }));
    expect(compat.fixture.container.textContent).toBe('x');
    expect(calls).toEqual([1]);
    state.update(2);
    await syncDom();
    expect(calls).toEqual([1, 2]);
  });

  test('an error of the condition helper of an empty {{#if}} propagates', () => {
    const foo = () => {
      throw new Error('not a helper');
    };
    expect(() => compat.render(compileCompat('{{#if (foo)}}{{/if}}', { foo }))).toThrow(
      'not a helper',
    );
  });
});
