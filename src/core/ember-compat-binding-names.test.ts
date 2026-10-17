/**
 * A template name that is not a JS identifier (a hyphenated name such as
 * `each-in`, or a reserved word such as `debugger` / `let` / `yield`) compiles
 * to valid JavaScript, wherever it is bound:
 *   - a lexical (caller-provided) binding — a strict-mode local, a scope value
 *     — is declared and referenced under its escaped identifier
 *     (`escapeBindingName`, as block params already are): `some-helper` is
 *     `__bp_some$2d$helper`, `debugger` is `__bp_debugger`;
 *   - a free name read from `this` in a loose template (`{{some-helper each-in}}`)
 *     is read with a computed member (`this["each-in"]`).
 * The names were emitted verbatim (`$_maybeHelper(some-helper, [() => debugger])`,
 * `this.each-in`), so the template function could not be created (a
 * SyntaxError), or read the wrong thing (`this.in-element` is
 * `this.in - element`). A plain identifier is emitted as before.
 */
import { describe, test, expect } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { COMPAT_FLAGS, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import type { CompatTemplate } from './__test-utils__/ember-compat';
import * as main from './index';
import { compileTemplateSource, compileTemplate } from '../../plugins/runtime-compiler';
import { compile } from '../../plugins/compiler/compile';
import { escapeBindingName } from '../../plugins/compiler/utils/js-utils';

const KEYWORDS = ['debugger', 'each-in', 'if', 'in-element', 'let', 'yield'];

function source(tpl: string, bindings: string[], flags: Record<string, boolean> = COMPAT_FLAGS) {
  const result = compileTemplateSource(tpl, { flags, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result;
}

// The template function, with each binding declared under its escaped name.
function compileWith(
  tpl: string,
  bindings: Record<string, unknown>,
  flags: Record<string, boolean> = COMPAT_FLAGS,
): CompatTemplate {
  const { source: code, scopeNames } = source(tpl, Object.keys(bindings), flags);
  const exported = main as unknown as Record<string, unknown>;
  const names = Object.keys(bindings);
  // eslint-disable-next-line no-new-func
  return new Function(...scopeNames, ...names.map(escapeBindingName), `"use strict"; return ${code};`)(
    ...scopeNames.map((name) => exported[name]),
    ...names.map((name) => bindings[name]),
  ) as CompatTemplate;
}

function isValidJs(tpl: string, bindings: string[], flags?: Record<string, boolean>): true {
  const { source: code, scopeNames } = source(tpl, bindings, flags);
  // eslint-disable-next-line no-new-func
  new Function(...scopeNames, ...bindings.map(escapeBindingName), `"use strict"; return ${code};`);
  return true;
}

describe('binding names that are not JS identifiers: compiler', () => {
  for (const keyword of KEYWORDS) {
    test(`a lexical binding named \`${keyword}\` is a value`, () => {
      const tpl = `{{some-helper ${keyword}}}`;
      expect(isValidJs(tpl, ['some-helper', keyword])).toBe(true);
      const { source: code } = source(tpl, ['some-helper', keyword]);
      expect(code).toContain(`$_maybeHelper(__bp_some$2d$helper, [() => ${escapeBindingName(keyword)}]`);
    });

    test(`a free name \`${keyword}\` in a loose template is read from this`, () => {
      expect(isValidJs(`{{some-helper ${keyword}}}`, [])).toBe(true);
    });

    test(`standalone: a lexical binding named \`${keyword}\` compiles`, () => {
      expect(isValidJs(`{{some-helper ${keyword}}}`, ['some-helper', keyword], {})).toBe(true);
    });
  }

  test('a hyphenated free name is a computed member of this', () => {
    expect(source('{{some-helper each-in}}', ['some-helper']).source).toContain(
      '() => this["each-in"]',
    );
    expect(source('{{some-helper a.b-c}}', ['some-helper']).source).toContain(
      '() => this.a["b-c"]',
    );
  });

  test('a block param of a named block of a loose component compiles', () => {
    expect(
      isValidJs(
        '<SomeComponent><:main as |each-in|>{{some-helper each-in}}</:main></SomeComponent>',
        [],
      ),
    ).toBe(true);
  });

  test('a lexical binding used as a modifier or a component', () => {
    expect(isValidJs('<div {{my-mod 1}}></div>', ['my-mod'])).toBe(true);
    expect(source('<div {{my-mod 1}}></div>', ['my-mod']).source).toContain(
      '$_maybeModifier(__bp_my$2d$mod,',
    );
  });

  test('a plain identifier binding is emitted as before', () => {
    const { source: code } = source('{{foo bar}}{{this.x-y}}', ['foo', 'bar']);
    expect(code).toContain('$_maybeHelper(foo, [() => bar], {})');
    expect(code).toContain('this["x-y"]');
  });

  test('the emission report names the bindings as the template does', () => {
    const result = compile('{{some-helper debugger}}{{foo}}', {
      bindings: new Set(['some-helper', 'debugger', 'foo']),
      flags: COMPAT_FLAGS,
    });
    expect([...result.referencedBindings].sort()).toEqual(['debugger', 'foo', 'some-helper']);
  });

  test('the runtime compiler declares scope values under their escaped names', () => {
    for (const keyword of KEYWORDS) {
      const result = compileTemplate(`{{some-helper ${keyword}}}`, {
        bindings: new Set(['some-helper', keyword]),
        scopeValues: { 'some-helper': (value: unknown) => value, [keyword]: 1 },
        flags: COMPAT_FLAGS,
      });
      expect(result.errors).toHaveLength(0);
      expect(typeof result.templateFn).toBe('function');
    }
  });
});

describe('binding names that are not JS identifiers: rendering', () => {
  const compat = useEmberCompatRuntime();
  const wrap = (value: unknown) => `[${String(value)}]`;

  test('a lexical binding named like a keyword', () => {
    compat.render(
      compileWith('{{some-helper debugger}}|{{some-helper each-in}}|{{some-helper yield}}', {
        'some-helper': wrap,
        debugger: 'd',
        'each-in': 'e',
        yield: 'y',
      }),
    );
    expect(compat.fixture.container.textContent).toBe('[d]|[e]|[y]');
  });

  test('a hyphenated free name of a loose template', () => {
    compat.render(
      compileWith('{{some-helper each-in}}|{{some-helper in-element}}', { 'some-helper': wrap }),
      { 'each-in': 'e', 'in-element': 'i' },
    );
    expect(compat.fixture.container.textContent).toBe('[e]|[i]');
  });
});
