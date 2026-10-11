/**
 * `compileTemplateSource` (runtime compiler): the AOT-identical source of a
 * runtime-compiled template — the Ember native layer compiles test / runtime
 * templates with the same flag object as its AOT build, and the two must never
 * drift (both use plugins/template-wrapper.ts).
 */
import { describe, test, expect } from 'vitest';
// The main entry first: vite-node populates `export *` namespaces in import
// order, so importing the runtime compiler (which imports src/core/dom
// directly) first would leave the barrel namespace partially populated.
import * as main from '../../src/core/index';
import { Preprocessor } from 'content-tag';
import { compileTemplateSource } from '../runtime-compiler';
import { transform, type TransformResult } from '../test';
import { defaultFlags, type Flags } from '../flags';
import { RECYCLE_SYMBOLS } from '../symbols';
import { templateScopeNames, nativeTemplateSymbols } from '../template-wrapper';

const p = new Preprocessor();

const EMBER_NATIVE_FLAGS: Partial<Flags> = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  TRY_CATCH_ERROR_HANDLING: false,
  ASYNC_COMPILE_TRANSFORMS: false,
  FORCE_SYNC_LIST: true,
  EMBER_ATTR_CONCAT: true,
  EMBER_IN_ELEMENT: true,
  EMBER_TRUSTED_HTML: true,
  EMBER_NATIVE: true,
  EMBER_OUTLET: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};

const CORPUS = [
  '{{concat this.model.first this.model.second}}',
  '{{#let this.foo.bar as |thing tom|}}"{{thing}}" {{tom.name}}{{/let}}',
  '{{#each this.list as |item i|}}{{item.name}}{{i}}{{else}}Empty{{/each}}',
  '{{#if this.c}}T{{else}}F{{/if}}{{if this.c "a" "b"}}',
  '<div class="a {{this.b}}" {{on "click" this.go}}>{{yield this.v}}</div>',
  '{{@model.title}} {{this}} {{outlet}} {{@a-b.c}}',
  '{{{this.html}}}<p ...attributes>{{yield to="inverse"}}</p>',
];

function aotFunction(template: string, flags: Partial<Flags>, mode: 'development' | 'production') {
  const source = `export const Tpl = <template>${template}</template>;\n`;
  const allFlags = { ...defaultFlags(), ...flags, ASYNC_COMPILE_TRANSFORMS: false };
  const code = (
    transform(p.process(source, { filename: 't.gjs' }).code, 't.gjs', mode, false, allFlags, source) as TransformResult
  ).code;
  const branded = flags.EMBER_NATIVE === true;
  const head = branded ? '$_tpl(function Tpl() {' : 'function () {';
  const start = code.indexOf(head);
  const tail = branded ? '\n    })' : '\n    }';
  const end = code.indexOf(tail, start);
  return code.slice(start, end + tail.length);
}

describe('compileTemplateSource ≡ the AOT <template> wrapper', () => {
  for (const mode of ['production', 'development'] as const) {
    test(`Ember native flags (${mode}): identical function text`, () => {
      for (const template of CORPUS) {
        const runtime = compileTemplateSource(template, {
          flags: EMBER_NATIVE_FLAGS,
          templateName: 'Tpl',
          format: mode === 'development',
        });
        expect(runtime.errors).toHaveLength(0);
        expect(runtime.source).toBe(aotFunction(template, EMBER_NATIVE_FLAGS, mode));
      }
    });
  }

  test('flags off: the historic unbranded wrapper, identical to AOT', () => {
    for (const template of CORPUS.slice(0, 4)) {
      const runtime = compileTemplateSource(template, { flags: {} });
      expect(runtime.source.startsWith('function () {')).toBe(true);
      expect(runtime.source).not.toContain('$_self');
      expect(runtime.source).toBe(aotFunction(template, {}, 'production'));
    }
  });

  test('a compile error yields no source', () => {
    const result = compileTemplateSource('{{#if}}x', { flags: EMBER_NATIVE_FLAGS });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.source).toBe('');
  });
});

describe('template scope names (the runtime host binds them from the main entry)', () => {
  test('every name is exported by the main @lifeart/gxt entry (src/core/index)', () => {
    const exported = main as unknown as Record<string, unknown>;
    const missing = templateScopeNames(EMBER_NATIVE_FLAGS).filter((name) => !(name in exported));
    expect(missing).toEqual([]);
  });

  test('the recycle entry points are not main-entry names', () => {
    const names = new Set(templateScopeNames(EMBER_NATIVE_FLAGS));
    for (const name of RECYCLE_SYMBOLS) expect(names.has(name)).toBe(false);
  });

  test('native symbols follow the flags', () => {
    expect(nativeTemplateSymbols({})).toEqual([]);
    expect(nativeTemplateSymbols({ EMBER_NATIVE: true, EMBER_OUTLET: true })).toEqual([
      '$_tpl',
      '$__tag',
      '$_outlet',
    ]);
    expect(nativeTemplateSymbols({ EMBER_PROPERTY_TAGS: true, EMBER_SELF: true })).toEqual([
      '$__tag',
      '$_self',
    ]);
    expect(compileTemplateSource('x', { flags: EMBER_NATIVE_FLAGS }).scopeNames).toContain('$_self');
  });
});
