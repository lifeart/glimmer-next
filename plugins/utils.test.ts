import { expect, test, describe } from 'vitest';
import { toSafeJSPath } from './utils';

const f = (str: string) => toSafeJSPath(str);

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
