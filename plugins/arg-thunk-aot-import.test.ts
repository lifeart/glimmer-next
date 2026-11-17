/**
 * Regression guard for the arg-thunk marker ($_argThunk) AOT auto-import.
 *
 * The compiler wraps a component's reactive arg getters in `$_argThunk(() => …)`
 * (serializers/element.ts `buildArgsObject`) under the Ember dialect. For an
 * AOT/dev build (the babel/vite plugin path), the symbol must be auto-imported
 * from '@lifeart/gxt' — the plugin injects the names in `Object.values(SYMBOLS)`
 * (plugins/symbols.ts) that appear in the emitted code. If `$_argThunk` were
 * added ONLY to the serializer emission registry
 * (plugins/compiler/serializers/symbols.ts) and NOT to this auto-import
 * registry, AOT-compiled modules would reference an unimported `$_argThunk`
 * (`ReferenceError: $_argThunk is not defined`) at render — the exact drift that
 * once bit `$_nt` (see node-thunk-aot-import.test.ts).
 */
import { describe, test, expect } from 'vitest';
import { SYMBOLS as AOT_SYMBOLS } from './symbols';
import { SYMBOLS as EMIT_SYMBOLS } from './compiler/serializers/symbols';

describe('arg-thunk marker AOT auto-import ($_argThunk)', () => {
  test('the AOT auto-import registry contains $_argThunk', () => {
    // The babel plugin imports Object.values(SYMBOLS) names found in the code,
    // so $_argThunk MUST be present here (not only in the serializer emission
    // registry) or AOT modules throw `$_argThunk is not defined` at render.
    expect(Object.values(AOT_SYMBOLS)).toContain('$_argThunk');
  });

  test('the emission registry and auto-import registry agree on $_argThunk', () => {
    // Both registries must carry the identical runtime name so the compiler
    // emits and the plugin imports the SAME symbol.
    expect((EMIT_SYMBOLS as Record<string, string>).ARG_THUNK).toBe('$_argThunk');
    expect((AOT_SYMBOLS as Record<string, string>).ARG_THUNK).toBe('$_argThunk');
  });
});
