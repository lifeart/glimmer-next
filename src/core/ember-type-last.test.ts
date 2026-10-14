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
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';

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
});
