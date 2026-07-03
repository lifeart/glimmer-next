/**
 * Regression guard for the `{{unique-id}}` helper ($_uid) AOT auto-import.
 *
 * Under IS_GLIMMER_COMPAT_MODE the compiler emits `$_uid(this, N)` for
 * `{{unique-id}}` (serializers/value.ts `buildHelper`). For an AOT/dev build
 * (the babel/vite plugin path) the symbol must be auto-imported from
 * '@lifeart/gxt' — the plugin injects `Object.values(SYMBOLS)` from
 * plugins/symbols.ts. Following the $_nt / $_qStr lesson, a symbol added ONLY to
 * the emission registry (plugins/compiler/serializers/symbols.ts) and NOT to the
 * auto-import registry (plugins/symbols.ts) produces AOT-compiled modules that
 * reference an unimported `$_uid` → `ReferenceError: $_uid is not defined` at
 * render.
 *
 * This test exercises the AOT pipeline end-to-end, so it fails if the two symbol
 * registries drift for $_uid.
 */
import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';
import { SYMBOLS as AOT_SYMBOLS } from './symbols';

const flags = {
  ...defaultFlags(),
  ASYNC_COMPILE_TRANSFORMS: false,
};
const preprocessor = new Preprocessor();
const preprocess = (source: string, filename: string): string =>
  preprocessor.process(source, { filename }).code;

describe('unique-id AOT auto-import ($_uid)', () => {
  test('a {{unique-id}} template emits AND imports $_uid', () => {
    const source = `<template><div id={{unique-id}}></div></template>`;
    const result = transform(
      preprocess(source, 'widget.gts'),
      'widget.gts',
      'development',
      false,
      flags,
    ) as TransformResult;

    // The helper is emitted for the unique-id call-site.
    expect(result.code).toContain('$_uid(');
    // ...and it is auto-imported from '@lifeart/gxt' — without this the AOT
    // module throws `$_uid is not defined` at render.
    expect(result.code).toMatch(
      /import\s*\{[^}]*\$_uid[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/,
    );
  });

  test('the AOT auto-import registry contains $_uid', () => {
    // Direct guard: the babel plugin injects Object.values(SYMBOLS) — $_uid
    // must be present here (not only in the serializer emission registry).
    expect(Object.values(AOT_SYMBOLS)).toContain('$_uid');
  });
});
