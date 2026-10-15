/**
 * Run the current test file with the Ember native runtime on: the
 * EMBER_NATIVE / WITH_EMBER_INTEGRATION build constants (which vitest exposes
 * as globals) and the native dynamic-content binding — what the Ember native
 * build defines. Restored after the file's tests.
 */
import { beforeAll, afterAll } from 'vitest';
import { bindNativeContent } from '../dom';
import { setNativeContentBinding } from '../native-content';

type RuntimeConstants = {
  EMBER_NATIVE: boolean;
  WITH_EMBER_INTEGRATION: boolean;
};

export function useNativeRuntime(): void {
  const runtime = globalThis as unknown as RuntimeConstants;
  let saved: RuntimeConstants;
  beforeAll(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = true;
    runtime.WITH_EMBER_INTEGRATION = true;
    setNativeContentBinding(bindNativeContent);
  });
  afterAll(() => {
    setNativeContentBinding(null);
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
  });
}
