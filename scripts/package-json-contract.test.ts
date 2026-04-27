/**
 * Tests for the package.json `types` and `files` contract changes
 * in commit a128135.
 *
 * - Each `exports.<entry>.types` path must point at a real `.d.ts` file
 *   that exists under `dist/`.
 * - The top-level `types` (`./dist/index.d.ts`) must exist.
 * - The `files` glob must include `dist/*.d.ts` so the .d.ts entries
 *   are actually packed.
 *
 * These tests would fail if the next refactor of the build pipeline
 * silently moves a `.d.ts` file around (which would ship a broken
 * package), or if someone reverts the `files` widening.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PKG = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
);

// The "file exists" half of the contract only makes sense once the lib
// has been built. On a clean CI checkout `dist/` is absent, so the
// existence assertions are gated on the build artifact being present.
// The shape assertions (paths point under ./dist/, end in .d.ts, and
// don't regress to the broken ./dist/src/utils/... locations) always
// run — those are the part most likely to silently regress in a
// future refactor.
const DIST_BUILT = existsSync(resolve(REPO_ROOT, 'dist'));

describe('package.json types & files contract', () => {
  test('top-level "types" points at a path under dist/ that ends in .d.ts', () => {
    expect(typeof PKG.types).toBe('string');
    expect(PKG.types.startsWith('./dist/')).toBe(true);
    expect(PKG.types.endsWith('.d.ts')).toBe(true);
    // Pin against the exact regression we just fixed: ./dist/src/utils/*
    // paths are not produced by the build pipeline.
    expect(PKG.types).not.toMatch(/^\.\/dist\/src\//);
  });

  test.runIf(DIST_BUILT)(
    'top-level "types" file actually exists after build-lib',
    () => {
      const abs = resolve(REPO_ROOT, PKG.types);
      expect(existsSync(abs), `expected types file at ${abs}`).toBe(true);
    },
  );

  test('every exports[*].types entry has a valid shape under dist/', () => {
    expect(PKG.exports).toBeDefined();
    expect(typeof PKG.exports).toBe('object');

    const checked: string[] = [];
    for (const [entryKey, value] of Object.entries(PKG.exports)) {
      // `value` is a conditional-export object with `import` / `types`.
      if (value === null || typeof value !== 'object') continue;
      const v = value as { types?: string; import?: string };
      expect(typeof v.types, `${entryKey}.types must be a string`).toBe(
        'string',
      );
      expect(
        v.types!.startsWith('./dist/'),
        `${entryKey}.types must live under ./dist/, got ${v.types}`,
      ).toBe(true);
      expect(
        v.types!.endsWith('.d.ts'),
        `${entryKey}.types must end with .d.ts, got ${v.types}`,
      ).toBe(true);
      // Same regression check as above: no ./dist/src/utils/ paths.
      expect(
        v.types!,
        `${entryKey}.types must not regress to ./dist/src/utils/...`,
      ).not.toMatch(/^\.\/dist\/src\//);
      checked.push(entryKey);
    }

    // Sanity: at least the public entries we care about exist.
    expect(checked).toContain('.');
    expect(checked).toContain('./compiler');
    expect(checked).toContain('./runtime-compiler');
  });

  test.runIf(DIST_BUILT)(
    'every exports[*].types entry resolves to a real .d.ts after build-lib',
    () => {
      for (const [entryKey, value] of Object.entries(PKG.exports)) {
        if (value === null || typeof value !== 'object') continue;
        const v = value as { types?: string };
        if (typeof v.types !== 'string') continue;
        const abs = resolve(REPO_ROOT, v.types);
        expect(
          existsSync(abs),
          `${entryKey}: missing .d.ts file at ${abs}`,
        ).toBe(true);
      }
    },
  );

  test('"files" glob includes "dist/*.d.ts" so root-level .d.ts files are packed', () => {
    expect(Array.isArray(PKG.files), 'files must be an array').toBe(true);
    expect(PKG.files).toContain('dist/*.d.ts');
  });

  test('"files" glob also includes "dist/src" (where deep .d.ts trees live)', () => {
    // Defense-in-depth: the deeper d.ts tree under dist/src must also be packed.
    // This is the form used by package consumers that do "import from '.../dist/src/...'".
    expect(PKG.files).toContain('dist/src');
  });
});
