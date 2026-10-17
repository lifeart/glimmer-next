/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): creating a
 * content binding evaluates it once.
 *
 * `resolveRenderable` reads a content binding's formula once (in the opcode
 * frame) to tell a constant from a reactive value, and the binding's opcode
 * then read the formula again for its first run. A content mustache that calls
 * a helper therefore called it twice on creation, where Glimmer computes a
 * reference once per revision (Ember's default helper manager:
 * `{{(hello state.foo)}}` renders with one call). The opcode's first run now
 * applies the value the first read computed; later changes evaluate the
 * binding once each, as before.
 */
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom } from './runtime';

describe('Ember compat: a content binding is evaluated once on creation', () => {
  const compat = useEmberCompatRuntime();

  function counted() {
    const state = cell('a');
    const calls: string[] = [];
    const hello = (value: string) => {
      calls.push(value);
      return `[${value}]`;
    };
    return { state, calls, hello };
  }

  for (const [label, tpl, expected] of [
    ['at the top level of a template', '{{(hello state.value)}}', '[a]'],
    ['as the only content of an element', '<div>{{(hello state.value)}}</div>', '[a]'],
    ['between text in an element', '<div>x{{(hello state.value)}}y</div>', 'x[a]y'],
  ] as const) {
    test(label, async () => {
      const { state, calls, hello } = counted();
      compat.render(compileCompat(tpl, { hello, state }));
      expect(compat.fixture.container.textContent).toBe(expected);
      expect(calls).toEqual(['a']);

      state.update('b');
      await syncDom();
      expect(compat.fixture.container.textContent).toBe(expected.replace('a', 'b'));
      expect(calls).toEqual(['a', 'b']);
    });
  }

  test('a binding in a block branch is evaluated once when the branch is created', async () => {
    const { state, calls, hello } = counted();
    const show = cell(false);
    compat.render(
      compileCompat('{{#if show.value}}<p>{{(hello state.value)}}</p>{{/if}}', {
        hello,
        state,
        show,
      }),
    );
    expect(calls).toEqual([]);
    show.update(true);
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[a]');
    expect(calls).toEqual(['a']);
  });

  test('a constant content binding is rendered once and not bound', async () => {
    const calls: number[] = [];
    const one = () => {
      calls.push(1);
      return 'one';
    };
    compat.render(compileCompat('<div>x{{(one)}}y</div>{{(one)}}', { one }));
    expect(compat.fixture.container.textContent).toBe('xoneyone');
    expect(calls).toEqual([1, 1]);
  });
});
