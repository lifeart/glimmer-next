/**
 * Literal path segments (`this.[1]`, `this.['']`, `this.[foo.bar]`,
 * `this.nested.[undefined]`) are member reads by key.
 *
 * Glimmer's `[...]` segment syntax reads the property whose name is the
 * literal text. gxt rebuilt the path from its dotted string, so it emitted
 * `this.1` (a SyntaxError: the whole template failed to compile) and read
 * `this.[foo.bar]` as `this.foo?.bar`.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const FLAGS = {
  compat: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
  standalone: { IS_GLIMMER_COMPAT_MODE: true },
} as const;
const NATIVE = { ...FLAGS.compat, EMBER_NATIVE: true, EMBER_PROPERTY_TAGS: true, EMBER_SELF: true };

const TEMPLATE =
  "[{{this.['']}}][{{this.[1]}}][{{this.[undefined]}}][{{this.[foo.bar]}}]" +
  '[{{this.nested.[1]}}][{{this.nested.[foo.bar]}}]<p title={{this.[1]}}></p>';

describe('literal path segments', () => {
  for (const [label, flags] of Object.entries(FLAGS)) {
    test(`${label}: every segment is a valid member read by key`, () => {
      const { code, errors } = compile(TEMPLATE, { flags } as never);
      expect(errors).toHaveLength(0);
      const c = code;
      expect(c).not.toMatch(/this\.1\b|this\.''|\?\.1\b/);
      expect(c).toContain('this["1"]');
      expect(c).toContain('this["foo.bar"]');
      expect(c).toContain('this.undefined');
      expect(c).toMatch(/this\.nested\?\.\["1"\]/);
      expect(c).toMatch(/this\.nested\?\.\["foo\.bar"\]/);
      // the emitted module parses
      expect(() => new Function(`return [${code}];`)).not.toThrow();
    });
  }

  test('native: every segment is a property-tag read by key', () => {
    const { code, errors } = compile(TEMPLATE, { flags: NATIVE } as never);
    expect(errors).toHaveLength(0);
    expect(code).toContain('$__tag($s, "1")');
    expect(code).toContain('$__tag($s, "foo.bar")');
    expect(code).toContain('$__tag($__tag($s, "nested"), "foo.bar")');
    expect(code).not.toMatch(/\$s\.foo\?\.bar/);
  });

  test('evaluated: reads the keyed properties', () => {
    const { code } = compile('{{this.[foo.bar]}}|{{this.nested.[1]}}', {
      flags: FLAGS.standalone,
    } as never);
    const self: Record<string, unknown> = { 'foo.bar': 'fb', foo: { bar: 'wrong' }, nested: { 1: 'one' } };
    // eslint-disable-next-line no-new-func
    const out = new Function(`return ${code};`).call(self) as Array<unknown>;
    const values = out.map((v) => (typeof v === 'function' ? (v as () => unknown).call(self) : v));
    expect(values).toEqual(['fb', '|', 'one']);
  });
});
