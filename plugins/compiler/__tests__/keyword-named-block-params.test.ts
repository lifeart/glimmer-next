/**
 * Block params named like Ember keywords or with non-identifier names.
 *
 * Glimmer accepts any block-param name its parser reads, and a block param
 * shadows a keyword of the same name (`{{#let x as |mount|}}{{mount}}` reads the
 * binding). In compat:
 *  - a non-identifier name (`as |-in-element|`, `as |-with-dynamic-vars|`) was
 *    emitted verbatim (`let -in-element = …`, a SyntaxError: the whole module
 *    failed to load); only EMBER_NATIVE escaped it;
 *  - the `mount` / `component` / `input` / `outlet` keyword rewrites ignored the
 *    binding (`{{component}}` rendered nothing, `{{mount}}` an `<ember-mount>`,
 *    `{{input}}` an `<Input>`, `{{outlet}}` the default slot).
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true, WITH_HELPER_MANAGER: true };
const NATIVE = { ...COMPAT, EMBER_NATIVE: true };

const KEYWORDS = ['outlet', 'mount', 'component', 'input'];
const NON_IDENTIFIERS = ['-with-dynamic-vars', '-in-element', 'foo-bar'];

function code(tpl: string, flags: Record<string, boolean>) {
  const result = compile(tpl, { flags } as never);
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('block params named like keywords', () => {
  for (const [label, flags] of [['compat', COMPAT], ['native', NATIVE]] as const) {
    for (const name of KEYWORDS) {
      test(`${label}: {{${name}}} reads a block param named ${name}`, () => {
        const c = code(`{{#let this.v as |${name}|}}{{${name}}}{{/let}}`, flags);
        expect(c).toContain(`let ${name} = () => this.v`);
        expect(c).toContain(`() => ${name}()`);
        expect(c).not.toContain('ember-mount');
        expect(c).not.toContain("'Input'");
        expect(c).not.toContain('$_slot(');
      });
    }

    for (const name of NON_IDENTIFIERS) {
      test(`${label}: a block param named ${name} is a valid identifier`, () => {
        const c = code(`{{#let this.v as |${name}|}}[{{${name}}}]{{/let}}`, flags);
        expect(() => new Function(`return ${c};`)).not.toThrow();
        expect(c).toMatch(/let (__bp_[\w$]+) = \(\) => this\.v; return \["\[", \(\) => \1\(\), "\]"\]/);
      });
    }
  }

  test('standalone: the keyword rewrites are unchanged', () => {
    const c = code('{{#let this.v as |input|}}{{input}}{{/let}}', { IS_GLIMMER_COMPAT_MODE: true });
    expect(c).toContain("'Input'");
  });

  test('without a binding the keywords keep their meaning', () => {
    expect(code('{{mount "blog"}}', COMPAT)).toContain('ember-mount');
    expect(code('{{input value=this.v}}', COMPAT)).toContain("'Input'");
  });
});
