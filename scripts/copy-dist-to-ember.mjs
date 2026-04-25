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

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const emberRepo = process.argv[2] || '/Users/lifeart/Repos/ember.js';
const required = process.env.GXT_COPY_DIST_REQUIRED === '1';

function softFail(message) {
  if (required) {
    console.error(`[copy-dist] ERROR: ${message}`);
    process.exit(1);
  }
  console.warn(`[copy-dist] skip: ${message}`);
  process.exit(0);
}

const srcDist = resolve(root, 'dist');
if (!existsSync(srcDist)) {
  softFail(`source dist not found at ${srcDist} (did build-lib run?)`);
}

const pnpmBase = resolve(emberRepo, 'node_modules/.pnpm');
if (!existsSync(pnpmBase)) {
  softFail(`pnpm store not found at ${pnpmBase} (set GXT_COPY_DIST_REQUIRED=1 to enforce)`);
}

const pnpmEntries = readdirSync(pnpmBase).filter((e) => e.startsWith('@lifeart+gxt@'));
if (pnpmEntries.length === 0) {
  softFail(`@lifeart/gxt not installed in ${pnpmBase}`);
}

const gxtPnpmDir = resolve(pnpmBase, pnpmEntries[0], 'node_modules/@lifeart/gxt');
const destDist = resolve(gxtPnpmDir, 'dist');

if (!existsSync(gxtPnpmDir)) {
  softFail(`GXT package dir not found at ${gxtPnpmDir}`);
}

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
