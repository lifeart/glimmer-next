import { describe, test, expect } from 'vitest';
import { lookupTypeHint, classifyReactivity, shouldSkipGetterWrapper, lookupHelperReturnHint } from '../type-hints';
import { createContext } from '../context';
import type { CompilerContext } from '../context';
import type { PropertyTypeHint, TypeHints } from '../types';

function makeCtx(opts: {
  withTypeOptimization?: boolean;
  typeHints?: TypeHints;
} = {}): CompilerContext {
  return createContext('', {
    flags: {
      WITH_TYPE_OPTIMIZATION: opts.withTypeOptimization ?? false,
    },
    typeHints: opts.typeHints,
  });
}

describe('lookupTypeHint', () => {
  test('returns undefined when optimization is disabled', () => {
    const ctx = makeCtx({
      withTypeOptimization: false,
      typeHints: { properties: { 'this.title': { kind: 'primitive' } } },
    });
    expect(lookupTypeHint(ctx, 'this.title', false)).toBeUndefined();
  });

  test('returns undefined when no typeHints on ctx', () => {
    const ctx = makeCtx({ withTypeOptimization: true });
    expect(lookupTypeHint(ctx, 'this.title', false)).toBeUndefined();
  });

  test('returns matching hint for known property', () => {
    const hint: PropertyTypeHint = { kind: 'primitive' };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.title': hint } },
    });
    expect(lookupTypeHint(ctx, 'this.title', false)).toEqual(hint);
  });

  test('returns hint for tracked property', () => {
    const hint: PropertyTypeHint = { kind: 'primitive', isTracked: true };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.count': hint } },
    });
    expect(lookupTypeHint(ctx, 'this.count', false)).toEqual(hint);
  });

  test('returns undefined for unknown property', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.title': { kind: 'primitive' } } },
    });
    expect(lookupTypeHint(ctx, 'this.unknown', false)).toBeUndefined();
  });

  test('resolves arg with dot notation', () => {
    const hint: PropertyTypeHint = { kind: 'primitive', isTracked: true };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { args: { userName: hint } },
    });
    expect(lookupTypeHint(ctx, 'this[$args].userName', true)).toEqual(hint);
  });

  test('resolves arg with double-quote bracket notation', () => {
    const hint: PropertyTypeHint = { kind: 'primitive' };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { args: { 'user-name': hint } },
    });
    expect(lookupTypeHint(ctx, 'this[$args]["user-name"]', true)).toEqual(hint);
  });

  test('resolves arg with single-quote bracket notation', () => {
    const hint: PropertyTypeHint = { kind: 'primitive' };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { args: { name: hint } },
    });
    expect(lookupTypeHint(ctx, "this[$args]['name']", true)).toEqual(hint);
  });

  test('subpath this.user.name does not match this.user hint (exact match)', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.user': { kind: 'object' } } },
    });
    expect(lookupTypeHint(ctx, 'this.user.name', false)).toBeUndefined();
    expect(lookupTypeHint(ctx, 'this.user', false)).toEqual({ kind: 'object' });
  });

  test('returns undefined for arg when args hints not provided', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.title': { kind: 'primitive' } } },
    });
    expect(lookupTypeHint(ctx, 'this[$args].label', true)).toBeUndefined();
  });

  test('returns undefined when typeHints has no properties key', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: {},
    });
    expect(lookupTypeHint(ctx, 'this.title', false)).toBeUndefined();
  });

  test('isArg with plain name (no $args) resolves via fallback', () => {
    const hint: PropertyTypeHint = { kind: 'primitive' };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { args: { userName: hint } },
    });
    expect(lookupTypeHint(ctx, 'userName', true)).toEqual(hint);
  });

  test('subpath this.user.address.city does not match this.user hint', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.user': { kind: 'object' } } },
    });
    expect(lookupTypeHint(ctx, 'this.user.address.city', false)).toBeUndefined();
  });
});

describe('classifyReactivity', () => {
  test('returns unknown for undefined hint', () => {
    expect(classifyReactivity(undefined)).toBe('unknown');
  });

  test('returns unknown for kind: unknown', () => {
    expect(classifyReactivity({ kind: 'unknown' })).toBe('unknown');
  });

  test('returns static for kind: primitive with isReadonly', () => {
    expect(classifyReactivity({ kind: 'primitive', isReadonly: true })).toBe('static');
  });

  test('returns static for kind: primitive (plain, no tracked)', () => {
    expect(classifyReactivity({ kind: 'primitive' })).toBe('static');
  });

  test('returns reactive for kind: primitive with isTracked', () => {
    expect(classifyReactivity({ kind: 'primitive', isTracked: true })).toBe('reactive');
  });

  test('returns reactive for kind: cell', () => {
    expect(classifyReactivity({ kind: 'cell' })).toBe('reactive');
  });

  test('returns unknown for kind: object', () => {
    expect(classifyReactivity({ kind: 'object' })).toBe('unknown');
  });

  test('returns unknown for kind: function', () => {
    expect(classifyReactivity({ kind: 'function' })).toBe('unknown');
  });

  test('returns reactive for kind: object with isTracked', () => {
    expect(classifyReactivity({ kind: 'object', isTracked: true })).toBe('reactive');
  });

  test('returns reactive for kind: function with isTracked', () => {
    expect(classifyReactivity({ kind: 'function', isTracked: true })).toBe('reactive');
  });

  test('returns reactive for kind: unknown with isTracked', () => {
    expect(classifyReactivity({ kind: 'unknown', isTracked: true })).toBe('reactive');
  });

  test('returns reactive for isTracked regardless of isReadonly', () => {
    // isTracked takes precedence over isReadonly
    expect(classifyReactivity({ kind: 'primitive', isTracked: true, isReadonly: true })).toBe('reactive');
  });
});

describe('shouldSkipGetterWrapper', () => {
  test('returns false for args even with primitive hint', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { args: { label: { kind: 'primitive' } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this[$args].label', true)).toBe(false);
  });

  test('returns true for plain (non-tracked) property', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.title': { kind: 'primitive' } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.title', false)).toBe(true);
  });

  test('returns false for tracked property', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.count': { kind: 'primitive', isTracked: true } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.count', false)).toBe(false);
  });

  test('returns false when optimization is off', () => {
    const ctx = makeCtx({
      withTypeOptimization: false,
      typeHints: { properties: { 'this.title': { kind: 'primitive' } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.title', false)).toBe(false);
  });

  test('returns false for object kind (unknown reactivity)', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.data': { kind: 'object' } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.data', false)).toBe(false);
  });

  test('returns false for function kind (unknown reactivity)', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.handler': { kind: 'function' } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.handler', false)).toBe(false);
  });

  test('returns false for tracked object kind', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.items': { kind: 'object', isTracked: true } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.items', false)).toBe(false);
  });

  test('returns false for property without hint (unknown)', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: {} },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.missing', false)).toBe(false);
  });

  test('returns true for readonly primitive', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.VERSION': { kind: 'primitive', isReadonly: true } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.VERSION', false)).toBe(true);
  });

  test('returns false for cell kind', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { properties: { 'this.state': { kind: 'cell' } } },
    });
    expect(shouldSkipGetterWrapper(ctx, 'this.state', false)).toBe(false);
  });
});

describe('lookupHelperReturnHint', () => {
  test('returns hint for known helper', () => {
    const hint: PropertyTypeHint = { kind: 'primitive' };
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { helperReturns: { myHelper: hint } },
    });
    expect(lookupHelperReturnHint(ctx, 'myHelper')).toEqual(hint);
  });

  test('returns undefined for unknown helper', () => {
    const ctx = makeCtx({
      withTypeOptimization: true,
      typeHints: { helperReturns: { myHelper: { kind: 'primitive' } } },
    });
    expect(lookupHelperReturnHint(ctx, 'otherHelper')).toBeUndefined();
  });

  test('returns undefined when optimization is off', () => {
    const ctx = makeCtx({
      withTypeOptimization: false,
      typeHints: { helperReturns: { myHelper: { kind: 'primitive' } } },
    });
    expect(lookupHelperReturnHint(ctx, 'myHelper')).toBeUndefined();
  });
});
