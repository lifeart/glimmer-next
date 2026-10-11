import { describe, test, expect, afterEach } from 'vitest';
import { $__tag } from './tag';
import { $__cellFor } from './cell-for';
import { tagFor, dirtyCell } from '../tags';
import { formula, setTracker, getTracker, lazyRawCellFor, setIsRendering } from '../reactive';

function trackReads(fn: () => unknown) {
  const prev = getTracker();
  const tracker = new Set<any>();
  setTracker(tracker);
  try {
    return { value: fn(), tracker };
  } finally {
    setTracker(prev);
  }
}

describe('$__tag (EMBER_NATIVE non-defining member tap)', () => {
  afterEach(() => setIsRendering(false));

  test('consumes the per-(obj, key) tag cell and returns the plain value', () => {
    const row = { label: 'a' };
    const { value, tracker } = trackReads(() => $__tag(row, 'label'));
    expect(value).toBe('a');
    expect(tracker.has(tagFor(row, 'label'))).toBe(true);
  });

  test('never defines an own accessor (a POJO row stays a data property)', () => {
    const row = { label: 'a' };
    trackReads(() => $__tag(row, 'label'));
    const desc = Object.getOwnPropertyDescriptor(row, 'label')!;
    expect('value' in desc).toBe(true);
    expect(desc.get).toBeUndefined();
    // contrast: the compat tap installs an accessor
    const other = { label: 'a' };
    trackReads(() => $__cellFor(other, 'label'));
    expect(Object.getOwnPropertyDescriptor(other, 'label')!.get).toBeTypeOf('function');
  });

  test('does not shadow a host prototype accessor (its getter still runs)', () => {
    let getterRuns = 0;
    class Item {
      #v = 'x';
      get label() {
        getterRuns++;
        return this.#v;
      }
      set label(v: string) {
        this.#v = v;
      }
    }
    const item = new Item();
    expect(trackReads(() => $__tag(item, 'label')).value).toBe('x');
    expect(getterRuns).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(item, 'label')).toBe(false);
    item.label = 'y';
    expect(trackReads(() => $__tag(item, 'label')).value).toBe('y');
    expect(getterRuns).toBe(2);
  });

  test('a formula reading through $__tag re-runs when the tag is dirtied (Ember set() path)', () => {
    const row: Record<string, string> = { label: 'a' };
    let runs = 0;
    const f = formula(() => {
      runs++;
      return $__tag(row, 'label');
    }, 'tap');
    setIsRendering(true);
    expect(f.value).toBe('a');
    setIsRendering(false);
    expect(f.relatedCells?.has(tagFor(row, 'label'))).toBe(true);
    // host write + dirty (what Ember `set(row, 'label', 'b')` does)
    row.label = 'b';
    dirtyCell(tagFor(row, 'label'));
    setIsRendering(true);
    expect(f.value).toBe('b');
    setIsRendering(false);
    expect(runs).toBe(2);
    f.destroy();
  });

  test('outside a tracking frame it is a plain read (no tag creation needed)', () => {
    const row = { label: 'a' };
    expect($__tag(row, 'label')).toBe('a');
  });

  test('never evaluates a lazily-initialized cell in the shared store', () => {
    let evaluated = 0;
    const obj = { k: 1 } as Record<string, number>;
    lazyRawCellFor(obj as any, 'k' as never);
    // replace the lazy init with a counter to observe evaluation
    const lazy = tagFor(obj, 'k') as any;
    lazy.__fn = () => {
      evaluated++;
      return 1;
    };
    trackReads(() => $__tag(obj, 'k'));
    expect(evaluated).toBe(0);
  });

  test('primitive and nullish heads fall back to a plain member read', () => {
    expect($__tag(null, 'x')).toBeUndefined();
    expect($__tag(undefined, 'x')).toBeUndefined();
    expect($__tag('abc', 'length')).toBe(3);
    const { tracker } = trackReads(() => $__tag(5, 'toFixed'));
    expect(tracker.size).toBe(0);
  });
});
