/**
 * Soft-fail behavior contract for `scripts/copy-dist-to-ember.mjs`.
 *
 * The script is wired as `postbuild-lib` and `prepublishOnly` runs
 * `build-lib` on a clean machine where the user's local Ember repo
 * (or its pnpm store, or the @lifeart+gxt entry inside it) does NOT
 * exist. Hard-failing in those environments would abort `npm publish`.
 *
 * Contract:
 *   - When the target Ember repo does not exist: exit 0 with a "skip:"
 *     warning printed to stderr.
 *   - When the pnpm store under that repo does not exist: exit 0 with skip.
 *   - When `@lifeart+gxt@*` is missing from the pnpm store: exit 0 with skip.
 *   - With `GXT_COPY_DIST_REQUIRED=1` set, every one of those misses must
 *     instead exit 1 with an "ERROR:" prefix.
 *
 * We invoke the script as a child process to avoid its top-level side effects
 * (cpSync / rmSync against the calling user's filesystem).
 */
import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(
  fileURLToPath(import.meta.url),
  '..',
  'copy-dist-to-ember.mjs',
);

/**
 * Spawn the copy-dist script. Returns a normalized result.
 */
function runScript(emberRepoArg: string, env: Record<string, string> = {}) {
  const result = spawnSync('node', [SCRIPT, emberRepoArg], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    // Don't inherit stdio — we capture it.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    combined: (result.stdout ?? '') + (result.stderr ?? ''),
  };
}

describe('scripts/copy-dist-to-ember.mjs soft-fail contract', () => {
  test('missing ember repo: exits 0 by default with a "skip:" warning', () => {
    const nonExistent = resolve(
      tmpdir(),
      `gxt-copy-dist-test-missing-${Date.now()}-${Math.random()}`,
    );
    const result = runScript(nonExistent);

    expect(result.status).toBe(0);
    expect(result.combined).toContain('skip:');
    expect(result.combined).not.toContain('ERROR:');
  });

  test('GXT_COPY_DIST_REQUIRED=1 turns missing pnpm store into a hard failure', () => {
    const nonExistent = resolve(
      tmpdir(),
      `gxt-copy-dist-test-required-${Date.now()}-${Math.random()}`,
    );
    const result = runScript(nonExistent, { GXT_COPY_DIST_REQUIRED: '1' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('ERROR:');
    expect(result.stderr).not.toContain('skip:');
  });

  test('pnpm store exists but @lifeart+gxt not installed: soft-fails by default', () => {
    // Build a minimal fixture: ember-repo/node_modules/.pnpm/ exists but
    // contains no @lifeart+gxt@* dirs.
    const dir = mkdtempSync(join(tmpdir(), 'gxt-copy-dist-empty-pnpm-'));
    try {
      mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true });
      // Drop a sibling entry to prove the readdir filter is what excludes it.
      mkdirSync(join(dir, 'node_modules', '.pnpm', 'some-other-pkg@1.0.0'));

      const result = runScript(dir);
      expect(result.status).toBe(0);
      expect(result.combined).toContain('skip:');
      expect(result.combined).toMatch(/@lifeart\/gxt not installed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('pnpm store has @lifeart+gxt entry but the package dir is missing: soft-fails', () => {
    // The pnpm entry directory exists but the inner
    // node_modules/@lifeart/gxt subdir is missing.
    const dir = mkdtempSync(join(tmpdir(), 'gxt-copy-dist-missing-pkg-'));
    try {
      const pnpmEntry = join(
        dir,
        'node_modules',
        '.pnpm',
        '@lifeart+gxt@0.0.59',
      );
      mkdirSync(pnpmEntry, { recursive: true });
      // Note: we do NOT create node_modules/@lifeart/gxt under the entry.

      const result = runScript(dir);
      expect(result.status).toBe(0);
      expect(result.combined).toContain('skip:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('GXT_COPY_DIST_REQUIRED=1 + missing @lifeart+gxt: hard-fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gxt-copy-dist-required-empty-'));
    try {
      mkdirSync(join(dir, 'node_modules', '.pnpm'), { recursive: true });
      const result = runScript(dir, { GXT_COPY_DIST_REQUIRED: '1' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('ERROR:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-"1" values for GXT_COPY_DIST_REQUIRED do NOT enforce', () => {
    // The script's check is strictly === '1'. Any other truthy-looking
    // string ("true", "yes") must still soft-fail.
    const nonExistent = resolve(
      tmpdir(),
      `gxt-copy-dist-test-true-${Date.now()}-${Math.random()}`,
    );
    const r1 = runScript(nonExistent, { GXT_COPY_DIST_REQUIRED: 'true' });
    expect(r1.status).toBe(0);
    expect(r1.combined).toContain('skip:');

    const r2 = runScript(nonExistent, { GXT_COPY_DIST_REQUIRED: '0' });
    expect(r2.status).toBe(0);
    expect(r2.combined).toContain('skip:');
  });
});
