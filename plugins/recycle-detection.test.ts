import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';

/**
 * AOT recycle-detection edge cases.
 *
 * `plugins/babel.ts`'s `programUsesRecycle` decides whether a compiled module
 * auto-imports the opt-in `$_eachRecycled` / `$_eachSyncRecycled` entry points
 * from `@lifeart/gxt/recycle` (so the recycle runtime tree-shakes out of every
 * module that does NOT use `key="@recycle"`). It is a source-string regex
 * (`/key\s*=\s*["']@recycle["']/`) over template-literal quasis + string
 * literals.
 *
 * Correctness contract (from the detector's own doc comment):
 *   - false NEGATIVE = a recycled template's entry points are unresolved at
 *     runtime → BREAKAGE. The positive cases below pin this.
 *   - false POSITIVE = benign: the unused import tree-shakes (the recycled entry
 *     points never appear in the emitted output). The edge cases pin this so a
 *     future stricter (AST-level) detector is a deliberate, tested change.
 */

const RECYCLE_ENTRY = '@lifeart/gxt/recycle';
const preprocessor = new Preprocessor();
const syncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false };
const asyncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: true };

async function compile(gts: string, file = 'test.gts', flags = syncFlags): Promise<string> {
  const pre = preprocessor.process(gts, { filename: file }).code;
  const result = (await transform(pre, file, 'development', false, flags)) as TransformResult;
  return result.code;
}

const importsRecycleEntry = (code: string) => code.includes(RECYCLE_ENTRY);
// Count `@lifeart/gxt/recycle` occurrences (≈ number of injected import statements).
const recycleEntryCount = (code: string) => code.split(RECYCLE_ENTRY).length - 1;

describe('AOT recycle detection (programUsesRecycle)', () => {
  describe('positive — MUST auto-import @lifeart/gxt/recycle (a miss would break recycled templates)', () => {
    test('basic {{#each ... key="@recycle"}} injects the entry AND emits the recycled symbol', async () => {
      const code = await compile(
        `<template>{{#each this.items key="@recycle" as |x|}}{{x}}{{/each}}</template>`,
      );
      expect(importsRecycleEntry(code)).toBe(true);
      // the recycled entry point is actually CALLED (so the injected import
      // resolves a real reference, not just a dead specifier)
      expect(code).toMatch(/\$_each(Sync)?Recycled\s*\(/);
    });

    test('recycled symbols are imported from the recycle entry, NEVER the main @lifeart/gxt barrel', async () => {
      const code = await compile(
        `<template>{{#each this.items key="@recycle" as |x|}}{{x}}{{/each}}</template>`,
      );
      const mainImport =
        code.match(/import\s*\{[^}]*\}\s*from\s*['"]@lifeart\/gxt['"]/)?.[0] ?? '';
      expect(mainImport).not.toMatch(/Recycled/);
    });

    test('async compile mode also injects the recycle entry', async () => {
      const code = await compile(
        `<template>{{#each this.items key="@recycle" as |x|}}{{x}}{{/each}}</template>`,
        'test.gts',
        asyncFlags,
      );
      expect(importsRecycleEntry(code)).toBe(true);
    });

    test('a module with several templates injects ONCE when any one uses @recycle', async () => {
      const code = await compile(
        `export const A = <template>{{#each this.a as |x|}}{{x}}{{/each}}</template>;
         export const B = <template>{{#each this.b key="@recycle" as |y|}}{{y}}{{/each}}</template>;`,
      );
      expect(importsRecycleEntry(code)).toBe(true);
      // the injector runs once per Program, so a single import statement
      expect(recycleEntryCount(code)).toBe(1);
    });
  });

  describe('negative — MUST NOT import @lifeart/gxt/recycle', () => {
    test('plain {{#each}} with no key', async () => {
      const code = await compile(`<template>{{#each this.items as |x|}}{{x}}{{/each}}</template>`);
      expect(importsRecycleEntry(code)).toBe(false);
    });

    test('a different built-in key (@index)', async () => {
      const code = await compile(
        `<template>{{#each this.items key="@index" as |x|}}{{x}}{{/each}}</template>`,
      );
      expect(importsRecycleEntry(code)).toBe(false);
    });

    test('a property-path key', async () => {
      const code = await compile(
        `<template>{{#each this.items key="id" as |x|}}{{x}}{{/each}}</template>`,
      );
      expect(importsRecycleEntry(code)).toBe(false);
    });

    test('a module with no template at all', async () => {
      const code = await compile(`export const n = 1 + 1;`, 'plain.ts');
      expect(importsRecycleEntry(code)).toBe(false);
    });
  });

  describe('edge cases of the source-string detector', () => {
    test('false positive: a `key="@recycle"` string literal OUTSIDE a template injects, but is benign (no recycled symbol emitted ⇒ tree-shakes)', () => {
      // KNOWN limitation: the detector scans string literals, so `@recycle` in a
      // plain JS string trips it. Pinned as the documented baseline — benign
      // because nothing references the recycled entry points, so the import is
      // dropped by tree-shaking. (Flip this expectation only with a deliberate
      // move to AST-level detection.)
      return compile(
        `const note = 'use key="@recycle" to opt a block into recycling';
         export default <template>{{this.value}}</template>;`,
      ).then((code) => {
        // the import IS injected (the specifier names appear)...
        expect(importsRecycleEntry(code)).toBe(true);
        // ...but the recycled entry point is never CALLED, so the imported
        // specifiers are unreferenced and a bundler drops them (the benign part)
        expect(code).not.toMatch(/\$_each(Sync)?Recycled\s*\(/);
      });
    });

    test('whitespace around the `=` is tolerated (key = "@recycle")', async () => {
      // the regex allows `\s*` around `=`; guards against a formatting false-negative
      const code = await compile(
        `<template>{{#each this.items key = "@recycle" as |x|}}{{x}}{{/each}}</template>`,
      );
      expect(importsRecycleEntry(code)).toBe(true);
    });
  });
});
