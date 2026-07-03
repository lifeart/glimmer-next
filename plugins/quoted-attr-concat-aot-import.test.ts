/**
 * Regression guard for the quoted-attr concat helper ($_qStr) AOT auto-import.
 *
 * Under the EMBER_ATTR_CONCAT flag the compiler emits `$_qStr([...])` for
 * interpolated quoted attribute values (serializers/value.ts `buildConcat`).
 * For an AOT/dev build (the babel/vite plugin path) the symbol must be
 * auto-imported from '@lifeart/gxt' — the plugin injects `Object.values(SYMBOLS)`
 * from plugins/symbols.ts. Following the $_nt lesson (#236), a symbol added ONLY
 * to the emission registry (plugins/compiler/serializers/symbols.ts) and NOT to
 * the auto-import registry (plugins/symbols.ts) produces AOT-compiled modules
 * that reference an unimported `$_qStr` → `ReferenceError: $_qStr is not
 * defined` at render.
 *
 * This test exercises the AOT pipeline end-to-end with the flag ON, so it fails
 * if the two symbol registries drift for $_qStr.
 */
import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';
import { SYMBOLS as AOT_SYMBOLS } from './symbols';

const flagsOn = {
  ...defaultFlags(),
  ASYNC_COMPILE_TRANSFORMS: false,
  EMBER_ATTR_CONCAT: true,
};
const preprocessor = new Preprocessor();
const preprocess = (source: string, filename: string): string =>
  preprocessor.process(source, { filename }).code;

describe('quoted-attr concat AOT auto-import ($_qStr)', () => {
  test('a flag-on quoted-attr template emits AND imports $_qStr', () => {
    const source = `<template><div class="base {{this.active}} end"></div></template>`;
    const result = transform(
      preprocess(source, 'widget.gts'),
      'widget.gts',
      'development',
      false,
      flagsOn,
    ) as TransformResult;

    // The helper is emitted for the interpolated quoted attribute.
    expect(result.code).toContain('$_qStr(');
    // ...and it is auto-imported from '@lifeart/gxt' — without this the AOT
    // module throws `$_qStr is not defined` at render.
    expect(result.code).toMatch(
      /import\s*\{[^}]*\$_qStr[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/,
    );
  });

  test('the AOT auto-import registry contains $_qStr', () => {
    // Direct guard: the babel plugin injects Object.values(SYMBOLS) — $_qStr
    // must be present here (not only in the serializer emission registry).
    expect(Object.values(AOT_SYMBOLS)).toContain('$_qStr');
  });
});
