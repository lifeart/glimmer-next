import { describe, test, expect } from 'vitest';
import { $__cellFor } from './cell-for';
import { formula, cellFor } from '../reactive';

/**
 * Behavior tests for the Ember-dialect {{#each}} row-item tap helper.
 * `$__cellFor(item, key)` is what the compiler emits for `{{item.text}}` so
 * the read stays reactive on item-property mutation without a runtime Proxy.
 */
describe('$__cellFor helper', () => {
  test('reads the property value through the row item cell', () => {
    const item = { text: 'a' };
    expect($__cellFor(item, 'text')).toBe('a');
  });

  test('stays reactive: a formula recomputes when the item property mutates', () => {
    const item = { text: 'a' };
    const f = formula(() => $__cellFor(item, 'text'), 'tap');
    expect(f.value).toBe('a');
    // cellFor installed an accessor on item.text; assigning routes through the
    // cell and bumps its revision, so the dependent formula recomputes.
    item.text = 'b';
    expect(f.value).toBe('b');
  });

  test('deep paths compose and stay reactive per segment', () => {
    const item: { v: { x: number } } = { v: { x: 1 } };
    const f = formula(
      () => $__cellFor($__cellFor(item, 'v'), 'x'),
      'deep'
    );
    expect(f.value).toBe(1);
    item.v.x = 2;
    expect(f.value).toBe(2);
  });

  test('shares the cell with cellFor(item, key): mutation via either is observed', () => {
    const item = { text: 'a' };
    const c = cellFor(item, 'text');
    const f = formula(() => $__cellFor(item, 'text'), 'shared');
    expect(f.value).toBe('a');
    c.update('z');
    expect(f.value).toBe('z');
  });

  test('primitive head falls back to a plain member read (no throw)', () => {
    expect($__cellFor('hello', 'length')).toBe(5);
    expect($__cellFor(42, 'toFixed')).toBe((42 as number).toFixed);
  });

  test('nullish head returns undefined (no throw)', () => {
    expect($__cellFor(null, 'x')).toBeUndefined();
    expect($__cellFor(undefined, 'x')).toBeUndefined();
  });
});
