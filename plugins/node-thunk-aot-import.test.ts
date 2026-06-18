/**
 * Regression guard for the node-thunk marker ($_nt) AOT auto-import.
 *
 * The compiler emits `$_nt(() => …)` around DOM-producing component children
 * (serializers/element.ts). For an AOT/dev build (the babel/vite plugin path),
 * the symbol must be auto-imported from '@lifeart/gxt' — the plugin injects
 * `Object.values(SYMBOLS)` from plugins/symbols.ts. `$_nt` was originally added
 * ONLY to the emission registry (plugins/compiler/serializers/symbols.ts) and
 * NOT to the auto-import registry (plugins/symbols.ts), so AOT-compiled modules
 * referenced an unimported `$_nt` → `ReferenceError: $_nt is not defined` at
 * render (caught by the `/renderers` e2e page, NOT by the runtime-compiler
 * Vitest tests — those wire $_nt via GXT_RUNTIME_SYMBOLS separately).
 *
 * This test exercises the AOT pipeline end-to-end, so it fails if the two
 * symbol registries drift for $_nt again.
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

describe('node-thunk marker AOT auto-import ($_nt)', () => {
  test('a component with a component child emits AND imports $_nt', () => {
    // No component imports → unresolved tags lower through the element ($_tag)
    // path, so <Parent>'s children include a component-call producer
    // (() => $_tag('Child')) that maybeWrapComponentChildren marks with $_nt —
    // exactly the shape a real <TresCanvas>…</TresCanvas> page produces.
    const source = `<template><Parent><Child /></Parent></template>`;
    const result = transform(
      preprocess(source, 'parent.gts'),
      'parent.gts',
      'development',
      false,
      syncFlags,
    ) as TransformResult;

    // The marker is emitted around the component-child producer.
    expect(result.code).toContain('$_nt(');
    // ...and it is auto-imported from '@lifeart/gxt' — without this the AOT
    // module throws `$_nt is not defined` at render.
    expect(result.code).toMatch(
      /import\s*\{[^}]*\$_nt[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/,
    );
  });

  test('the AOT auto-import registry contains $_nt', () => {
    // Direct guard: the babel plugin injects Object.values(SYMBOLS) — $_nt must
    // be present here (not only in the serializer emission registry).
    expect(Object.values(AOT_SYMBOLS)).toContain('$_nt');
  });
});
