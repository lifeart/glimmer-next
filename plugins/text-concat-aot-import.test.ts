/**
 * Regression guard for the collapsed mixed-text helper ($_txt) AOT
 * auto-import (see quoted-attr-concat-aot-import.test.ts for the pattern):
 * a symbol added only to the emission registry
 * (plugins/compiler/serializers/symbols.ts) and not to the auto-import
 * registry (plugins/symbols.ts) produces AOT modules that reference an
 * unimported `$_txt` → ReferenceError at render.
 */
import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';
import { SYMBOLS as AOT_SYMBOLS } from './symbols';

const preprocessor = new Preprocessor();

describe('collapsed mixed text AOT auto-import ($_txt)', () => {
  test('a mixed-text template emits AND imports $_txt', () => {
    const source = `<template><span>Count: {{this.count}}!</span></template>`;
    const result = transform(
      preprocessor.process(source, { filename: 'counter.gts' }).code,
      'counter.gts',
      'development',
      false,
      { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false },
    ) as TransformResult;
    expect(result.code).toContain('$_txt(');
    expect(result.code).toMatch(
      /import\s*\{[^}]*\$_txt[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/,
    );
  });

  test('the AOT auto-import registry contains $_txt', () => {
    expect(Object.values(AOT_SYMBOLS)).toContain('$_txt');
  });
});
