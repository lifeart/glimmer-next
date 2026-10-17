/**
 * Ember (compat and native): an element's `type` attribute is applied after
 * its other attributes and properties, as Glimmer does (it defers `type` to
 * the end: at compile time for an element's own attributes, and in
 * `ComponentElementOperations.flush` for `...attributes`).
 *
 * `_DOM` applied every attribute (forwarded, then own) before every property,
 * and `type` is an attribute while `value` / `min` / `max` are properties. A
 * range input got `type="range"` first, so `value="-2"` was clamped to the
 * default minimum 0 before `min="-5"` was set.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';

describe('Ember: `type` is applied last', () => {
  const compat = useEmberCompatRuntime();
  const input = () => compat.fixture.container.querySelector('input')!;

  test('own attributes: a range value below the default minimum is kept', () => {
    compat.render(
      compileCompat('<input type="range" value={{this.v}} min={{this.min}} max="50" />'),
      { v: '-2', min: '-5' },
    );
    expect(input().getAttribute('type')).toBe('range');
    expect(input().value).toBe('-2');
  });

  test('forwarded attributes (`...attributes`)', () => {
    const Inner = compileCompat('<input ...attributes />');
    compat.render(
      compileCompat('<Inner type="range" value={{this.v}} min="-5" max="50" />', { Inner }),
      { v: '-2' },
    );
    expect(input().getAttribute('type')).toBe('range');
    expect(input().value).toBe('-2');
  });

  test('a forwarded type with own value / min / max', () => {
    const Inner = compileCompat('<input value={{@v}} min="-5" max="50" ...attributes />');
    compat.render(compileCompat('<Inner type="range" @v={{this.v}} />', { Inner }), { v: '-2' });
    expect(input().getAttribute('type')).toBe('range');
    expect(input().value).toBe('-2');
  });

  // GH#19219 (Glimmer's InputValueDynamicAttribute): a browser does not turn
  // `input.value = ''` into a value attribute when the type is set afterwards
  // to radio / checkbox, so the first write of '' also writes the attribute.
  test('an empty value bound on a radio input is rendered as an attribute', () => {
    compat.render(compileCompat('<input type="radio" value={{this.v}} />'), { v: '' });
    expect(input().getAttribute('type')).toBe('radio');
    expect(input().getAttribute('value')).toBe('');
    expect(input().value).toBe('');
  });

  test('a reactive empty value on a checkbox input is rendered as an attribute', () => {
    const v = cell('');
    compat.render(compileCompat('<input type="checkbox" value={{this.v.value}} />'), { v });
    expect(input().getAttribute('value')).toBe('');
  });
});

// Glimmer defers `type` on every element, not only an `<input>`: at compile
// time for an element without `...attributes`, in
// `ComponentElementOperations.flush` for one with them. The attribute order
// shows in the element's HTML (`<button id="action" type="button">`).
// The vitest DOM is gxt's SSR environment, which marks each element with a
// `data-node-id` attribute first.
const attributeNames = (element: Element) =>
  element.getAttributeNames().filter((name) => name !== 'data-node-id');

describe('Ember: `type` is applied last on every element', () => {
  const compat = useEmberCompatRuntime();
  const button = () => compat.fixture.container.querySelector('button')!;

  test('own attributes of a button', () => {
    compat.render(compileCompat('<button type="button" id="action">hello</button>'));
    expect(attributeNames(button())).toEqual(['id', 'type']);
  });

  test('a bound type before a class and an attribute', () => {
    compat.render(compileCompat('<button type={{this.t}} class="b" title="x"></button>'), {
      t: 'submit',
    });
    expect(attributeNames(button())).toEqual(['title', 'class', 'type']);
    expect(button().getAttribute('type')).toBe('submit');
  });

  test('forwarded attributes (`...attributes`) of a button', () => {
    const Inner = compileCompat('<button ...attributes>hello</button>');
    compat.render(compileCompat('<Inner type="button" id="action" />', { Inner }));
    expect(attributeNames(button())).toEqual(['id', 'type']);
  });

  test('a forwarded type with an own attribute', () => {
    const Inner = compileCompat('<button id="action" ...attributes>hello</button>');
    compat.render(compileCompat('<Inner type="reset" />', { Inner }));
    expect(attributeNames(button())).toEqual(['id', 'type']);
    expect(button().getAttribute('type')).toBe('reset');
  });

  test('a type written after `...attributes` wins and is still last', () => {
    const Inner = compileCompat('<button ...attributes type="submit">hello</button>');
    compat.render(compileCompat('<Inner type="reset" id="action" />', { Inner }));
    expect(attributeNames(button())).toEqual(['id', 'type']);
    expect(button().getAttribute('type')).toBe('submit');
  });

  test('an element without a type keeps its attribute order', () => {
    compat.render(compileCompat('<button title="x" id="action">hello</button>'));
    expect(attributeNames(button())).toEqual(['title', 'id']);
  });
});

describe('Ember native: `type` is applied last on every element', () => {
  const runtime = globalThis as unknown as { EMBER_NATIVE: boolean };
  const compat = useEmberCompatRuntime();
  // After the compat runtime's own `beforeEach` (registered first), which
  // restores the constant after the test.
  beforeEach(() => {
    runtime.EMBER_NATIVE = true;
  });

  test('own attributes of a button', () => {
    compat.render(
      compileCompat('<button type="button" id="action">hello</button>', {}, { EMBER_NATIVE: true }),
    );
    const button = compat.fixture.container.querySelector('button')!;
    expect(attributeNames(button)).toEqual(['id', 'type']);
  });
});

describe('standalone gxt: `type` keeps its place', () => {
  const runtime = globalThis as unknown as { WITH_EMBER_INTEGRATION: boolean };
  const compat = useEmberCompatRuntime();
  // After the compat runtime's own `beforeEach` (registered first), which
  // restores the constant after the test.
  beforeEach(() => {
    runtime.WITH_EMBER_INTEGRATION = false;
  });

  test('the source order is kept', () => {
    compat.render(
      compileCompat(
        '<button type="button" id="action">hello</button>',
        {},
        { WITH_EMBER_INTEGRATION: false, WITH_HELPER_MANAGER: false, WITH_MODIFIER_MANAGER: false },
      ),
    );
    const button = compat.fixture.container.querySelector('button')!;
    expect(attributeNames(button)).toEqual(['type', 'id']);
  });
});
