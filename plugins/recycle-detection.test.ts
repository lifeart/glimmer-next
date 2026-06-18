import { describe, test, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';

/**
 * AOT recycle-detection.
 *
 * Whether a compiled module auto-imports the opt-in `$_eachRecycled` /
 * `$_eachSyncRecycled` entry points from `@lifeart/gxt/recycle` (so the recycle
 * runtime tree-shakes out of every module that does NOT use `key="@recycle"`)
 * is now driven by the compiler's GROUND TRUTH: the {{#each}} serializer
 * (plugins/compiler/serializers/control.ts) sets `ctx.usedRecycle` the moment
 * it emits a recycled entry point, that surfaces on `CompileResult.usedRecycle`,
 * and the module assembler (plugins/test.ts) prepends the
 * `@lifeart/gxt/recycle` import iff ANY template in the module reports it.
 *
 * This REPLACES the old source-string regex heuristic (`programUsesRecycle` in
 * babel.ts, `/key\s*=\s*["']@recycle["']/`). Consequences pinned below:
 *   - false NEGATIVE = a recycled template's entry points are unresolved at
 *     runtime → BREAKAGE. The positive cases pin this.
 *   - false POSITIVE is now IMPOSSIBLE: a `key="@recycle"` string that is NOT a
 *     compiled `{{#each}}` key emits no recycled symbol, so no import is
 *     injected (the flipped edge-case assertion below pins this).
 *   - a manual `@lifeart/gxt/recycle` import is never duplicated (dedup test).
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

describe('AOT recycle detection (compiler ground-truth: CompileResult.usedRecycle)', () => {
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

  describe('ground-truth edge cases', () => {
    test('NO false positive: a `key="@recycle"` string literal OUTSIDE a template emits no recycled symbol ⇒ NO import injected', () => {
      // The OLD source-string detector scanned string literals, so `@recycle`
      // in a plain JS string tripped it (a benign-but-real false positive).
      // Driving the import from the compiler's actual emission removes that
      // failure mode entirely: nothing compiled to a recycled entry point, so
      // the assembler injects nothing.
      return compile(
        `const note = 'use key="@recycle" to opt a block into recycling';
         export default <template>{{this.value}}</template>;`,
      ).then((code) => {
        // no recycled entry point was emitted...
        expect(code).not.toMatch(/\$_each(Sync)?Recycled\s*\(/);
        // ...so no `@lifeart/gxt/recycle` import is injected at all
        expect(importsRecycleEntry(code)).toBe(false);
      });
    });

    test('whitespace around the `=` is tolerated (key = "@recycle")', async () => {
      // `key = "@recycle"` is still a valid each key, so it compiles to a
      // recycled entry point and the import is injected — now via the compiler
      // ground truth rather than a regex that had to allow `\s*` around `=`.
      const code = await compile(
        `<template>{{#each this.items key = "@recycle" as |x|}}{{x}}{{/each}}</template>`,
      );
      expect(importsRecycleEntry(code)).toBe(true);
      expect(code).toMatch(/\$_each(Sync)?Recycled\s*\(/);
    });

    test('a manual `@lifeart/gxt/recycle` import + real use is NOT double-imported', async () => {
      // When the author already imports the recycle entry points themselves
      // and uses a recycled block, the assembler must not prepend a second
      // import (which would duplicate the binding). Guarded by the
      // already-contains-specifier check in plugins/test.ts.
      const code = await compile(
        `import { $_eachRecycled } from '@lifeart/gxt/recycle';
         export default <template>{{#each this.items key="@recycle" as |x|}}{{x}}{{/each}}</template>;`,
      );
      // the recycled entry point is emitted/used...
      expect(code).toMatch(/\$_each(Sync)?Recycled\s*\(/);
      // ...and `@lifeart/gxt/recycle` appears exactly once (the manual import,
      // no injected duplicate)
      expect(recycleEntryCount(code)).toBe(1);
    });

    test('a bare "@lifeart/gxt/recycle" string elsewhere does NOT suppress a needed injection', async () => {
      // The dedup guard matches a real `from '@lifeart/gxt/recycle'` import
      // clause, not the bare string — so a literal mention (here in a JS string)
      // in a module that genuinely recycles must STILL get the import injected.
      // A substring-based guard would false-NEGATIVE here and leave $_eachRecycled
      // unresolved at runtime.
      const code = await compile(
        `const doc = 'see @lifeart/gxt/recycle for details';
         export default <template>{{#each this.items key="@recycle" as |x|}}{{x}}{{/each}}</template>;`,
      );
      // the import clause is actually present (not merely the bare string)
      expect(code).toMatch(/import\s*\{[^}]*\}\s*from\s*['"]@lifeart\/gxt\/recycle['"]/);
      expect(code).toMatch(/\$_each(Sync)?Recycled\s*\(/);
    });
  });
});
