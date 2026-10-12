import { describe, test, expect } from 'vitest';
import { consumeIterationTags } from './list';
import { cell, formula, setIsRendering } from '@/core/reactive';
import { tagFor, dirtyCell } from '@/core/tags';

// A stand-in for an Ember tracked collection proxy: reading `length` / `size`
// consumes the collection's tag (here: a gxt cell).
function trackedCollectionLike<T extends object>(target: T, tag: { value: unknown }): T {
  return new Proxy(target, {
    get(t, key) {
      if (key === 'length' || key === 'size') void tag.value;
      return Reflect.get(t, key);
    },
  });
}

describe('consumeIterationTags (EMBER_NATIVE list-tag entanglement)', () => {
  function subscribedCells(read: () => unknown) {
    const f = formula(read, 'probe');
    setIsRendering(true);
    try {
      void f.value;
    } finally {
      setIsRendering(false);
    }
    return f.relatedCells ? f.relatedCells.size : 0;
  }

  test('an array-like collection: the formula subscribes through `length`', () => {
    const tag = cell(0);
    const arr = trackedCollectionLike([1, 2], tag);
    expect(subscribedCells(() => arr)).toBe(0); // returning the reference alone tracks nothing
    // `length` (the collection tag) + the `[]` property tag
    expect(
      subscribedCells(() => {
        consumeIterationTags(arr);
        return arr;
      }),
    ).toBe(2);
  });

  test('a Set/Map-like collection: the formula subscribes through `size`', () => {
    const tag = cell(0);
    const set = trackedCollectionLike(new Set([1]), tag);
    // `size` (the collection tag) + the `[]` property tag
    expect(
      subscribedCells(() => {
        consumeIterationTags(set);
        return set;
      }),
    ).toBe(2);
  });

  test("any object iterable: the formula subscribes to its `[]` tag (Ember (-track-array))", () => {
    for (const iterable of [[1, 2], new Set([1]), { forEach() {} }]) {
      const f = formula(() => {
        consumeIterationTags(iterable);
        return iterable;
      }, 'probe');
      setIsRendering(true);
      try {
        void f.value;
      } finally {
        setIsRendering(false);
      }
      expect(f.relatedCells?.has(tagFor(iterable, '[]'))).toBe(true);
      // notifyPropertyChange(iterable, '[]') dirties exactly that cell
      expect(() => dirtyCell(tagFor(iterable, '[]'))).not.toThrow();
      f.destroy();
    }
  });

  test('primitives / null are ignored', () => {
    expect(() => consumeIterationTags(null)).not.toThrow();
    expect(() => consumeIterationTags(undefined)).not.toThrow();
    expect(() => consumeIterationTags('str')).not.toThrow();
  });
});
