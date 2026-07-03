import { describe, test, expect } from 'vitest';
import { $_nbt, getNamedBlockName, isNodeThunk, $_nt } from './dom';

describe('$_nbt() / getNamedBlockName()', () => {
  test('$_nbt marks a thunk with its slot name and returns the SAME function', () => {
    const thunk = () => 42;
    const marked = $_nbt(thunk, 'header');
    // Identity preserved — the runtime sees the exact same function object.
    expect(marked).toBe(thunk);
    expect(getNamedBlockName(marked)).toBe('header');
  });

  test('a named-block thunk is ALSO a node thunk (superset of $_nt)', () => {
    // A named-block factory must be INVOKED (to yield its marker), so
    // isNodeThunk must stay true for it.
    const marked = $_nbt(() => 42, 'body');
    expect(isNodeThunk(marked)).toBe(true);
  });

  test('getNamedBlockName is null for an unmarked / plain node thunk', () => {
    expect(getNamedBlockName(() => 'text getter')).toBe(null);
    // A plain $_nt node thunk is not a named block — no slot name.
    expect(getNamedBlockName($_nt(() => 'dom'))).toBe(null);
  });

  test('getNamedBlockName is null for non-functions', () => {
    expect(getNamedBlockName(undefined)).toBe(null);
    expect(getNamedBlockName(null)).toBe(null);
    expect(getNamedBlockName("$_tag(':header'")).toBe(null);
    expect(getNamedBlockName(123)).toBe(null);
    expect(getNamedBlockName({})).toBe(null);
  });

  test('preserves an empty-string slot name (distinct from "not a named block")', () => {
    // getNamedBlockName returns the stored string; '' is a valid (falsy) name
    // and must NOT be conflated with null.
    const marked = $_nbt(() => 0, '');
    expect(getNamedBlockName(marked)).toBe('');
    expect(getNamedBlockName(marked)).not.toBe(null);
  });

  test('the marker survives function source-stripping (minification-proof)', () => {
    // A minifier renames $_tag -> a local, so the source no longer contains
    // the "$_tag(':" substring; the property marker must still report the name.
    const minifiedLikeThunk = $_nbt(() => 'a()', 'footer'); // body has no $_* substrings
    expect(minifiedLikeThunk.toString().includes("$_tag(':")).toBe(false);
    expect(getNamedBlockName(minifiedLikeThunk)).toBe('footer');
  });
});
