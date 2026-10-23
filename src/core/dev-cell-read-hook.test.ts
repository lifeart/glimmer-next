/**
 * DEV cell-read seam (R1 backtracking detection, ember.js#21340 C4/C6/C7).
 *
 * The property-tag tap `$__tag(obj, key)` fires `HOST_HOOKS.onCellRead(obj, key)`
 * for every reactive read of an object/function head, so a host can snapshot the
 * `(object, key)` pairs consumed during a render pass and raise the backtracking
 * assertion when a later non-tracked `set()` dirties one of them. The hook is
 * wired only by a DEBUG host (zero-cost single branch when absent), so this test
 * drives it through `registerHostHooks` directly.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { $__tag } from './helpers/tag';
import { HOST_HOOKS, registerHostHooks } from './host-hooks';

afterEach(() => {
  // Clear the table AND refresh the hot-path cache back to null.
  for (const key of Object.keys(HOST_HOOKS)) {
    delete (HOST_HOOKS as Record<string, unknown>)[key];
  }
  registerHostHooks({});
});

describe('onCellRead cell-read seam', () => {
  test('fires with (object, key) for an object head and returns the value', () => {
    const reads: Array<[object, string]> = [];
    registerHostHooks({ onCellRead: (o, k) => reads.push([o, k]) });

    const obj = { title: 'hi' };
    const value = $__tag(obj, 'title');

    expect(value).toBe('hi');
    expect(reads).toHaveLength(1);
    expect(reads[0][0]).toBe(obj);
    expect(reads[0][1]).toBe('title');
  });

  test('does NOT fire for a primitive / nullish head (no reactive cell)', () => {
    const reads: Array<[object, string]> = [];
    registerHostHooks({ onCellRead: (o, k) => reads.push([o, k]) });

    expect($__tag('str', 'length')).toBe(3);
    expect($__tag(null, 'x')).toBe(undefined);
    expect($__tag(undefined, 'x')).toBe(undefined);
    expect(reads).toHaveLength(0);
  });

  test('is fired before a getProp delegation (captured whichever tag path runs)', () => {
    const order: string[] = [];
    const obj = { a: 1 };
    registerHostHooks({
      onCellRead: () => order.push('cellRead'),
      getProp: (o, k) => {
        order.push('getProp');
        return (o as Record<string, unknown>)[k];
      },
    });
    expect($__tag(obj, 'a')).toBe(1);
    expect(order).toEqual(['cellRead', 'getProp']);
  });

  test('no hook installed: $__tag works unchanged (zero-cost)', () => {
    const obj = { a: 2 };
    expect($__tag(obj, 'a')).toBe(2);
  });
});
