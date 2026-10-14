/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): Glimmer's
 * `...attributes` precedence on an element, in gxt's own `_DOM`.
 *
 * Glimmer applies an element's attributes in source order with
 * `...attributes` expanded in place: an attribute written AFTER
 * `...attributes` overrides the forwarded one, and class values concatenate in
 * source order. The compat compiler lists what follows the splat in the
 * `__splatLocal__` marker; until now only Ember's runtime-template `$_tag`
 * wrapper and the native runtime honoured it, so a build-time (.gjs) template
 * of an Ember consumer, whose `$_tag` is gxt's own, rendered `class="fw own"`
 * for `<div class="own" ...attributes>` and let a forwarded attribute beat one
 * written after `...attributes`.
 *
 * The runtime build constants are vitest globals, turned on per test as the
 * Ember compat build defines them.
 */
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';

describe('Ember compat: `...attributes` precedence in gxt `_DOM`', () => {
  const compat = useEmberCompatRuntime();

  function render(inner: string, outer: string) {
    const Inner = compileCompat(inner);
    compat.render(compileCompat(outer, { Inner }));
    return compat.fixture.container.querySelector('div')!;
  }

  test('own attributes and class written before `...attributes`: forwarded attribute wins, own class first', () => {
    const div = render(
      '<div class="own" data-x="own" title="own" ...attributes></div>',
      '<Inner class="fw" data-x="fw" />',
    );
    expect(div.getAttribute('class')).toBe('own fw');
    expect(div.getAttribute('data-x')).toBe('fw');
    expect(div.getAttribute('title')).toBe('own');
  });

  test('own attributes and class written after `...attributes`: own attribute wins, forwarded class first', () => {
    const div = render(
      '<div ...attributes class="own" data-x="own"></div>',
      '<Inner class="fw" data-x="fw" title="fw" />',
    );
    expect(div.getAttribute('class')).toBe('fw own');
    expect(div.getAttribute('data-x')).toBe('own');
    expect(div.getAttribute('title')).toBe('fw');
  });

  test('the marker is never written to the element', () => {
    const div = render('<div ...attributes data-x="own"></div>', '<Inner data-x="fw" />');
    expect(div.getAttribute('data-x')).toBe('own');
    expect(div.hasAttribute('__splatLocal__')).toBe(false);
    expect('__splatLocal__' in div).toBe(false);
  });
});
