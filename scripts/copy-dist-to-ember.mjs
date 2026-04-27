#!/usr/bin/env node
/**
 * Copies GXT dist/ to the Ember app's pnpm store location.
 *
 * Usage: node scripts/copy-dist-to-ember.mjs [ember-repo-path]
 *
 * Default ember-repo-path: /Users/lifeart/Repos/ember.js
 *
 * Wired as `postbuild-lib` so an iterative `pnpm build-lib` instantly
 * shows up in the local Ember demo. Designed to be a *best-effort*
 * dev convenience: when the target Ember repo or its pnpm store does
 * not exist, this script logs a hint and exits 0 so `pnpm publish`
 * (which runs `prepublishOnly` -> `build-lib`) on CI / a clean machine
 * does not abort.
 *
 * To turn the misses back into hard errors (e.g. when you really do
 * expect the copy to land), set GXT_COPY_DIST_REQUIRED=1.
 */

import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `import.meta.dirname` only exists on Node 20.11+. Use the
// fileURLToPath form so the script runs on any maintained LTS.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const emberRepo = process.argv[2] || '/Users/lifeart/Repos/ember.js';
const required = process.env.GXT_COPY_DIST_REQUIRED === '1';

// Read our own version so we copy into the matching pnpm store entry.
// Without this we'd alphabetically pick the lowest installed version
// (e.g. 0.0.53) and stamp the new dist there while the consumer is on
// 0.0.60 — silent staleness.
let ownVersion = null;
try {
  ownVersion = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
} catch {
  // fall through; we'll pick the highest installed entry instead
}

function softFail(message) {
  if (required) {
    console.error(`[copy-dist] ERROR: ${message}`);
    process.exit(1);
  }
  console.warn(`[copy-dist] skip: ${message}`);
  process.exit(0);
}

// Order of preconditions, weakest target first, so the soft-fail message
// names the *outermost* missing piece. CI runs vitest without `build-lib`,
// so `dist/` is absent there too; we still want the message to read as
// "@lifeart/gxt not installed" when the pnpm store is empty (the more
// useful signal), not "source dist not found". See PR #212.
const pnpmBase = resolve(emberRepo, 'node_modules/.pnpm');
if (!existsSync(pnpmBase)) {
  softFail(`pnpm store not found at ${pnpmBase} (set GXT_COPY_DIST_REQUIRED=1 to enforce)`);
}

const pnpmEntries = readdirSync(pnpmBase).filter((e) => e.startsWith('@lifeart+gxt@'));
if (pnpmEntries.length === 0) {
  softFail(`@lifeart/gxt not installed in ${pnpmBase}`);
}

// Prefer the entry whose version matches glimmer-next's package.json. If
// that's missing (e.g. consumer is on a different version, or version
// read failed), fall back to the highest semver-sorted entry so a
// `pnpm build-lib` still produces a useful update.
function semverCompareDesc(a, b) {
  const av = a.replace('@lifeart+gxt@', '').split('.').map(Number);
  const bv = b.replace('@lifeart+gxt@', '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((bv[i] || 0) !== (av[i] || 0)) return (bv[i] || 0) - (av[i] || 0);
  }
  return 0;
}
const expected = ownVersion ? `@lifeart+gxt@${ownVersion}` : null;
const matched = expected && pnpmEntries.includes(expected) ? expected : null;
const fallback = [...pnpmEntries].sort(semverCompareDesc)[0];
const targetEntry = matched || fallback;
if (!matched && expected) {
  console.warn(
    `[copy-dist] note: pnpm store has no entry for ${expected}; ` +
      `using ${targetEntry} (highest installed). The consumer may need ` +
      `a fresh \`pnpm install\` after this build.`
  );
}

const gxtPnpmDir = resolve(pnpmBase, targetEntry, 'node_modules/@lifeart/gxt');

if (!existsSync(gxtPnpmDir)) {
  softFail(`GXT package dir not found at ${gxtPnpmDir}`);
}

// Now that the destination is confirmed, validate the source. This check
// is last because on CI the dist/ build step is gated separately — bailing
// here is the right semantics only once we know the user actually has a
// place to copy *to*.
const srcDist = resolve(root, 'dist');
if (!existsSync(srcDist)) {
  softFail(`source dist not found at ${srcDist} (did build-lib run?)`);
}

const destDist = resolve(gxtPnpmDir, 'dist');

console.log(`[copy-dist] Copying ${srcDist} -> ${destDist}`);
cpSync(srcDist, destDist, { recursive: true, force: true });

const viteCacheDir = resolve(emberRepo, 'node_modules/.vite');
if (existsSync(viteCacheDir)) {
  rmSync(viteCacheDir, { recursive: true, force: true });
  console.log(`[copy-dist] Cleared Vite cache at ${viteCacheDir}`);
}

const demoViteCacheDir = resolve(emberRepo, 'packages/demo/node_modules/.vite');
if (existsSync(demoViteCacheDir)) {
  rmSync(demoViteCacheDir, { recursive: true, force: true });
  console.log(`[copy-dist] Cleared Vite cache at ${demoViteCacheDir}`);
}

console.log(`[copy-dist] Done. GXT dist updated in Ember app.`);
