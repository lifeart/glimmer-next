/**
 * Ember (compat and native): a bound `value` of an `<input>` / `<textarea>`
 * is compared with the element's CURRENT value when it updates, as Glimmer's
 * InputValueDynamicAttribute does.
 *
 * The property binding compared a new value with the value it wrote last, so
 * after the user typed (`input.value` changed) a write of the value the
 * binding already had — a tracked set to the same value — did not reset what
 * the user typed. The first write of a binding is unchanged (it always
 * writes), and so is every other property, which still compares with the last
 * written value (Glimmer's DefaultDynamicProperty).
 */
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom } from './runtime';

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

describe('Ember: a bound input value follows the element value', () => {
  const compat = useEmberCompatRuntime();

  for (const tag of ['input', 'textarea'] as const) {
    test(`<${tag}>: a write of the same value resets what the user typed`, async () => {
      const v = cell('');
      compat.render(compileCompat(`<${tag} value={{this.v.value}} />`), { v });
      const element = compat.fixture.container.querySelector(tag)!;
      expect(element.value).toBe('');

      element.value = 'bar';
      v.update('foo');
      await syncDom();
      expect(element.value).toBe('foo');

      element.value = 'bar';
      v.update('foo');
      await syncDom();
      expect(element.value).toBe('foo');
      expect(compat.fixture.container.querySelector(tag)).toBe(element);
    });
  }

  test('an unchanged value the user did not edit is not written again', async () => {
    const v = cell('foo');
    compat.render(compileCompat('<input value={{this.v.value}} />'), { v });
    const input = compat.fixture.container.querySelector('input')!;
    let writes = 0;
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')!;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get() {
        return descriptor.get!.call(this);
      },
      set(next: string) {
        writes++;
        descriptor.set!.call(this, next);
      },
    });
    v.update('foo');
    await syncDom();
    expect(writes).toBe(0);
    v.update('baz');
    await syncDom();
    expect(writes).toBe(1);
    expect(input.value).toBe('baz');
  });

  test('another property still compares with the value it wrote last', async () => {
    const checked = cell(true);
    compat.render(compileCompat('<input type="checkbox" checked={{this.c.value}} />'), { c: checked });
    const input = compat.fixture.container.querySelector('input')!;
    expect(input.checked).toBe(true);
    input.checked = false;
    checked.update(true);
    await syncDom();
    expect(input.checked).toBe(false);
  });

  test('standalone gxt keeps comparing with the value it wrote last', async () => {
    runtime.WITH_EMBER_INTEGRATION = false;
    const v = cell('foo');
    compat.render(compileCompat('<input value={{this.v.value}} />'), { v });
    const input = compat.fixture.container.querySelector('input')!;
    input.value = 'bar';
    v.update('foo');
    await syncDom();
    expect(input.value).toBe('bar');
  });
});
