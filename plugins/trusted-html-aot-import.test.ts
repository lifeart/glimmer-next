/**
 * Regression guard for the trusted-HTML helper ($_html) AOT auto-import.
 *
 * Under the EMBER_TRUSTED_HTML flag the compiler lowers a content-position
 * trusting mustache (`{{{expr}}}`) to `$_html(() => expr, this)`
 * (serializers/value.ts `buildHelper`, via the `$__html` marker). For an
 * AOT/dev build (the babel/vite plugin path) the symbol must be auto-imported
 * from '@lifeart/gxt' — the plugin injects `Object.values(SYMBOLS)` from
 * plugins/symbols.ts. Following the $_nt / $_qStr / $_uid lesson, a symbol added
 * ONLY to the emission registry (plugins/compiler/serializers/symbols.ts) and
 * NOT to the auto-import registry (plugins/symbols.ts) produces AOT-compiled
 * modules that reference an unimported `$_html` → `ReferenceError: $_html is not
 * defined` at render.
 *
 * This test exercises the AOT pipeline end-to-end, so it fails if the two symbol
 * registries drift for $_html.
 */
import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';
import { SYMBOLS as AOT_SYMBOLS } from './symbols';

const flags = {
  ...defaultFlags(),
  EMBER_TRUSTED_HTML: true,
  ASYNC_COMPILE_TRANSFORMS: false,
};
const preprocessor = new Preprocessor();
const preprocess = (source: string, filename: string): string =>
  preprocessor.process(source, { filename }).code;

describe('trusted-HTML AOT auto-import ($_html)', () => {
  test('a {{{expr}}} template emits AND imports $_html', () => {
    const source = `<template><div>{{{this.markup}}}</div></template>`;
    const result = transform(
      preprocess(source, 'widget.gts'),
      'widget.gts',
      'development',
      false,
      flags
    ) as TransformResult;

    // The helper is emitted for the trusting mustache.
    expect(result.code).toContain('$_html(');
    // ...and it is auto-imported from '@lifeart/gxt' — without this the AOT
    // module throws `$_html is not defined` at render.
    expect(result.code).toMatch(
      /import\s*\{[^}]*\$_html[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/
    );
  });

  test('the AOT auto-import registry contains $_html', () => {
    // Direct guard: the babel plugin injects Object.values(SYMBOLS) — $_html
    // must be present here (not only in the serializer emission registry).
    expect(Object.values(AOT_SYMBOLS)).toContain('$_html');
  });
});
