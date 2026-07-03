/**
 * Regression guard for the named-block thunk marker ($_nbt) AOT auto-import.
 *
 * The compiler emits `$_nbt(() => $_tag(':name', …), 'name')` around compat
 * named-block children (serializers/element.ts). For an AOT/dev build (the
 * babel/vite plugin path), the symbol must be auto-imported from '@lifeart/gxt'
 * — the plugin injects `Object.values(SYMBOLS)` from plugins/symbols.ts. This
 * mirrors the $_nt AOT-import trap (#236): a marker added ONLY to the emission
 * registry (plugins/compiler/serializers/symbols.ts) but NOT to the auto-import
 * registry (plugins/symbols.ts) would make AOT-compiled modules reference an
 * unimported `$_nbt` → `ReferenceError: $_nbt is not defined` at render. The
 * runtime-compiler Vitest path wires $_nbt via GXT_RUNTIME_SYMBOLS separately,
 * so only the AOT path exercises this — hence this dedicated end-to-end test.
 */
import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';
import { SYMBOLS as AOT_SYMBOLS } from './symbols';

const syncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false };
const preprocessor = new Preprocessor();
const preprocess = (source: string, filename: string): string =>
  preprocessor.process(source, { filename }).code;

describe('named-block thunk marker AOT auto-import ($_nbt)', () => {
  test('a component with a named block emits AND imports $_nbt', () => {
    // No component imports → the unresolved <Foo> tag lowers through the element
    // ($_tag) path, and its `<:header>` named-block child is marked with $_nbt —
    // exactly the shape a real registry page produces.
    const source = `<template><Foo><:header>hi</:header></Foo></template>`;
    const result = transform(
      preprocess(source, 'foo.gts'),
      'foo.gts',
      'development',
      false,
      syncFlags,
    ) as TransformResult;

    // The marker is emitted around the named-block factory.
    expect(result.code).toContain('$_nbt(');
    // ...and it is auto-imported from '@lifeart/gxt' — without this the AOT
    // module throws `$_nbt is not defined` at render.
    expect(result.code).toMatch(
      /import\s*\{[^}]*\$_nbt[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/,
    );
  });

  test('the AOT auto-import registry contains $_nbt', () => {
    // Direct guard: the babel plugin injects Object.values(SYMBOLS) — $_nbt must
    // be present here (not only in the serializer emission registry).
    expect(Object.values(AOT_SYMBOLS)).toContain('$_nbt');
  });
});
