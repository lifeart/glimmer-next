import { describe, test, expect } from 'vitest';
import { $_tpl, isTemplateFn } from './template-fn';

describe('template-function brand (G14)', () => {
  test('$_tpl brands the function in place and returns it', () => {
    const fn = function () {};
    expect($_tpl(fn)).toBe(fn);
    expect(isTemplateFn(fn)).toBe(true);
  });

  test('unbranded functions, classes and non-functions are not template fns', () => {
    expect(isTemplateFn(function () {})).toBe(false);
    expect(isTemplateFn(() => 1)).toBe(false);
    expect(isTemplateFn(class {})).toBe(false);
    // a host "factory" wrapping a template fn is not itself a template fn
    const tpl = $_tpl(function () {});
    expect(isTemplateFn(() => tpl)).toBe(false);
    expect(isTemplateFn({})).toBe(false);
    expect(isTemplateFn(null)).toBe(false);
    expect(isTemplateFn(undefined)).toBe(false);
  });

  test('the brand is a registered symbol (survives duplicated module instances)', () => {
    const fn = $_tpl(function () {});
    expect((fn as any)[Symbol.for('gxt.template-fn')]).toBe(true);
    const foreign = function () {};
    (foreign as any)[Symbol.for('gxt.template-fn')] = true;
    expect(isTemplateFn(foreign)).toBe(true);
  });
});
