/**
 * A member path whose segments include a `$_`-prefixed identifier is read
 * null-safely like any other deep path.
 *
 * `toOptionalChaining` turns a 3+-segment read into `a?.b?.c` (Glimmer path
 * reads are null-safe: a missing link reads as undefined). It skipped every
 * string containing `$_`, meant for runtime-symbol expressions, so a path
 * through a `$_`-named identifier (Ember's angle-bracket block params are
 * rewritten to `this.$_bp0`) stayed `this.$_bp0.foo.bar` and threw a TypeError
 * when the block param was a string, a number, `null` or `undefined`.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { toOptionalChaining } from '../visitors/utils';
import { builders as b } from '@glimmer/syntax';

const COMPAT = { flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true } } as const;

describe('null-safe reads through `$_`-named path segments', () => {
  test('toOptionalChaining treats `$_` identifiers like any identifier', () => {
    expect(toOptionalChaining('this.$_bp0.foo.bar')).toBe('this.$_bp0?.foo?.bar');
    expect(toOptionalChaining('this.$_bp0.foo')).toBe('this.$_bp0?.foo');
    expect(toOptionalChaining('$_bp.foo.bar')).toBe('$_bp?.foo?.bar');
  });

  test('a runtime-symbol expression is left alone', () => {
    expect(toOptionalChaining('$_maybeHelper("x", [], this).a.b')).toBe(
      '$_maybeHelper("x", [], this).a.b',
    );
    expect(toOptionalChaining('$_a(b.c).d.e')).toBe('$_a(b.c).d.e');
    expect(toOptionalChaining('this[$_x].a.b')).toBe('this[$_x].a.b');
  });

  test('a template path through `this.$_bp0` compiles null-safe', () => {
    const { code } = compile('{{this.$_bp0.foo.bar}}', COMPAT);
    expect(code).toContain('this.$_bp0?.foo?.bar');
    expect(code).not.toContain('this.$_bp0.foo.bar');
  });

  test('a block-param path rewritten in place to `this.$_bp0.…` (Ember) compiles null-safe', () => {
    // Ember's angle-bracket block-param transform mutates the parsed node in
    // place (keeping its `loc`): head → `this`, tail → [`$_bp0`, …tail].
    const rewriteBlockParam = {
      PathExpression(node: any) {
        if (node.head?.type !== 'VarHead' || node.head.name !== 'yielded') return;
        node.head = (b.path('this') as any).head;
        node.tail = ['$_bp0', ...(node.tail || [])];
        node.original = `this.${node.tail.join('.')}`;
      },
    };
    const { code } = compile('<p>{{yielded.foo.bar}}</p>{{yielded.foo}}', {
      ...COMPAT,
      transforms: [() => ({ name: 'rewrite-block-param', visitor: rewriteBlockParam })],
    } as never);
    expect(code).toContain('this.$_bp0?.foo?.bar');
    expect(code).toContain('this.$_bp0?.foo');
    expect(code).not.toContain('this.$_bp0.foo');
  });

  test('evaluated: a string / nullish block param reads as undefined', () => {
    for (const value of ['hello', 1, null, undefined, true]) {
      const self = { $_bp0: value };
      // eslint-disable-next-line no-new-func
      const read = new Function(`return ${toOptionalChaining('this.$_bp0.foo.bar')};`);
      expect(read.call(self)).toBe(undefined);
    }
  });
});
