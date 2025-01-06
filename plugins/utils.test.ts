import { expect, test, describe } from 'vitest';
import { toSafeJSPath, escapeString } from './utils';

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
});
