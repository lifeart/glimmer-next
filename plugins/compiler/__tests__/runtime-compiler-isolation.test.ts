/**
 * Tests for runtime-compiler module isolation.
 * Verifies that importing the module does NOT have side effects like auto-setting globals.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

describe('Runtime Compiler Isolation', () => {
  let savedGlobals: Record<string, unknown>;
  let hadInit: boolean;

  beforeEach(() => {
    // Save current global state
    const g = globalThis as any;
    savedGlobals = {};
    hadInit = g.__GXT_RUNTIME_INITIALIZED__;

    // Save and delete runtime-related globals to test fresh import behavior
    const keysToSave = [
      '__GXT_RUNTIME_INITIALIZED__',
      '$_tag',
      '$_c',
      '$_if',
      '$_each',
      '$SLOTS_SYMBOL',
      '$PROPS_SYMBOL',
      '$args',
    ];

    for (const key of keysToSave) {
      if (key in g) {
        savedGlobals[key] = g[key];
      }
    }
  });

  afterEach(() => {
    // Restore saved globals
    const g = globalThis as any;
    for (const [key, value] of Object.entries(savedGlobals)) {
      g[key] = value;
    }
    if (hadInit !== undefined) {
      g.__GXT_RUNTIME_INITIALIZED__ = hadInit;
    }
  });

  test('isGlobalScopeReady returns false before setupGlobalScope is called', async () => {
    // Clear the initialization flag
    const g = globalThis as any;
    delete g.__GXT_RUNTIME_INITIALIZED__;

    // Import the function fresh
    const { isGlobalScopeReady } = await import('../../runtime-compiler');

    // After removing the auto-setup, this should return false
    // until setupGlobalScope() is explicitly called
    expect(isGlobalScopeReady()).toBe(false);
  });

  test('setupGlobalScope can be called explicitly', async () => {
    const g = globalThis as any;
    delete g.__GXT_RUNTIME_INITIALIZED__;

    const { setupGlobalScope, isGlobalScopeReady } = await import('../../runtime-compiler');

    expect(isGlobalScopeReady()).toBe(false);

    setupGlobalScope();

    expect(isGlobalScopeReady()).toBe(true);
    expect(typeof g.$_tag).toBe('function');
  });

  test('compileTemplate auto-initializes if needed (lazy init)', async () => {
    const g = globalThis as any;
    delete g.__GXT_RUNTIME_INITIALIZED__;

    const { compileTemplate, isGlobalScopeReady } = await import('../../runtime-compiler');

    // Lazy initialization should happen when compileTemplate is called
    expect(isGlobalScopeReady()).toBe(false);

    const result = compileTemplate('<div>Test</div>');

    // After compileTemplate, globals should be set up
    expect(isGlobalScopeReady()).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('multiple setupGlobalScope calls are idempotent', async () => {
    const { setupGlobalScope, isGlobalScopeReady, GXT_RUNTIME_SYMBOLS } = await import('../../runtime-compiler');

    setupGlobalScope();
    const firstTag = (globalThis as any).$_tag;

    setupGlobalScope();
    const secondTag = (globalThis as any).$_tag;

    // Should be the same function reference
    expect(firstTag).toBe(secondTag);
    expect(firstTag).toBe(GXT_RUNTIME_SYMBOLS.$_tag);
  });
});
