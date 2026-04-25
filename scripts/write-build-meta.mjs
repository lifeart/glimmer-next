#!/usr/bin/env node
/**
 * Writes dist/.build-meta.json after build-lib.
 *
 * Contents:
 *   - gitHash: current HEAD commit (short)
 *   - gitDirty: true if working tree has uncommitted changes in src/ or plugins/
 *   - buildTime: ISO timestamp of when the build completed
 *   - sourceHash: MD5 of all source file contents (deterministic fingerprint)
 *
 * The Ember app reads this file at Vite startup to detect stale dist copies.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// `import.meta.dirname` only exists on Node 20.11+. Use the
// fileURLToPath form so the script runs on any maintained LTS.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Git info
let gitHash = 'unknown';
let gitDirty = false;
try {
  gitHash = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim();
  const status = execSync('git status --porcelain -- src/ plugins/', { cwd: root, encoding: 'utf8' }).trim();
  gitDirty = status.length > 0;
} catch {
  // Not a git repo or git not available
}

// Collect all source file paths
function collectFiles(dir, extensions) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__test-utils__') continue;
        results.push(...collectFiles(full, extensions));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(full);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

const srcFiles = [
  ...collectFiles(resolve(root, 'src'), ['.ts', '.js', '.gts', '.gjs']),
  ...collectFiles(resolve(root, 'plugins'), ['.ts', '.js']),
].sort();

// Hash file contents (deterministic regardless of mtime)
const hash = createHash('md5');
for (const f of srcFiles) {
  try {
    // Use relative path so hash is machine-independent
    const rel = f.slice(root.length);
    hash.update(rel + '\n');
    hash.update(readFileSync(f));
  } catch {
    // File disappeared between listing and read
  }
}
const sourceHash = hash.digest('hex');

const meta = {
  gitHash,
  gitDirty,
  buildTime: new Date().toISOString(),
  sourceHash,
  sourceFileCount: srcFiles.length,
};

const outPath = resolve(root, 'dist', '.build-meta.json');
writeFileSync(outPath, JSON.stringify(meta, null, 2) + '\n');
console.log(`[build-meta] Wrote ${outPath}`);
console.log(`[build-meta] git: ${gitHash}${gitDirty ? ' (dirty)' : ''}, sources: ${srcFiles.length} files, hash: ${sourceHash.slice(0, 12)}`);
