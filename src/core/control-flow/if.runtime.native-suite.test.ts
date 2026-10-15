/**
 * if.runtime.test.ts — the if runtime suite — under the Ember native runtime (EMBER_NATIVE /
 * WITH_EMBER_INTEGRATION on, the native content binding registered): the same
 * tests hold with Glimmer's block bounds in place (control-flow/if.ts
 * `settleNativeBounds`). The default-mode run is if.runtime.test.ts itself.
 */
import { useNativeRuntime } from '../__test-utils__/native-runtime';

useNativeRuntime();
await import('./if.runtime.test');
