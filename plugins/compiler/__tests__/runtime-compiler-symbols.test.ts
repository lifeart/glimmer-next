/**
 * Tests for runtime-compiler symbol consistency.
 * Verifies that symbols used in runtime-compiler match those in dom.ts.
 */
import { describe, test, expect } from 'vitest';
import { $SLOTS_SYMBOL, $PROPS_SYMBOL, $_GET_SLOTS, $_GET_FW } from '../../../src/core/dom';
import { setupGlobalScope } from '../../runtime-compiler';

describe('Runtime Compiler Symbol Consistency', () => {
  test('$SLOTS_SYMBOL from setupGlobalScope matches dom.ts $SLOTS_SYMBOL', () => {
    setupGlobalScope();

    const g = globalThis as any;

    // The global $SLOTS_SYMBOL should be the exact same symbol as dom.ts exports
    // Before the fix: runtime-compiler uses Symbol.for('gxt-slots')
    // After the fix: runtime-compiler imports and uses the same Symbol('slots') from dom.ts
    expect(g.$SLOTS_SYMBOL).toBe($SLOTS_SYMBOL);
  });

  test('$PROPS_SYMBOL from setupGlobalScope matches dom.ts $PROPS_SYMBOL', () => {
    setupGlobalScope();

    const g = globalThis as any;

    // The global $PROPS_SYMBOL should be the exact same symbol as dom.ts exports
    // Before the fix: runtime-compiler uses Symbol.for('gxt-props')
    // After the fix: runtime-compiler imports and uses the same Symbol('props') from dom.ts
    expect(g.$PROPS_SYMBOL).toBe($PROPS_SYMBOL);
  });

  test('symbols are actual Symbol instances', () => {
    // Verify that the dom.ts symbols are actual Symbol instances
    expect(typeof $SLOTS_SYMBOL).toBe('symbol');
    expect(typeof $PROPS_SYMBOL).toBe('symbol');
  });

  test('$_GET_SLOTS uses the correct symbol', () => {
    setupGlobalScope();

    // Create a mock args object with slots
    const mockSlots = { default: () => [] };
    const args = {
      [$SLOTS_SYMBOL]: mockSlots,
    };

    // Create a mock context
    const ctx = { args: {} };

    // $_GET_SLOTS should find the slots using the correct symbol
    const slots = $_GET_SLOTS(ctx, [args]);
    expect(slots).toBe(mockSlots);
  });

  test('$_GET_FW uses the correct symbol', () => {
    setupGlobalScope();

    // Create a mock args object with props/fw
    const mockFw = [[], [], []];
    const args = {
      [$PROPS_SYMBOL]: mockFw,
    };

    // Create a mock context
    const ctx = { args: {} };

    // $_GET_FW should find the fw using the correct symbol
    const fw = $_GET_FW(ctx, [args]);
    expect(fw).toBe(mockFw);
  });
});
