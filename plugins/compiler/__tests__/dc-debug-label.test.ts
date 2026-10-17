/**
 * Ember (compat and native): a dynamic component invocation by angle brackets
 * (`<this.HelloWorld />`, `<@Greeting />`) passes its tag path to `$_dc` as
 * the 5th argument (after `$fw`, or `undefined` without one).
 *
 * `$_dc` got only a getter of the definition, so a host could not name the
 * component node of the invocation as Glimmer does (the debug render tree /
 * Ember Inspector names it by the path the template wrote: `this.HelloWorld`,
 * `@Greeting`), and the Ember compat build parsed the path out of the getter's
 * source text for its error messages. `{{component this.x}}` passes no label
 * (its node is named by the definition), and standalone gxt is unchanged.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = {
  flags: {
    IS_GLIMMER_COMPAT_MODE: true,
    WITH_EMBER_INTEGRATION: true,
    WITH_HELPER_MANAGER: true,
    WITH_MODIFIER_MANAGER: true,
  },
} as const;
const NATIVE = { flags: { ...COMPAT.flags, EMBER_NATIVE: true } } as const;
const STANDALONE = { flags: { IS_GLIMMER_COMPAT_MODE: true } } as const;

function code(tpl: string, options: { flags: Record<string, boolean> } = COMPAT) {
  const result = compile(tpl, options);
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('a dynamic component invocation passes its tag path to $_dc', () => {
  test('<this.X />', () => {
    expect(code('<this.HelloWorld @arg="first" />')).toMatch(
      /\$_dc\(\(\) => this\.HelloWorld, .*, this, undefined, "this\.HelloWorld"\)/,
    );
  });

  test('<@X />', () => {
    expect(code('<@Greeting @arg="first" />')).toMatch(
      /\$_dc\(\(\) => \$a\.Greeting, .*, this, undefined, "@Greeting"\)/,
    );
  });

  test('a deeper path, and a block', () => {
    expect(code('<this.ui.Card>x</this.ui.Card>')).toMatch(/, this, undefined, "this\.ui\.Card"\)/);
  });

  test('after the forwarded attributes', () => {
    expect(code('<this.X ...attributes />')).toMatch(/, this, \$fw, "this\.X"\)/);
  });

  test('native passes it too', () => {
    expect(code('<this.HelloWorld />', NATIVE)).toMatch(/, this, undefined, "this\.HelloWorld"\)/);
  });

  test('{{component this.x}} passes no label', () => {
    const out = code('{{component this.foo}}');
    expect(out).toContain('$_dc(() => this.foo');
    expect(out).not.toContain('"this.foo"');
  });

  test('standalone gxt is unchanged', () => {
    const out = code('<this.HelloWorld />', STANDALONE);
    expect(out).toContain('$_dc(() => this.HelloWorld');
    expect(out).not.toContain('"this.HelloWorld"');
    expect(out).not.toContain('undefined');
  });
});
