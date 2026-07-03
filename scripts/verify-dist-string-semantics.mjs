#!/usr/bin/env node
/**
 * Dist-behavior regression guard for `String(v)` coercion semantics.
 *
 * WHY THIS EXISTS (and why a normal vitest test can't replace it):
 * vitest runs against SOURCE, where `String(v)` is `String(v)`. The bug this
 * guards lives only in the PRODUCED bundle: terser's `compress.unsafe` rewrites
 * `String(v)` → `v + ""`, which silently changes semantics —
 *
 *   - `String(sym)`  stringifies a Symbol → "Symbol(desc)"
 *     `sym + ""`     THROWS a TypeError.
 *   - `String(obj)`  uses the STRING hint (obj.toString → "[object Object]")
 *     `obj + ""`     uses the DEFAULT hint (obj.valueOf wins) → wrong string.
 *
 * The runtime relies on `String()` semantics in load-bearing coercion sites
 * (quoted-attr concat `$_qStr`, text-node normalization, list-key derivation).
 * This script builds the production lib (so terser actually runs) and asserts
 * the SHIPPED `$_qStr` keeps `String()` semantics. If someone re-enables
 * `unsafe` in vite.config.mts, this fails.
 *
 * CI HOOK: run after a production lib build. Add to the pipeline as
 *   node scripts/verify-dist-string-semantics.mjs
 * (package.json exposes it as `pnpm run test:dist-semantics`). It is cheap:
 * it reuses an existing production dist when present, else builds one.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = join(root, 'dist');
const indexChunk = join(distDir, 'gxt.index.es.js');

/**
 * A production (terser) build is required — a `--mode development` build is not
 * minified, so terser never runs and the guard would be meaningless. Build a
 * fresh prod lib unless SKIP_BUILD=1 (fast local re-runs against existing dist).
 */
function ensureProdDist() {
  if (process.env.SKIP_BUILD === '1' && existsSync(indexChunk)) {
    log('SKIP_BUILD=1 — asserting against existing dist/');
    return;
  }
  log('building production lib (vite build -- --lib) ...');
  execFileSync(
    join(root, 'node_modules', '.bin', 'vite'),
    ['build', '--', '--lib'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, npm_lifecycle_script: 'vite build -- --lib' },
    },
  );
}

function log(msg) {
  console.log(`[verify-dist-string-semantics] ${msg}`);
}

const failures = [];
function assert(name, actual, expected) {
  const ok = actual === expected;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)}` +
      (ok ? '' : ` (expected ${JSON.stringify(expected)})`),
  );
  if (!ok) failures.push(name);
}

async function main() {
  ensureProdDist();

  if (!existsSync(indexChunk)) {
    console.error(`[verify-dist-string-semantics] missing ${indexChunk}`);
    process.exit(1);
  }

  // 1) BEHAVIORAL (definitive): import the shipped $_qStr and exercise it.
  const { $_qStr } = await import(pathToFileURL(indexChunk).href);
  if (typeof $_qStr !== 'function') {
    console.error('[verify-dist-string-semantics] $_qStr not exported by dist');
    process.exit(1);
  }

  log('behavioral assertions against shipped $_qStr:');
  // valueOf-bearing object: String() uses the STRING hint (toString wins) →
  // "[object Object]". The `v + ""` rewrite uses the DEFAULT hint (valueOf) → "VAL".
  assert(
    '$_qStr([{valueOf:()=>"VAL"}])',
    $_qStr([{ valueOf: () => 'VAL' }]),
    '[object Object]',
  );
  // Symbol part: String() stringifies; `sym + ""` throws (caught → '').
  assert('$_qStr([Symbol("hi")])', $_qStr([Symbol('hi')]), 'Symbol(hi)');
  // Sanity: ordinary parts still concat, nullish-only → null (attr removed).
  assert('$_qStr(["a",1,"b"])', $_qStr(['a', 1, 'b']), 'a1b');
  assert('$_qStr([null])', $_qStr([null]), null);

  // 2) STATIC signature guard (zero-false-positive fingerprint): a coerced
  // `String()` inside the normalizer's try/catch minifies to `+""}catch`.
  // No legitimate source produces that byte sequence, so its presence in ANY
  // dist chunk means `unsafe` (or an equivalent rewrite) is back.
  log('static signature scan of dist chunks:');
  const chunks = readdirSync(distDir).filter((f) => f.endsWith('.js'));
  let signatureHits = 0;
  for (const f of chunks) {
    const src = readFileSync(join(distDir, f), 'utf8');
    if (/\+""\}\s*catch/.test(src)) {
      signatureHits++;
      console.log(`  FAIL  ${f} contains the '+""}catch' unsafe-rewrite fingerprint`);
      failures.push(`static:${f}`);
    }
  }
  if (signatureHits === 0) {
    console.log(`  PASS  no '+""}catch' fingerprint in ${chunks.length} chunks`);
  }

  if (failures.length) {
    console.error(
      `\n[verify-dist-string-semantics] ${failures.length} failure(s): ` +
        failures.join(', ') +
        `\n  => terser is corrupting String() coercion. Check compress.unsafe ` +
        `in vite.config.mts (must stay OFF).`,
    );
    process.exit(1);
  }
  log('OK — shipped String() coercion semantics are intact.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
