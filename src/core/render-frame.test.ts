/**
 * Ember native runtime: a render that starts inside a tracking frame is
 * consumed by that frame (Glimmer parity — the VM consumes every reference a
 * render reads into the current frame, so a `renderComponent` called inside a
 * `@cached` getter makes the getter depend on what the render read). gxt
 * evaluates each binding in an isolated frame; `evaluateOpcode` forwards the
 * binding's dependencies to the frame the render runs in, including the
 * bindings of blocks an opcode renders. Standalone gxt / the compat bridge
 * (no native runtime registered) keep bindings isolated.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { cell, formula, getTracker, setTracker, type Cell } from './reactive';
import { opcodeFor, opcodeForValue } from './vm';
import { setNativeContentBinding } from './native-content';
import { bindNativeContent } from './dom';

function inFrame(fn: () => void): Set<Cell> {
  const previous = getTracker();
  const frame = new Set<Cell>();
  setTracker(frame);
  try {
    fn();
  } finally {
    setTracker(previous);
  }
  return frame;
}

describe('render frame (native runtime)', () => {
  afterEach(() => {
    setNativeContentBinding(null);
  });

  test('a binding evaluated inside a frame forwards its dependencies to it', () => {
    setNativeContentBinding(bindNativeContent);
    const a = cell(1);
    const b = cell(2);
    const f = formula(() => (a.value as number) + (b.value as number));
    let seen: unknown;
    const frame = inFrame(() => {
      opcodeFor(f, (value) => {
        seen = value;
      });
    });
    expect(seen).toBe(3);
    expect(frame.has(a)).toBe(true);
    expect(frame.has(b)).toBe(true);
    // the binding still tracked its own dependencies (isolation intact)
    expect(f.relatedCells?.has(a)).toBe(true);
    expect(f.relatedCells?.has(b)).toBe(true);
    // and the tracker is restored
    expect(getTracker()).toBe(null);
  });

  test('a plain cell binding forwards the cell', () => {
    setNativeContentBinding(bindNativeContent);
    const a = cell('x');
    const frame = inFrame(() => {
      opcodeFor(a, () => {});
    });
    expect(frame.has(a)).toBe(true);
  });

  test('bindings of blocks an opcode renders (no tracker) forward to the same frame', () => {
    setNativeContentBinding(bindNativeContent);
    const a = cell(1);
    const b = cell(2);
    const c = cell(3);
    const outer = formula(() => a.value);
    const frame = inFrame(() => {
      opcodeFor(outer, () => {
        expect(getTracker()).toBe(null);
        opcodeFor(
          formula(() => b.value),
          () => {
            opcodeFor(
              formula(() => c.value),
              () => {},
            );
          },
        );
      });
    });
    expect([frame.has(a), frame.has(b), frame.has(c)]).toEqual([
      true,
      true,
      true,
    ]);
  });

  test('what an opcodeForValue op renders belongs to the frame', () => {
    setNativeContentBinding(bindNativeContent);
    const b = cell(2);
    const f = formula(() => 1);
    const frame = inFrame(() => {
      opcodeForValue(
        f,
        () => {
          opcodeFor(
            formula(() => b.value),
            () => {},
          );
        },
        1,
      );
    });
    expect(frame.has(b)).toBe(true);
  });

  test('a formula that renders depends on what its render read', () => {
    setNativeContentBinding(bindNativeContent);
    const a = cell(1);
    const b = cell(2);
    // `{{render-helper}}`: the binding's formula renders a nested binding
    const helper = formula(() => {
      opcodeFor(
        formula(() => b.value),
        () => {},
      );
      return a.value;
    });
    opcodeFor(helper, () => {});
    expect(helper.relatedCells?.has(a)).toBe(true);
    expect(helper.relatedCells?.has(b)).toBe(true);
  });

  test('outside a frame nothing is forwarded', () => {
    setNativeContentBinding(bindNativeContent);
    const a = cell(1);
    const f = formula(() => a.value);
    opcodeFor(f, () => {});
    expect(getTracker()).toBe(null);
    expect(f.relatedCells?.has(a)).toBe(true);
  });

  test('without the native runtime a binding stays isolated', () => {
    const a = cell(1);
    const b = cell(2);
    const frame = inFrame(() => {
      opcodeFor(
        formula(() => a.value),
        () => {
          opcodeFor(
            formula(() => b.value),
            () => {},
          );
        },
      );
    });
    expect(frame.size).toBe(0);
  });
});
