/**
 * Ember mode: a template's read of a plain (untracked) class field stays a
 * reactive read.
 *
 * In Ember any property can change through `set()` / `notifyPropertyChange()`,
 * and Glimmer re-renders a template that read it (its `getProp` consumes the
 * property's tag). gxt's type-directed optimization classified a plain field
 * with a literal initializer (`clicks = 0`) as static and emitted the bare read
 * (`this.clicks`, evaluated once), so a class-body template never updated after
 * `set(this, 'clicks', …)`. Under WITH_EMBER_INTEGRATION only a `readonly`
 * field (an author promise that it never changes) is still folded; standalone
 * output is unchanged.
 *
 * The Vite plugin also reads every member of a template path through the
 * property-tag tap (EMBER_PROPERTY_TAGS) by default under
 * WITH_EMBER_INTEGRATION, so an Ember consumer's config no longer needs to set
 * that flag for `set()` to re-render a plain field.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import type { CompileOptions, TypeHints } from '../types';
import { compiler } from '../../compiler';

function compileWith(template: string, typeHints: TypeHints, extraFlags: Record<string, boolean> = {}) {
  const options: CompileOptions = {
    flags: {
      IS_GLIMMER_COMPAT_MODE: true,
      WITH_TYPE_OPTIMIZATION: true,
      ...extraFlags,
    },
    typeHints,
  };
  const result = compile(template, options);
  expect(result.errors).toHaveLength(0);
  return result.code;
}

const PLAIN_FIELD: TypeHints = {
  properties: { 'this.clicks': { kind: 'primitive', literalValue: 0 } },
};

describe('Ember mode: plain class fields are not folded', () => {
  test('standalone: a plain primitive field is static (unchanged)', () => {
    const code = compileWith('{{this.clicks}}', PLAIN_FIELD);
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.clicks/);
    expect(code).toContain('this.clicks');
  });

  test('WITH_EMBER_INTEGRATION: a plain primitive field keeps its reactive getter', () => {
    const code = compileWith('{{this.clicks}}<p title={{this.clicks}}></p>', PLAIN_FIELD, {
      WITH_EMBER_INTEGRATION: true,
    });
    expect(code).toMatch(/\(\)\s*=>\s*this\.clicks/);
    expect(code).not.toMatch(/\[\s*"title",\s*this\.clicks\s*\]/);
  });

  test('WITH_EMBER_INTEGRATION: a readonly literal field is still folded', () => {
    const code = compileWith(
      '{{this.label}}',
      { properties: { 'this.label': { kind: 'primitive', isReadonly: true, literalValue: 'hi' } } },
      { WITH_EMBER_INTEGRATION: true },
    );
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.label/);
    expect(code).toContain('"hi"');
  });
});

describe('Vite plugin: EMBER_PROPERTY_TAGS defaults on under WITH_EMBER_INTEGRATION', () => {
  const SOURCE = `import Component from '@glimmer/component';
export default class Clicks extends Component {
  clicks = 0;
  <template>{{this.clicks}}</template>
}
`;

  async function run(flags: Record<string, boolean>) {
    const plugin = compiler('production', { flags });
    (plugin.config as Function).call({}, {}, { mode: 'production', command: 'build' });
    const result = await (plugin.transform as Function).call({}, SOURCE, '/app/clicks.gjs');
    return result.code as string;
  }

  test('an Ember consumer gets property-tag reads without setting the flag', async () => {
    const code = await run({ WITH_EMBER_INTEGRATION: true });
    expect(code).toMatch(/\(\)\s*=>\s*\$__tag\(this,\s*"clicks"\)/);
  });

  test('an explicit EMBER_PROPERTY_TAGS: false is kept, and the field is still not folded', async () => {
    const code = await run({ WITH_EMBER_INTEGRATION: true, EMBER_PROPERTY_TAGS: false });
    expect(code).not.toContain('$__tag(');
    expect(code).toMatch(/\(\)\s*=>\s*this\.clicks/);
  });

  test('standalone gxt is unchanged (no property tags, the field is folded)', async () => {
    const code = await run({});
    expect(code).not.toContain('$__tag(');
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.clicks/);
  });
});
