#!/usr/bin/env node
/**
 * Copies GXT dist/ to the Ember app's pnpm store location.
 *
 * Usage: node scripts/copy-dist-to-ember.mjs [ember-repo-path]
 *
 * Default ember-repo-path: /Users/lifeart/Repos/ember.js
 *
 * This finds the @lifeart/gxt package in the pnpm store under the Ember repo
 * and copies all dist files there.
 */

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const emberRepo = process.argv[2] || '/Users/lifeart/Repos/ember.js';

const srcDist = resolve(root, 'dist');

// Find the pnpm store location for @lifeart/gxt
const pnpmBase = resolve(emberRepo, 'node_modules/.pnpm');
if (!existsSync(pnpmBase)) {
  console.error(`[copy-dist] ERROR: pnpm store not found at ${pnpmBase}`);
  process.exit(1);
}

// Find @lifeart+gxt@* directory
const pnpmEntries = readdirSync(pnpmBase).filter(e => e.startsWith('@lifeart+gxt@'));
if (pnpmEntries.length === 0) {
  console.error(`[copy-dist] ERROR: @lifeart/gxt not found in pnpm store at ${pnpmBase}`);
  process.exit(1);
}

const gxtPnpmDir = resolve(pnpmBase, pnpmEntries[0], 'node_modules/@lifeart/gxt');
const destDist = resolve(gxtPnpmDir, 'dist');

if (!existsSync(gxtPnpmDir)) {
  console.error(`[copy-dist] ERROR: GXT package dir not found at ${gxtPnpmDir}`);
  process.exit(1);
}

if (!existsSync(srcDist)) {
  console.error(`[copy-dist] ERROR: Source dist not found at ${srcDist}. Run build-lib first.`);
  process.exit(1);
}

// Copy dist
console.log(`[copy-dist] Copying ${srcDist} -> ${destDist}`);
cpSync(srcDist, destDist, { recursive: true, force: true });

// Also clear Vite cache in the Ember repo so it picks up the new files
const viteCacheDir = resolve(emberRepo, 'node_modules/.vite');
if (existsSync(viteCacheDir)) {
  rmSync(viteCacheDir, { recursive: true, force: true });
  console.log(`[copy-dist] Cleared Vite cache at ${viteCacheDir}`);
}

// Also clear packages/demo vite cache
const demoViteCacheDir = resolve(emberRepo, 'packages/demo/node_modules/.vite');
if (existsSync(demoViteCacheDir)) {
  rmSync(demoViteCacheDir, { recursive: true, force: true });
  console.log(`[copy-dist] Cleared Vite cache at ${demoViteCacheDir}`);
}

console.log(`[copy-dist] Done. GXT dist updated in Ember app.`);
