/**
 * The Ember dialect (WITH_EMBER_INTEGRATION) installs the item reference
 * follow runtime from the template that needs it, like a standalone template:
 * a list keyed by position (`key="@index"`, `@key`) and a native `{{#each-in}}`
 * pass their key through `$_itemRefKey(…)` and set `CompileResult.usedItemRefs`
 * (the AOT module assembler then imports `@lifeart/gxt/item-references`). An
 * Ember host used to install the runtime for every app, whether or not a
 * template keyed a list by position; a plain keyed list and a template with no
 * list do not carry it.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
} as const;

const NATIVE = {
  ...COMPAT,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
} as const;

function compiled(tpl: string, flags: object, bindings: string[] = []) {
  const result = compile(tpl, { flags: flags as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return { usedItemRefs: result.usedItemRefs, code: result.code.split('/*#__PURE__*/').join('') };
}

describe('Ember dialect: the item reference runtime is installed by the template that needs it', () => {
  test('key="@index" passes the key through $_itemRefKey and sets usedItemRefs (compat flags)', () => {
    const { usedItemRefs, code } = compiled(
      '{{#each this.items key="@index" as |item index|}}<li>{{index}}: {{item}}</li>{{/each}}',
      COMPAT,
    );
    expect(usedItemRefs).toBe(true);
    expect(code).toContain('$_itemRefKey("@index")');
  });

  test('key="@index" does the same under the native flags', () => {
    const { usedItemRefs, code } = compiled(
      '{{#each this.items key="@index" as |item|}}<li>{{item}}</li>{{/each}}',
      NATIVE,
    );
    expect(usedItemRefs).toBe(true);
    expect(code).toContain('$_itemRefKey("@index")');
  });

  test('@key is a positional key too', () => {
    const { usedItemRefs, code } = compiled(
      '{{#each this.items key="@key" as |item|}}<li>{{item}}</li>{{/each}}',
      NATIVE,
    );
    expect(usedItemRefs).toBe(true);
    expect(code).toContain('$_itemRefKey("@index")');
    expect(code).not.toContain('"@key"');
  });

  test('a native {{#each-in}} passes its reserved key through $_itemRefKey', () => {
    const { usedItemRefs, code } = compiled(
      '{{#each-in o as |k v|}}<li>{{k}}={{v}}</li>{{/each-in}}',
      NATIVE,
      ['o'],
    );
    expect(usedItemRefs).toBe(true);
    expect(code).toContain('$_itemRefKey("@each-in")');
  });

  test('a list keyed by identity or by a property does not', () => {
    for (const key of ['', ' key="@identity"', ' key="id"']) {
      const { usedItemRefs, code } = compiled(
        `{{#each this.items${key} as |item|}}<li>{{item}}</li>{{/each}}`,
        NATIVE,
      );
      expect(usedItemRefs).toBe(false);
      expect(code).not.toContain('$_itemRefKey');
    }
  });

  test('a template with no list does not', () => {
    const { usedItemRefs, code } = compiled('<p>{{this.title}}</p>{{#if this.ok}}<b>ok</b>{{/if}}', NATIVE);
    expect(usedItemRefs).toBe(false);
    expect(code).not.toContain('$_itemRefKey');
  });
});
