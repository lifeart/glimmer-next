/**
 * Per-instance slots of cells and formulas. An app holds one cell per tracked
 * property and one formula per reactive binding, so every own slot is paid
 * per instance: the tag marker lives on the class, and the debug name exists
 * only in development builds.
 */
import { describe, test, expect } from 'vitest';
import { cell, formula, Cell, LazyCell, MergedCell } from './reactive';
import { isTag } from './types';
import { isTagLike } from './shared';

describe('cell and formula shape', () => {
  test('the tag marker is not an own property; cells and formulas are still tags', () => {
    const tags: Array<Cell | MergedCell> = [
      cell(1, 'cell'),
      new LazyCell(() => 1, 'lazy'),
      formula(() => 1, 'formula'),
    ];
    for (const tag of tags) {
      expect(Object.getOwnPropertySymbols(tag)).not.toContain(isTag);
      expect(tag[isTag]).toBe(true);
      expect(isTagLike(tag)).toBe(true);
    }
    expect(isTagLike({})).toBeFalsy();
  });

  test('a debug name is an own property only in development', () => {
    const tags: Array<Cell | MergedCell> = [cell(1, 'cell'), formula(() => 1, 'formula')];
    for (const tag of tags) {
      expect(Object.prototype.hasOwnProperty.call(tag, '_debugName')).toBe(IS_DEV_MODE);
    }
  });
});
