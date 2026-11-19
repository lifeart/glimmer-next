/**
 * G10 (EMBER_NATIVE): Ember `precompileTemplate(…)` calls from
 * `@ember/template-compilation` compile at BUILD time. The template-string
 * argument becomes a template MAKER the host's runtime `precompileTemplate`
 * calls with the values of the call's `scope` option:
 *   `($__scope) => { const { a } = $__scope; return $_tpl(function () {…}); }`.
 * `strictMode: false` (Ember's default) compiles a LOOSE template (G11 applies
 * under EMBER_LOOSE_COMPONENTS). Off without EMBER_NATIVE (byte-identical),
 * unless the host turns it on for its dialect (the `precompileTemplate`
 * option, which the Ember compat build sets).
 */
import { describe, test, expect } from 'vitest';
import * as main from '../../src/core/index';
import { Preprocessor } from 'content-tag';
import { transform, type TransformResult } from '../test';
import { compiler, mayCallPrecompileTemplate } from '../compiler';
import { compileTemplateSource } from '../runtime-compiler';
import { defaultFlags, type Flags } from '../flags';

const p = new Preprocessor();

const NATIVE: Flags = {
  ...defaultFlags(),
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  TRY_CATCH_ERROR_HANDLING: false,
  ASYNC_COMPILE_TRANSFORMS: false,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_OUTLET: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
  EMBER_LOOSE_COMPONENTS: true,
};

const MODULE = `import { precompileTemplate } from '@ember/template-compilation';
import { tracked } from '@glimmer/tracking';
function array(...list) { return list.map((n) => n * 2); }
class Store { @tracked count = 1; template() { return 'not a template call'; } }
export const Loose = precompileTemplate(\`<h1>{{this.title}}</h1><Counter @n={{1}} />{{format-price 2}}\`);
export const Strict = precompileTemplate('{{#each (array 1 2) as |n|}}[{{n}}]{{/each}}<First />', {
  strictMode: true,
  scope: () => ({ array, First: Store }),
});
export const Renamed = precompileTemplate('{{#let shadow as |x|}}{{x}}{{/let}}', { strictMode: true, scope: () => ({ shadow: array }) });
`;

function precompileOnly(source: string, file = '/app/t.js', flags: Flags = NATIVE): string {
  return (transform(source, file, 'production', false, flags, source, { precompileOnly: true }) as TransformResult)
    .code;
}

/** Evaluate a maker expression with the main entry's exports bound (like the AOT import). */
function evaluateMaker(makerSource: string): (scope?: Record<string, unknown>) => unknown {
  const exported = main as unknown as Record<string, unknown>;
  const names = Object.keys(exported).filter((n) => n.startsWith('$'));
  // eslint-disable-next-line no-new-func
  return new Function(...names, `"use strict"; return ${makerSource};`)(...names.map((n) => exported[n])) as never;
}

describe('G10: precompileTemplate compiles at build time (EMBER_NATIVE)', () => {
  const code = precompileOnly(MODULE);

  test('the template string becomes a maker; the call, its options and the import stay', () => {
    expect(code).toContain("import { precompileTemplate } from '@ember/template-compilation';");
    expect(code).toMatch(/export const Loose = precompileTemplate\(\(\) => \$_tpl\(function \(\) \{/);
    expect(code).toMatch(/export const Strict = precompileTemplate\(\(\$__scope\) => \{\s*const \{ array, First \} = \$__scope;\s*return \$_tpl\(function \(\) \{/);
    expect(code).toContain('strictMode: true');
    expect(code).toMatch(/scope: \(\) => \(\{\s*array,\s*First: Store\s*\}\)/);
    expect(code).not.toContain('<h1>{{this.title}}');
  });

  test('loose by default: free names resolve by name; strict: scope keys are the only lexical names', () => {
    const loose = code.slice(code.indexOf('export const Loose'), code.indexOf('export const Strict'));
    expect(loose).toContain("$_c('counter'");
    expect(loose).toContain('$_looseAppend("format-price", [2], {}, this, 0, false)');
    expect(loose).toContain('$__tag($s, "title")');
    const strict = code.slice(code.indexOf('export const Strict'), code.indexOf('export const Renamed'));
    expect(strict).toContain('$_maybeHelper(array, [1, 2], {}, this, 0)');
    expect(strict).toContain('$_c(First, ');
    expect(strict).not.toContain('$__array');
  });

  test('renamed scope entries bind the template name', () => {
    expect(code).toMatch(/const \{ shadow \} = \$__scope;/);
  });

  test('precompileOnly leaves the rest of the module to the host (decorators, template() methods)', () => {
    expect(code).toMatch(/@tracked\s+count = 1;/);
    expect(code).toContain("return 'not a template call';");
  });

  test('the maker evaluates to a branded template function', () => {
    const start = code.indexOf('precompileTemplate(() =>') + 'precompileTemplate('.length;
    const end = code.indexOf('}));', start) + 2;
    const make = evaluateMaker(code.slice(start, end));
    const tpl = make();
    expect(typeof tpl).toBe('function');
    expect(main.isTemplateFn(tpl)).toBe(true);
  });

  test('the loose template function equals the runtime-compiled loose source (AOT ≡ runtime)', () => {
    const tpl = '<h1>{{this.title}}</h1><Counter @n={{1}} />{{format-price 2}}';
    const runtime = compileTemplateSource(tpl, { flags: NATIVE, strictMode: false });
    expect(runtime.errors).toHaveLength(0);
    const aot = precompileOnly(
      `import { precompileTemplate } from '@ember/template-compilation';\nexport const X = precompileTemplate(${JSON.stringify(tpl)});\n`
    );
    expect(aot).toContain(`precompileTemplate(() => ${runtime.source})`);
  });

  test('only the @ember/template-compilation import is compiled', () => {
    const local = `function precompileTemplate(s) { return s; }\nexport const X = precompileTemplate('<Nope />');\n`;
    expect(precompileOnly(local)).toContain("precompileTemplate('<Nope />')");
    const other = `import { precompileTemplate } from 'somewhere-else';\nexport const X = precompileTemplate('<Nope />');\n`;
    expect(precompileOnly(other)).toContain("precompileTemplate('<Nope />')");
  });

  test('non-static options leave the call to the host (runtime error there)', () => {
    const dynamic = `import { precompileTemplate } from '@ember/template-compilation';\nconst s = () => ({});\nexport const X = precompileTemplate('<Nope />', { scope: s });\n`;
    expect(precompileOnly(dynamic)).toContain("precompileTemplate('<Nope />', {");
  });

  test('a TypeScript module goes to babel as it is (content-tag would drop `implements` commas)', () => {
    const ts = `import { precompileTemplate } from '@ember/template-compilation';
interface A<T> { a(x: T): T }
interface B<T> { b(x: T): T }
class Manager
  implements
    A<string>,
    B<string>
{
  a(x: string): string { return x; }
  b(x: string): string { return x; }
}
export const manager = new Manager();
export const X = precompileTemplate('<p>{{this.x}}</p>', { strictMode: true });
`;
    const out = precompileOnly(ts, '/app/manager.ts');
    expect(out).toMatch(/class Manager\s*\{/);
    expect(out).toContain('precompileTemplate(() => $_tpl(function () {');
  });

  test('a template compile error throws (never a silently skipped module)', () => {
    const broken = `import { precompileTemplate } from '@ember/template-compilation';\nexport const X = precompileTemplate('{{#if}}x');\n`;
    expect(() => precompileOnly(broken)).toThrow();
  });

  test('inside a .gjs module (full transform) precompileTemplate calls compile too', () => {
    const gjs = `import { precompileTemplate } from '@ember/template-compilation';\nexport const X = precompileTemplate('<Foo />');\nexport const Y = <template>y</template>;\n`;
    const out = (
      transform(p.process(gjs, { filename: 'g.gjs' }).code, 'g.gjs', 'production', false, NATIVE, gjs) as TransformResult
    ).code;
    expect(out).toContain("precompileTemplate(() => $_tpl(function () {");
    expect(out).toContain("$_c('foo'");
  });
});

describe('G10 is off without EMBER_NATIVE (byte-identical compat / standalone output)', () => {
  const COMPAT: Flags = { ...defaultFlags(), WITH_EMBER_INTEGRATION: true, ASYNC_COMPILE_TRANSFORMS: false };

  test('the vite plugin skips a precompileTemplate-only script module', () => {
    const plugin = compiler('production', { flags: COMPAT });
    (plugin.config as (c: object, m: object) => unknown)({}, { mode: 'production' });
    const result = (plugin.transform as (code: string, id: string) => unknown)(MODULE, '/app/t.js');
    expect(result).toBeUndefined();
  });

  test('a .gjs module keeps its precompileTemplate string', () => {
    const gjs = `import { precompileTemplate } from '@ember/template-compilation';\nexport const X = precompileTemplate('<Foo />');\nexport const Y = <template>y</template>;\n`;
    const out = (
      transform(p.process(gjs, { filename: 'g.gjs' }).code, 'g.gjs', 'production', false, COMPAT, gjs) as TransformResult
    ).code;
    expect(out).toContain("precompileTemplate('<Foo />')");
  });

  test('the vite plugin compiles the module under EMBER_NATIVE', () => {
    const plugin = compiler('production', { flags: NATIVE });
    (plugin.config as (c: object, m: object) => unknown)({}, { mode: 'production' });
    const result = (plugin.transform as (code: string, id: string) => { code: string })(MODULE, '/app/t.js');
    expect(result.code).toContain('precompileTemplate(() => $_tpl(');
  });

  test('pre-filter', () => {
    expect(mayCallPrecompileTemplate(MODULE)).toBe(true);
    expect(mayCallPrecompileTemplate("import x from 'y'; precompileTemplate('a')")).toBe(false);
  });
});

describe('G10 for the Ember compat dialect (the `precompileTemplate` option)', () => {
  // The flags the Ember compat build compiles its own templates with (those of
  // its runtime compile): no EMBER_NATIVE.
  const COMPAT: Flags = {
    ...defaultFlags(),
    IS_GLIMMER_COMPAT_MODE: true,
    WITH_EMBER_INTEGRATION: true,
    WITH_HELPER_MANAGER: true,
    WITH_MODIFIER_MANAGER: true,
    WITH_CONTEXT_API: true,
    TRY_CATCH_ERROR_HANDLING: false,
    ASYNC_COMPILE_TRANSFORMS: false,
    FORCE_SYNC_LIST: true,
    EMBER_ATTR_CONCAT: true,
    EMBER_IN_ELEMENT: true,
    EMBER_WHITESPACE: true,
  };
  const COMPAT_MODULE = `import { precompileTemplate } from '@ember/template-compilation';
import { on } from '@ember/modifier/on';
const RouteWrapper = {};
export const Link = precompileTemplate(\`<a class="link {{this.class}}" {{on 'click' this.click}}>{{yield}}</a>\`, {
  moduleName: 'link.hbs',
  strictMode: true,
  scope() {
    return { on };
  },
});
export function wrapperTemplate(wrapper) {
  return precompileTemplate('<RouteWrapper @Component={{this.Component}} @outlet={{this.outlet}} />', {
    strictMode: true,
    scope: () => ({ RouteWrapper: wrapper }),
  });
}
export const List = precompileTemplate('<ul>{{#each this.items as |item|}}<li>{{item}}</li>{{/each}}</ul>', {
  strictMode: true,
});
`;
  const compat = (source: string): string =>
    (
      transform(source, '/ember/link.ts', 'production', false, COMPAT, source, {
        precompileOnly: true,
        precompileTemplate: true,
      }) as TransformResult
    ).code;
  const code = compat(COMPAT_MODULE);
  const section = (from: string, to?: string): string =>
    code.slice(code.indexOf(from), to === undefined ? undefined : code.indexOf(to));

  test('the template strings become makers of plain (unbranded) template functions', () => {
    expect(code).toMatch(
      /export const Link = precompileTemplate\(\(\$__scope\) => \{\s*const \{ on \} = \$__scope;\s*return function \(\) \{/,
    );
    expect(code).toMatch(
      /return precompileTemplate\(\(\$__scope\) => \{\s*const \{ RouteWrapper \} = \$__scope;\s*return function \(\) \{/,
    );
    expect(code).toMatch(/export const List = precompileTemplate\(\(\) => function \(\) \{/);
    expect(code).not.toContain('$_tpl');
    expect(code).not.toContain('{{#each this.items');
  });

  test('the options stay, `scope` included, so the host binds the scope values', () => {
    expect(code).toContain("moduleName: 'link.hbs'");
    expect(code).toMatch(/scope\(\) \{\s*return \{\s*on\s*\};\s*\}/);
    expect(code).toMatch(/scope: \(\) => \(\{\s*RouteWrapper: wrapper\s*\}\)/);
  });

  test('the compat flags shape the emission: sync lists, Ember attribute concat, scope components', () => {
    const list = section('export const List');
    expect(list).toContain('$_eachSync(');
    expect(list).not.toMatch(/\$_each\(/);
    expect(section('export const Link', 'export function wrapperTemplate')).toContain('$_qStr(');
    expect(section('export function wrapperTemplate', 'export const List')).toContain(
      '$_c(RouteWrapper, ',
    );
  });

  test('the runtime symbols are imported from the main entry, without the native ones', () => {
    const imported = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@lifeart\/gxt['"]/g)]
      .flatMap((m) => m[1].split(','))
      .map((name) => name.trim());
    expect(imported).toContain('$_tag');
    expect(imported).toContain('$_fin');
    expect(imported).toContain('$_maybeModifier');
    expect(imported).not.toContain('$_tpl');
    expect(imported).not.toContain('$_self');
  });

  test('the maker evaluates to a gxt template function, not a branded one', () => {
    // `List`, the module's last statement: its maker runs up to its options.
    const start = code.indexOf('precompileTemplate(() =>') + 'precompileTemplate('.length;
    const end = code.lastIndexOf(', {');
    const tpl = evaluateMaker(code.slice(start, end))();
    expect(typeof tpl).toBe('function');
    expect(main.isTemplateFn(tpl)).toBe(false);
  });

  test('the template function equals the runtime-compiled one under the same flags (AOT ≡ runtime)', () => {
    const tpl = '<RouteWrapper @Component={{this.Component}} @outlet={{this.outlet}} />';
    const runtime = compileTemplateSource(tpl, {
      flags: COMPAT,
      strictMode: true,
      bindings: new Set(['RouteWrapper']),
    });
    expect(runtime.errors).toHaveLength(0);
    expect(code).toContain(`return ${runtime.source};`);
  });

  test('the vite plugin compiles a precompileTemplate-only script module with the option', () => {
    const plugin = compiler('production', { flags: COMPAT, precompileTemplate: true });
    (plugin.config as (c: object, m: object) => unknown)({}, { mode: 'production' });
    const result = (plugin.transform as (code: string, id: string) => { code: string })(
      COMPAT_MODULE,
      '/ember/link.ts',
    );
    expect(result.code).toMatch(/export const List = precompileTemplate\(\(\) => function \(\) \{/);
  });

  test('`precompileTemplate: false` turns G10 off under EMBER_NATIVE', () => {
    const plugin = compiler('production', { flags: NATIVE, precompileTemplate: false });
    (plugin.config as (c: object, m: object) => unknown)({}, { mode: 'production' });
    const result = (plugin.transform as (code: string, id: string) => unknown)(MODULE, '/app/t.js');
    expect(result).toBeUndefined();
  });
});
