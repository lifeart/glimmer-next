/**
 * The published types must stand alone.
 *
 * For every `exports[*].types` entry, this walks the `.d.ts` import closure
 * inside the package and checks two things against what `npm pack` would
 * actually ship:
 *
 * - every relative file the closure reaches is in the tarball (the
 *   `./compiler` / `./runtime-compiler` entries once pointed at
 *   `dist/plugins/**` files that `files` did not pack);
 * - every bare package the closure imports is one a consumer gets: a runtime
 *   `dependency` that ships its own types (`@babel/core` does not), or the
 *   host a build-tool entry runs in (`vite` for the vite plugin).
 *   `@glint/template` is only a devDependency, so it is allowed only in the
 *   opt-in `./glint` entry.
 *
 * It needs the built `dist/`, like the existence half of
 * package-json-contract.test.ts.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const PKG = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'),
);
const DIST_BUILT = existsSync(resolve(REPO_ROOT, 'dist', 'index.d.ts'));

// Bare packages an entry's types may import beyond `dependencies`.
const ENTRY_HOSTS: Record<string, string[]> = {
  './compiler': ['vite'],
  './glint': ['@glint/template'],
};

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\/\/\/\s*<reference\s+path=)['"]([^'"]+)['"]/g;

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/(?!\/).*$/gm, '');
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    base.replace(/\.(ts|js|mts|mjs)$/, '.d.ts'),
    `${base}.d.ts`,
    resolve(base, 'index.d.ts'),
  ];
  for (const candidate of candidates) {
    if (candidate.endsWith('.d.ts') && existsSync(candidate)) return candidate;
  }
  return null;
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function typesClosure(entry: string) {
  const files = new Set<string>();
  const bare = new Set<string>();
  const unresolved: string[] = [];
  const queue = [resolve(REPO_ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(SPECIFIER)) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target) queue.push(target);
        else unresolved.push(`${relative(REPO_ROOT, file)} -> ${spec}`);
      } else if (!spec.startsWith('node:')) {
        bare.add(packageName(spec));
      }
    }
  }
  return { files, bare, unresolved };
}

function shipsOwnTypes(name: string): boolean {
  const dir = resolve(REPO_ROOT, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));
  if (pkg.types || pkg.typings) return true;
  const root = pkg.exports?.['.'] ?? pkg.exports;
  if (
    root &&
    typeof root === 'object' &&
    JSON.stringify(root).includes('"types"')
  ) {
    return true;
  }
  return existsSync(resolve(dir, 'index.d.ts'));
}

function packedFiles(): Set<string> {
  const out = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const [report] = JSON.parse(out) as [{ files: { path: string }[] }];
  return new Set(report.files.map((f) => f.path));
}

describe.runIf(DIST_BUILT)('published types are self-contained', () => {
  const entries = Object.entries(PKG.exports as Record<string, any>)
    .filter(([, v]) => v && typeof v.types === 'string')
    .map(([key, v]) => [key, v.types as string] as const);
  const deps = new Set(Object.keys(PKG.dependencies ?? {}));
  const packed = packedFiles();

  test('the opt-in ./glint entry exists', () => {
    expect(entries.map(([key]) => key)).toContain('./glint');
  });

  test.each(entries)(
    '%s: every file its types reach is packed',
    (_key, types) => {
      const { files, unresolved } = typesClosure(types);
      expect(unresolved).toEqual([]);
      const missing = [...files]
        .map((f) => relative(REPO_ROOT, f))
        .filter((f) => !packed.has(f));
      expect(missing).toEqual([]);
    },
  );

  test.each(entries)(
    '%s: its types import only packages a consumer has',
    (key, types) => {
      const hosts = ENTRY_HOSTS[key] ?? [];
      const { bare } = typesClosure(types);
      const missing = [...bare].filter(
        (name) =>
          !hosts.includes(name) && !(deps.has(name) && shipsOwnTypes(name)),
      );
      expect(missing).toEqual([]);
    },
  );

  test('@glint/template is imported only by the ./glint entry', () => {
    for (const [key, types] of entries) {
      const { bare } = typesClosure(types);
      expect(bare.has('@glint/template'), key).toBe(key === './glint');
    }
  });
});
