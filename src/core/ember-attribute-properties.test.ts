/**
 * Ember (compat and native): Glimmer's normalizeProperty for a dynamic value
 * gxt classified as a property — a name the element has no property for, and
 * the ATTR_OVERRIDES names (`form`, `list`, `autocorrect`), are written as
 * attributes. Compat assigned them as properties: `<button form={{x}}>` threw
 * (getter-only `form`), `<input list={{x}}>` did nothing and
 * `<foo-bar some-attr={{x}}>` became an expando.
 */
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom } from './runtime';

describe('Ember compat: normalizeProperty for dynamic properties', () => {
  const compat = useEmberCompatRuntime();
  const q = (sel: string) => compat.fixture.container.querySelector(sel)!;

  test('form / list are attributes and update', async () => {
    const f = cell('form1');
    compat.render(
      compileCompat('<button form={{this.f.value}}></button><input list={{this.f.value}} />'),
      { f },
    );
    expect(q('button').getAttribute('form')).toBe('form1');
    expect(q('input').getAttribute('list')).toBe('form1');
    f.update('form2');
    await syncDom();
    expect(q('button').getAttribute('form')).toBe('form2');
    expect(q('input').getAttribute('list')).toBe('form2');
  });

  test("an attribute unknown to a custom element is an attribute, not an expando", () => {
    compat.render(compileCompat('<foo-bar some-attr={{this.v}}>hello</foo-bar>'), { v: '123' });
    const el = q('foo-bar');
    expect(el.getAttribute('some-attr')).toBe('123');
    expect(Object.prototype.hasOwnProperty.call(el, 'some-attr')).toBe(false);
  });

  test('a known property is still a property', () => {
    compat.render(compileCompat('<input value={{this.v}} />'), { v: 'x' });
    expect((q('input') as HTMLInputElement).value).toBe('x');
    expect(q('input').hasAttribute('value')).toBe(false);
  });

  test('static attributes are attributes', () => {
    compat.render(
      compileCompat('<button form="f" spellcheck="false" style="display: flex"></button>'),
    );
    const el = q('button');
    expect(el.getAttribute('form')).toBe('f');
    expect(el.getAttribute('spellcheck')).toBe('false');
    expect(el.getAttribute('style')).toBe('display: flex');
  });
});
