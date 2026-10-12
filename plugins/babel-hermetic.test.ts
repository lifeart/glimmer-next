/**
 * G1 — the template-tag transform's babel pass is hermetic.
 *
 * `transform()` (plugins/test.ts) runs babel only to strip TypeScript, lower
 * decorators and let `processTemplate` read each `<template>`'s lexical scope.
 * Two host-environment leaks used to break that:
 *
 *  1. Host babel config inheritance. Without `configFile: false` /
 *     `babelrc: false`, babel loaded the host's `babel.config.*` / `.babelrc*`
 *     from `process.cwd()`. A host `@babel/plugin-transform-typescript`
 *     (default `onlyRemoveTypeImports: false`) elides every import referenced
 *     only inside a `<template>` BEFORE `processTemplate` reads the scope, so
 *     `<Counter />` silently degraded from `$_c(Counter, …)` to a by-name
 *     `$_tag('Counter', …)` lookup and the import vanished.
 *  2. Preset/plugin resolution from cwd. `@babel/preset-typescript` and
 *     `decorator-transforms` were named as bare strings, which babel resolves
 *     relative to `process.cwd()` — it only worked when a package-manager shim
 *     happened to put gxt's dependencies on NODE_PATH.
 *
 * Both are exercised through the real `transform()` with `process.cwd()`
 * pointed at a throwaway project directory (babel derives its default `cwd` /
 * `root` — and therefore config lookup and bare-name resolution — from
 * `path.resolve('.')`, i.e. `process.cwd()`).
 */
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { transform, type TransformResult } from './test';
import { defaultFlags } from './flags';

const syncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false };
const asyncFlags = { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: true };

const nodeRequire = createRequire(import.meta.url);

// A host plugin that behaves like `@babel/plugin-transform-typescript` with
// `onlyRemoveTypeImports: false` (drops imports with no JS references), plus
// a sentinel statement so the test can tell whether ANY host plugin ran.
const HOST_PLUGIN = `
module.exports = function hostElideUnreferencedImports({ types: t }) {
  return {
    name: 'host-elide-unreferenced-imports',
    visitor: {
      Program: {
        enter(path) {
          for (const stmt of path.get('body')) {
            if (!stmt.isImportDeclaration() || stmt.node.specifiers.length === 0) continue;
            const unreferenced = stmt.node.specifiers.every((s) => {
              const b = path.scope.getBinding(s.local.name);
              return !b || b.referencePaths.length === 0;
            });
            if (unreferenced) stmt.remove();
          }
        },
        exit(path) {
          path.pushContainer('body', t.expressionStatement(
            t.assignmentExpression('=', t.identifier('globalThis.__HOST_BABEL_RAN__'), t.numericLiteral(1))
          ));
        },
      },
    },
  };
};
`;

const GJS_SOURCE = `import Counter from './counter.gjs';
import formatPrice from './format-price.js';

<template>
  <Counter @label={{formatPrice 1}} />
</template>
`;

const GTS_SOURCE = `import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import ItemList from './item-list.gts';

export default class Counter extends Component {
  @tracked count: number = 0;
  <template><ItemList @count={{this.count}} /></template>
}
`;

/**
 * Run `fn` with CJS NODE_PATH lookup disabled, so a package-manager shim
 * (pnpm's `.bin/*` exports NODE_PATH=…/.pnpm/node_modules) cannot make a bare
 * `@babel/preset-typescript` resolvable from an unrelated cwd and hide a
 * regression. `Module._initPaths()` recomputes the global lookup paths from
 * the env; it is restored afterwards.
 */
async function withoutNodePath<T>(fn: () => Promise<T>): Promise<T> {
  const Module = nodeRequire('module') as { _initPaths?: () => void };
  const saved = process.env.NODE_PATH;
  delete process.env.NODE_PATH;
  Module._initPaths?.();
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = saved;
    Module._initPaths?.();
  }
}

async function transformWithCwd(
  cwd: string,
  source: string,
  fileName: string,
  flags: ReturnType<typeof defaultFlags>,
): Promise<TransformResult> {
  const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
  try {
    return await withoutNodePath(async () => await transform(source, fileName, 'development', false, flags));
  } finally {
    spy.mockRestore();
  }
}

describe('G1: transform() babel pass is hermetic', () => {
  let hostProject: string;
  let emptyProject: string;

  beforeAll(() => {
    // realpath: macOS tmpdir is a /var -> /private/var symlink.
    const base = realpathSync(tmpdir());

    // A host project WITH its own babel config (root config + .babelrc) whose
    // plugin elides template-only imports and leaves a sentinel.
    hostProject = mkdtempSync(join(base, 'gxt-g1-host-'));
    writeFileSync(join(hostProject, 'package.json'), JSON.stringify({ name: 'host-app', private: true }));
    writeFileSync(join(hostProject, 'host-plugin.cjs'), HOST_PLUGIN);
    writeFileSync(
      join(hostProject, 'babel.config.cjs'),
      `module.exports = { plugins: [require.resolve('./host-plugin.cjs')] };\n`,
    );
    mkdirSync(join(hostProject, 'app'));
    writeFileSync(
      join(hostProject, 'app', '.babelrc.json'),
      JSON.stringify({ plugins: ['../host-plugin.cjs'] }),
    );

    // A project with NO node_modules: nothing gxt needs is resolvable from here.
    emptyProject = mkdtempSync(join(base, 'gxt-g1-empty-'));
    writeFileSync(join(emptyProject, 'package.json'), JSON.stringify({ name: 'empty-app', private: true }));
  });

  afterAll(() => {
    rmSync(hostProject, { recursive: true, force: true });
    rmSync(emptyProject, { recursive: true, force: true });
  });

  test('negative control: bare preset names are NOT resolvable from the empty project', async () => {
    await withoutNodePath(async () => {
      const fromEmpty = createRequire(join(emptyProject, 'noop.js'));
      expect(() => fromEmpty.resolve('@babel/preset-typescript')).toThrow();
      expect(() => fromEmpty.resolve('decorator-transforms')).toThrow();
    });
  });

  for (const [mode, flags] of [['sync', syncFlags], ['async', asyncFlags]] as const) {
    test(`[${mode}] a host babel config cannot elide <template>-only imports`, async () => {
      const result = await transformWithCwd(hostProject, GJS_SOURCE, join(hostProject, 'app', 'index.gjs'), flags);
      // No host plugin ran (neither babel.config.cjs nor app/.babelrc.json).
      expect(result.code).not.toContain('__HOST_BABEL_RAN__');
      // Template-only imports survive...
      expect(result.code).toMatch(/import Counter from ['"]\.\/counter\.gjs['"]/);
      expect(result.code).toMatch(/import formatPrice from ['"]\.\/format-price\.js['"]/);
      // ...and stay LEXICAL in the emitted template (not by-name string lookups).
      expect(result.code).toMatch(/\$_c\(\s*Counter\b/);
      expect(result.code).not.toMatch(/\$_tag\(\s*['"]Counter['"]/);
      expect(result.code).toMatch(/\$_maybeHelper\(\s*formatPrice\b|\bformatPrice\(/);
    });

    test(`[${mode}] preset/plugin resolve from gxt's own location, not process.cwd()`, async () => {
      // .gts exercises both @babel/preset-typescript (type annotation) and
      // decorator-transforms (@tracked) — the two string-named babel deps.
      const result = await transformWithCwd(emptyProject, GTS_SOURCE, join(emptyProject, 'counter.gts'), flags);
      expect(result.code).not.toContain(': number');
      expect(result.code).not.toMatch(/^\s*@tracked/m);
      expect(result.code).toContain('dt7948'); // decorator-transforms "globals" runtime
      expect(result.code).toMatch(/import ItemList from ['"]\.\/item-list\.gts['"]/);
      expect(result.code).toMatch(/\$_c\(\s*ItemList\b/);
    });
  }
});
