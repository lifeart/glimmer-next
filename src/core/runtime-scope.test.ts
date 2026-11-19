/**
 * `@lifeart/gxt/runtime-scope`: the runtime compiler's symbol table and
 * `setupGlobalScope`, from a module that imports no compiler, so that a host
 * which only evaluates compiled templates against the globals ships none.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as scope from './runtime-scope';
import * as runtimeCompiler from '../../plugins/runtime-compiler';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('@lifeart/gxt/runtime-scope', () => {
  test('the runtime compiler re-exports the same symbol table and setup', () => {
    expect(runtimeCompiler.GXT_RUNTIME_SYMBOLS).toBe(scope.GXT_RUNTIME_SYMBOLS);
    expect(runtimeCompiler.setupGlobalScope).toBe(scope.setupGlobalScope);
    expect(runtimeCompiler.isGlobalScopeReady).toBe(scope.isGlobalScopeReady);
  });

  test('it imports only runtime modules of src/core, no compiler', () => {
    const source = readFileSync(resolve(HERE, 'runtime-scope.ts'), 'utf8');
    // Each import statement's specifier (comments may name other modules).
    const specifiers = [...source.matchAll(/^import\s[\s\S]*?\bfrom\s+'([^']+)';/gm)].map(
      (m) => m[1],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier.startsWith('./'), specifier).toBe(true);
      expect(resolve(HERE, specifier).startsWith(HERE), specifier).toBe(true);
    }
  });

  test('the symbol table holds the item reference key and the outlet keyword', () => {
    expect(typeof scope.GXT_RUNTIME_SYMBOLS.$_itemRefKey).toBe('function');
    expect(typeof scope.GXT_RUNTIME_SYMBOLS.$_outlet).toBe('function');
    expect(typeof scope.GXT_RUNTIME_SYMBOLS.$_tag).toBe('function');
  });
});
