import { describe, test, expect } from 'vitest';
import { $_nt, isNodeThunk } from './dom';

describe('$_nt() / isNodeThunk()', () => {
  test('$_nt marks a thunk and returns the SAME function (identity)', () => {
    const thunk = () => 42;
    const marked = $_nt(thunk);
    // Identity preserved — the runtime sees the exact same function object.
    expect(marked).toBe(thunk);
    expect(isNodeThunk(marked)).toBe(true);
  });

  test('isNodeThunk is false for an unmarked function', () => {
    expect(isNodeThunk(() => 'text getter')).toBe(false);
  });

  test('isNodeThunk is false for non-functions', () => {
    expect(isNodeThunk(undefined)).toBe(false);
    expect(isNodeThunk(null)).toBe(false);
    expect(isNodeThunk('() => $_tag(')).toBe(false);
    expect(isNodeThunk(123)).toBe(false);
    expect(isNodeThunk({})).toBe(false);
  });

  test('the marker survives function source-stripping (minification-proof)', () => {
    // A minifier renames $_tag -> a local, so the source no longer contains
    // the "$_tag(" substring; the property marker must still report true.
    const minifiedLikeThunk = $_nt(() => 'a()'); // body has no $_* substrings
    expect(minifiedLikeThunk.toString().includes('$_tag(')).toBe(false);
    expect(isNodeThunk(minifiedLikeThunk)).toBe(true);
  });
});
