import { expect, test, describe, beforeEach } from 'vitest';
import {
  toSafeJSPath,
  escapeString,
  toOptionalChaining,
  isPath,
  serializeAttribute,
  resolvedChildren,
  nextCtxName,
  resetContextCounter,
  setFlags,
} from './utils';
import { defaultFlags } from './flags';
import type { ASTv1 } from '@glimmer/syntax';

const f = (str: string) => toSafeJSPath(str);
const e = (str: any) => escapeString(str as string);

describe('escapeString', () => {
  test('works for classic case', () => {
    expect(e('this.foo.bar.baz')).toEqual(`"this.foo.bar.baz"`);
  });
  test('works for string with quotes', () => {
    expect(e('this.foo.bar.baz"')).toEqual(`"this.foo.bar.baz\\""`);
  });
  test('works for string with double quotes', () => {
    expect(e('"this.foo.bar.baz"')).toEqual(`"this.foo.bar.baz"`);
  });
  test('works for string with double quotes #2', () => {
    expect(e('this.foo.bar"baz')).toEqual(`"this.foo.bar\\"baz"`);
  });
  test('works for strings with template literals', () => {
    expect(e('this.foo.bar`baz`')).toEqual(`"this.foo.bar\`baz\`"`);
  });
  test('works for strings like numbers', () => {
    expect(e('123')).toEqual(`"123"`);
  });
  test('works for strings like numbers #2', () => {
    expect(e('123.123')).toEqual(`"123.123"`);
  });
  test('works for strings like numbers #3', () => {
    expect(e('123.123.123')).toEqual(`"123.123.123"`);
  });
  test('throw error if input is not a string', () => {
    expect(() => e(123)).toThrow('Not a string');
  });
  test('skip already escaped strings', () => {
    expect(e('"this.foo.bar.baz"')).toEqual(`"this.foo.bar.baz"`);
  });
});

describe('toSafeJSPath', () => {
  test('works for classic case', () => {
    expect(f('this.foo.bar.baz')).toEqual(`this.foo.bar.baz`);
  });
  test('works for args case', () => {
    expect(f('this[args].foo.bar.baz')).toEqual(`this[args].foo.bar.baz`);
  });
  test('works for bare args case', () => {
    expect(f('@foo.bar.baz')).toEqual(`@foo.bar.baz`);
  });
  test('works for expected case', () => {
    expect(f('this[args].foo-bar')).toEqual(`this[args]["foo-bar"]`);
  });
  test('works for expected case with optional-chaining', () => {
    expect(f('this[args].foo-bar?.baz')).toEqual(`this[args]["foo-bar"]?.baz`);
  });
  test('works for expected case with optional-chaining #2', () => {
    expect(f('this[args]?.foo-bar?.baz')).toEqual(`this[args]["foo-bar"]?.baz`);
  });

  test('works with array access notation', () => {
    expect(f('this[args][0].foo')).toEqual(`this[args][0].foo`);
  });

  test('preserves function calls', () => {
    expect(f('this.foo(bar).baz')).toEqual(`this.foo(bar).baz`);
  });

  test('returns simple paths unchanged', () => {
    expect(f('foo')).toEqual('foo');
  });
});

describe('toOptionalChaining', () => {
  test('returns non-string values unchanged', () => {
    expect(toOptionalChaining(null)).toEqual(null);
    expect(toOptionalChaining(undefined)).toEqual(undefined);
    expect(toOptionalChaining(123 as unknown as string)).toEqual(123);
  });

  test('returns strings with quotes unchanged', () => {
    expect(toOptionalChaining("'foo.bar.baz'")).toEqual("'foo.bar.baz'");
    expect(toOptionalChaining('"foo.bar.baz"')).toEqual('"foo.bar.baz"');
  });

  test('returns strings with $_ unchanged', () => {
    expect(toOptionalChaining('$_tag.foo.bar')).toEqual('$_tag.foo.bar');
  });

  test('returns strings with existing optional chaining unchanged', () => {
    expect(toOptionalChaining('foo?.bar?.baz')).toEqual('foo?.bar?.baz');
  });

  test('returns short paths unchanged', () => {
    expect(toOptionalChaining('foo.bar')).toEqual('foo.bar');
    expect(toOptionalChaining('foo')).toEqual('foo');
  });

  test('converts long paths to optional chaining', () => {
    expect(toOptionalChaining('foo.bar.baz')).toEqual('foo?.bar?.baz');
    expect(toOptionalChaining('foo.bar.baz.qux')).toEqual('foo?.bar?.baz?.qux');
  });

  test('fixes this?.  to this.', () => {
    expect(toOptionalChaining('this.foo.bar.baz')).toEqual('this.foo?.bar?.baz');
  });

  test('preserves spread operator', () => {
    expect(toOptionalChaining('...foo.bar.baz')).toEqual('...foo?.bar?.baz');
  });
});

describe('isPath', () => {
  test('returns true for paths starting with $:', () => {
    expect(isPath('$:foo')).toBe(true);
    expect(isPath('$:this.foo.bar')).toBe(true);
    expect(isPath('$:() => foo')).toBe(true);
  });

  test('returns false for non-paths', () => {
    expect(isPath('foo')).toBe(false);
    expect(isPath('this.foo')).toBe(false);
    expect(isPath('"string"')).toBe(false);
  });
});

describe('serializeAttribute', () => {
  beforeEach(() => {
    setFlags(defaultFlags());
  });

  test('serializes boolean values', () => {
    expect(serializeAttribute('disabled', true)).toEqual("['disabled', true]");
    expect(serializeAttribute('disabled', false)).toEqual("['disabled', false]");
  });

  test('serializes number values', () => {
    expect(serializeAttribute('tabindex', 0)).toEqual("['tabindex', 0]");
    expect(serializeAttribute('max', 100)).toEqual("['max', 100]");
  });

  test('serializes null values', () => {
    expect(serializeAttribute('data-value', null)).toEqual("['data-value', null]");
  });

  test('serializes undefined values', () => {
    expect(serializeAttribute('data-value', undefined)).toEqual("['data-value', undefined]");
  });

  test('serializes string values', () => {
    expect(serializeAttribute('class', 'foo')).toEqual(`['class', "foo"]`);
    expect(serializeAttribute('id', 'my-id')).toEqual(`['id', "my-id"]`);
  });

  test('serializes path values', () => {
    expect(serializeAttribute('class', '$:this.className')).toContain('this.className');
  });
});

describe('resolvedChildren', () => {
  test('filters out comment statements', () => {
    const children = [
      { type: 'CommentStatement', value: 'comment' },
      { type: 'TextNode', chars: 'hello' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
    expect((resolvedChildren(children)[0] as ASTv1.TextNode).chars).toEqual('hello');
  });

  test('filters out mustache comment statements', () => {
    const children = [
      { type: 'MustacheCommentStatement', value: 'comment' },
      { type: 'TextNode', chars: 'hello' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
  });

  test('filters out empty multiline text nodes', () => {
    const children = [
      { type: 'TextNode', chars: '   \n   ' },
      { type: 'TextNode', chars: 'hello' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
    expect((resolvedChildren(children)[0] as ASTv1.TextNode).chars).toEqual('hello');
  });

  test('keeps non-empty text nodes', () => {
    const children = [
      { type: 'TextNode', chars: ' foo ' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(1);
  });

  test('keeps element nodes', () => {
    const children = [
      { type: 'ElementNode', tag: 'div' },
      { type: 'ElementNode', tag: 'span' },
    ] as unknown as ASTv1.Node[];
    expect(resolvedChildren(children)).toHaveLength(2);
  });
});

describe('nextCtxName and resetContextCounter', () => {
  beforeEach(() => {
    resetContextCounter();
  });

  test('generates sequential context names', () => {
    expect(nextCtxName()).toEqual('ctx0');
    expect(nextCtxName()).toEqual('ctx1');
    expect(nextCtxName()).toEqual('ctx2');
  });

  test('resets counter correctly', () => {
    nextCtxName();
    nextCtxName();
    resetContextCounter();
    expect(nextCtxName()).toEqual('ctx0');
  });
});
