import { describe, expect, test } from 'vitest';
import { normalizeIterableValue } from './list';

describe('normalizeIterableValue', () => {
  describe('falsy primitives → []', () => {
    test('null', () => expect(normalizeIterableValue(null)).toEqual([]));
    test('undefined', () => expect(normalizeIterableValue(undefined)).toEqual([]));
    test('false', () => expect(normalizeIterableValue(false)).toEqual([]));
    test('empty string', () => expect(normalizeIterableValue('')).toEqual([]));
    test('zero', () => expect(normalizeIterableValue(0)).toEqual([]));
  });

  describe('truthy non-iterable primitives → []', () => {
    test('true', () => expect(normalizeIterableValue(true)).toEqual([]));
    test('non-empty string', () => expect(normalizeIterableValue('hello')).toEqual([]));
    test('positive number', () => expect(normalizeIterableValue(1)).toEqual([]));
    test('NaN', () => expect(normalizeIterableValue(NaN)).toEqual([]));
  });

  describe('plain objects/functions → []', () => {
    test('plain {}', () => expect(normalizeIterableValue({})).toEqual([]));
    test('object with property', () => expect(normalizeIterableValue({ foo: 'bar' })).toEqual([]));
    test('Object', () => expect(normalizeIterableValue(Object)).toEqual([]));
    test('function () {}', () => expect(normalizeIterableValue(function () {})).toEqual([]));
    test('Object.create(null)', () =>
      expect(normalizeIterableValue(Object.create(null))).toEqual([]));
    test('Object.create({})', () =>
      expect(normalizeIterableValue(Object.create({}))).toEqual([]));
    test('Object.create({ foo: "bar" })', () =>
      expect(normalizeIterableValue(Object.create({ foo: 'bar' }))).toEqual([]));
  });

  describe('arrays → same array', () => {
    test('empty array', () => {
      const arr: unknown[] = [];
      expect(normalizeIterableValue(arr)).toBe(arr);
    });
    test('non-empty array', () => {
      const arr = ['hello'];
      expect(normalizeIterableValue(arr)).toBe(arr);
    });
    test('emberA-shaped (array with extra props)', () => {
      const arr: any = ['hello'];
      arr.someEmberProp = true;
      expect(normalizeIterableValue(arr)).toBe(arr);
    });
  });

  describe('Set → spread', () => {
    test('empty Set', () => {
      expect(normalizeIterableValue(new Set([]))).toEqual([]);
    });
    test('non-empty Set', () => {
      expect(normalizeIterableValue(new Set(['hello']))).toEqual(['hello']);
    });
    test('Set with multiple items', () => {
      expect(normalizeIterableValue(new Set([1, 2, 3]))).toEqual([1, 2, 3]);
    });
  });

  describe('Map → spread', () => {
    test('empty Map', () => {
      expect(normalizeIterableValue(new Map())).toEqual([]);
    });
    test('Map with entries', () => {
      const m = new Map<string, number>();
      m.set('a', 1);
      m.set('b', 2);
      expect(normalizeIterableValue(m)).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });
  });

  describe('custom Symbol.iterator class (ForEachable / ArrayIterable)', () => {
    class ForEachable<T> {
      constructor(private items: T[]) {}
      forEach(cb: (item: T) => void) {
        this.items.forEach(cb);
      }
      *[Symbol.iterator](): IterableIterator<T> {
        for (const item of this.items) yield item;
      }
    }

    class ArrayIterable<T> {
      constructor(private items: T[]) {}
      [Symbol.iterator]() {
        let i = 0;
        const items = this.items;
        return {
          next(): IteratorResult<T> {
            if (i < items.length) {
              return { value: items[i++], done: false };
            }
            return { value: undefined as unknown as T, done: true };
          },
        };
      }
    }

    test('empty ForEachable', () => {
      expect(normalizeIterableValue(new ForEachable<string>([]))).toEqual([]);
    });
    test('non-empty ForEachable', () => {
      expect(normalizeIterableValue(new ForEachable(['hello']))).toEqual(['hello']);
    });
    test('empty ArrayIterable', () => {
      expect(normalizeIterableValue(new ArrayIterable<string>([]))).toEqual([]);
    });
    test('non-empty ArrayIterable', () => {
      expect(normalizeIterableValue(new ArrayIterable(['hello']))).toEqual(['hello']);
    });
  });

  describe('generator functions', () => {
    test('generator yields values', () => {
      function* gen() {
        yield 'a';
        yield 'b';
      }
      const iter = gen();
      expect(normalizeIterableValue(iter)).toEqual(['a', 'b']);
    });

    class GenBacked<T> {
      constructor(private items: T[]) {}
      *[Symbol.iterator]() {
        for (const it of this.items) yield it;
      }
    }
    test('generator-driven class', () => {
      expect(normalizeIterableValue(new GenBacked(['x']))).toEqual(['x']);
    });
  });

  describe('ArrayProxy-shaped objects (Ember.ArrayProxy)', () => {
    test('proxy with array content', () => {
      expect(normalizeIterableValue({ content: ['hello'] })).toEqual(['hello']);
    });
    test('proxy with empty array content', () => {
      expect(normalizeIterableValue({ content: [] })).toEqual([]);
    });
    test('proxy whose content is itself a Set', () => {
      expect(normalizeIterableValue({ content: new Set([1, 2]) })).toEqual([1, 2]);
    });
    test('proxy with content === undefined → []', () => {
      expect(normalizeIterableValue({ content: undefined })).toEqual([]);
    });
    test('destroyed proxy → []', () => {
      const proxy = { content: ['x'], isDestroyed: true };
      expect(normalizeIterableValue(proxy)).toEqual([]);
    });
    test('destroying proxy → []', () => {
      const proxy = { content: ['x'], isDestroying: true };
      expect(normalizeIterableValue(proxy)).toEqual([]);
    });
    test('proxy whose content getter throws → []', () => {
      const proxy = {
        get content() {
          throw new Error('proxy died');
        },
      };
      expect(normalizeIterableValue(proxy)).toEqual([]);
    });
    test('proxy content === proxy (self-ref) falls back to iterator if any', () => {
      const proxy: any = {};
      proxy.content = proxy;
      // not iterable, no symbol iterator → []
      expect(normalizeIterableValue(proxy)).toEqual([]);
    });
  });

  describe('forEach + length delegate (Ember ForEachable shape)', () => {
    class ForEachOnly<T> {
      constructor(private items: T[]) {}
      get length() {
        return this.items.length;
      }
      forEach(cb: (item: T) => void) {
        this.items.forEach(cb);
      }
    }
    test('empty', () => expect(normalizeIterableValue(new ForEachOnly<string>([]))).toEqual([]));
    test('non-empty', () =>
      expect(normalizeIterableValue(new ForEachOnly(['hello']))).toEqual(['hello']));
    test('multi-item', () =>
      expect(normalizeIterableValue(new ForEachOnly([1, 2, 3]))).toEqual([1, 2, 3]));
  });

  describe('TRUTHY_CASES from Ember each-test', () => {
    test("['hello']", () => expect(normalizeIterableValue(['hello'])).toEqual(['hello']));
    test("emberA(['hello']) shape", () =>
      expect(normalizeIterableValue(['hello'])).toEqual(['hello']));
    test("new Set(['hello'])", () =>
      expect(normalizeIterableValue(new Set(['hello']))).toEqual(['hello']));
    test('ArrayProxy.create({ content: [\'hello\'] })', () =>
      expect(normalizeIterableValue({ content: ['hello'] })).toEqual(['hello']));
  });

  describe('FALSY_CASES from Ember each-test', () => {
    const cases: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['false', false],
      ["''", ''],
      ['0', 0],
      ['[]', []],
      ['emberA([])', []],
      ['new Set([])', new Set([])],
      ['ArrayProxy.create({ content: [] })', { content: [] }],
      ['true', true],
      ["'hello'", 'hello'],
      ['1', 1],
      ['Object', Object],
      ['function () {}', function () {}],
      ['{}', {}],
      ["{ foo: 'bar' }", { foo: 'bar' }],
      ['Object.create(null)', Object.create(null)],
      ['Object.create({})', Object.create({})],
      ["Object.create({ foo: 'bar' })", Object.create({ foo: 'bar' })],
    ];
    for (const [label, value] of cases) {
      test(`${label} → []`, () => {
        expect(normalizeIterableValue(value)).toEqual([]);
      });
    }
  });
});
