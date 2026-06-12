import { describe, it, expect, afterEach } from 'vitest';
import {
  HOST_HOOKS,
  registerHostHooks,
  isHostFunctionalHelper,
  markHostFunctionalHelper,
  type HostHooks,
} from './host-hooks';

function resetHooks() {
  for (const key of Object.keys(HOST_HOOKS)) {
    delete (HOST_HOOKS as Record<string, unknown>)[key];
  }
}

describe('registerHostHooks', () => {
  afterEach(() => {
    resetHooks();
    delete (globalThis as Record<string, unknown>)['EmberFunctionalHelpers'];
  });

  it('merges registered hooks into the slot table', () => {
    const toBool = (v: unknown) => v === 'yes';
    registerHostHooks({ toBool });
    expect(HOST_HOOKS.toBool).toBe(toBool);
  });

  it('later registrations override per-key and keep other keys', () => {
    const first: HostHooks = {
      toBool: () => true,
      scheduleRevalidate: () => {},
    };
    registerHostHooks(first);
    const secondToBool = () => false;
    registerHostHooks({ toBool: secondToBool });
    expect(HOST_HOOKS.toBool).toBe(secondToBool);
    expect(HOST_HOOKS.scheduleRevalidate).toBe(first.scheduleRevalidate);
  });

  it('ignores undefined values instead of clearing a slot', () => {
    const toBool = () => true;
    registerHostHooks({ toBool });
    registerHostHooks({ toBool: undefined });
    expect(HOST_HOOKS.toBool).toBe(toBool);
  });

  describe('functional-helper brand', () => {
    it('prefers the registered hook pair', () => {
      const branded = new WeakSet<object>();
      registerHostHooks({
        isFunctionalHelper: (fn) => branded.has(fn as object),
        markFunctionalHelper: (fn) => void branded.add(fn as object),
      });
      const helper = () => {};
      expect(isHostFunctionalHelper(helper)).toBe(false);
      markHostFunctionalHelper(helper);
      expect(isHostFunctionalHelper(helper)).toBe(true);
    });

    it('falls back to the legacy EmberFunctionalHelpers global Set', () => {
      const legacy = new Set<unknown>();
      (globalThis as Record<string, unknown>)['EmberFunctionalHelpers'] =
        legacy;
      const helper = () => {};
      expect(isHostFunctionalHelper(helper)).toBe(false);
      markHostFunctionalHelper(helper);
      expect(legacy.has(helper)).toBe(true);
      expect(isHostFunctionalHelper(helper)).toBe(true);
    });

    it('is inert when neither hook nor legacy global exists', () => {
      const helper = () => {};
      expect(isHostFunctionalHelper(helper)).toBe(false);
      expect(() => markHostFunctionalHelper(helper)).not.toThrow();
    });
  });
});
