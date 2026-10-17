/**
 * Ember (compat and native): a bound `style` is written as the element's
 * `style` attribute, as Glimmer writes it.
 *
 * Glimmer's normalizeProperty maps `style` to an attribute even though the
 * element has a `style` property (its DEV DebugStyleAttributeManager is a
 * SimpleDynamicAttribute): the text is set as it is. gxt wrote a bound
 * `style` through the property, so the browser's CSSOM re-serialized it
 * (`display:flex` became `display: flex;`).
 *
 * The host's `normalizeAttrValue` hook still sees a bound `style` on its
 * property side (`isProp`): the Ember native hook gives Glimmer's DEV style
 * warning there, and a static `style="…"` (an attribute) must not warn.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom } from './runtime';
import { registerHostHooks, HOST_HOOKS } from './host-hooks';

function setup() {
  const compat = useEmberCompatRuntime();
  const button = () => compat.fixture.container.querySelector('button')!;
  return { compat, button };
}

describe('Ember: a bound `style` is the style attribute', () => {
  const { compat, button } = setup();

  test('the text is set as it is', () => {
    compat.render(compileCompat('<button style={{this.s}}>x</button>'), { s: 'display:flex' });
    expect(button().getAttribute('style')).toBe('display:flex');
  });

  test('a quoted binding', () => {
    compat.render(compileCompat('<button style="color:{{this.c}}">x</button>'), { c: 'red' });
    expect(button().getAttribute('style')).toBe('color:red');
  });

  test('an update sets the new text', async () => {
    const s = cell('display:flex');
    compat.render(compileCompat('<button style={{this.s.value}}>x</button>'), { s });
    s.update('color:red');
    await syncDom();
    expect(button().getAttribute('style')).toBe('color:red');
  });

  test('an update to null or undefined removes the attribute', async () => {
    const s = cell<string | null | undefined>('display:flex');
    compat.render(compileCompat('<button style={{this.s.value}}>x</button>'), { s });
    s.update(null);
    await syncDom();
    expect(button().hasAttribute('style')).toBe(false);
    s.update('color:red');
    await syncDom();
    expect(button().getAttribute('style')).toBe('color:red');
    s.update(undefined);
    await syncDom();
    expect(button().hasAttribute('style')).toBe(false);
  });

  test('an update to an empty string removes the attribute', async () => {
    const s = cell('display:flex');
    compat.render(compileCompat('<button style={{this.s.value}}>x</button>'), { s });
    s.update('');
    await syncDom();
    expect(button().hasAttribute('style')).toBe(false);
  });
});

describe('Ember: the host sees a bound `style` on its property side', () => {
  const { compat, button } = setup();
  let saved: typeof HOST_HOOKS.normalizeAttrValue;
  const calls: Array<[string, unknown, boolean]> = [];
  beforeEach(() => {
    saved = HOST_HOOKS.normalizeAttrValue;
    calls.length = 0;
    registerHostHooks({
      normalizeAttrValue: (name, value, _element, isProp) => {
        calls.push([name, value, isProp]);
        return value;
      },
    });
  });
  afterEach(() => {
    registerHostHooks({ normalizeAttrValue: saved });
  });

  test('a bound style is normalized as a property and written as the attribute', () => {
    compat.render(compileCompat('<button style={{this.s}}>x</button>'), { s: 'display:flex' });
    expect(calls).toContainEqual(['style', 'display:flex', true]);
    expect(button().getAttribute('style')).toBe('display:flex');
  });

  test('what the host returns is the text', () => {
    registerHostHooks({
      normalizeAttrValue: (name, value, _element, isProp) =>
        name === 'style' && isProp ? `${String(value)};width:1px` : value,
    });
    compat.render(compileCompat('<button style={{this.s}}>x</button>'), { s: 'display:flex' });
    expect(button().getAttribute('style')).toBe('display:flex;width:1px');
  });

  test('a static style stays on the attribute side', () => {
    compat.render(compileCompat('<button style="display:flex">x</button>'));
    expect(calls.filter(([name]) => name === 'style').map(([, , isProp]) => isProp)).toEqual([
      false,
    ]);
    expect(button().getAttribute('style')).toBe('display:flex');
  });
});

describe('Ember native: a bound `style` is the style attribute', () => {
  const runtime = globalThis as unknown as { EMBER_NATIVE: boolean };
  const { compat, button } = setup();
  // After the compat runtime's own `beforeEach` (registered first), which
  // restores the constant after the test.
  beforeEach(() => {
    runtime.EMBER_NATIVE = true;
  });

  test('the text is set as it is', () => {
    compat.render(
      compileCompat('<button style={{this.s}}>x</button>', {}, { EMBER_NATIVE: true }),
      { s: 'display:flex' },
    );
    expect(button().getAttribute('style')).toBe('display:flex');
  });
});

describe('standalone gxt: a bound `style` is the style property', () => {
  const runtime = globalThis as unknown as { WITH_EMBER_INTEGRATION: boolean };
  const { compat, button } = setup();
  beforeEach(() => {
    runtime.WITH_EMBER_INTEGRATION = false;
  });

  test('the property serializes the text', () => {
    compat.render(
      compileCompat(
        '<button style={{this.s}}>x</button>',
        {},
        { WITH_EMBER_INTEGRATION: false, WITH_HELPER_MANAGER: false, WITH_MODIFIER_MANAGER: false },
      ),
      { s: 'display:flex' },
    );
    expect(button().getAttribute('style')).toBe('display: flex;');
  });
});
