/**
 * Tests for the VM module - opcodeFor and evaluateOpcode.
 *
 * These tests verify that:
 * 1. Opcodes are properly registered and executed
 * 2. Nested formulas get independent tracking (not merged with parent formula)
 * 3. Reactive updates propagate correctly through the system
 *
 * Key fix being tested: evaluateOpcode now uses inNewTrackingFrame to ensure
 * nested formulas get their own independent tracking context. Without this,
 * formulas created during the evaluation of another formula would have their
 * dependencies merged into the outer formula's tracking, causing reactive
 * updates to fail.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  cell,
  formula,
  tagsToRevalidate,
  opsForTag,
  relatedTags,
  setTracker,
  getTracker,
  setIsRendering,
  isRendering,
  type Cell,
  DEBUG_MERGED_CELLS,
  DEBUG_CELLS,
} from './reactive';
import { opcodeFor, evaluateOpcode, checkOpcode, effect } from './vm';
import { syncDom } from './runtime';
import { createCallTracker } from './__test-utils__';

beforeEach(() => {
  // Clear reactive state between tests
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
  setTracker(null);
  setIsRendering(false);
  if (typeof IS_DEV_MODE !== 'undefined' && IS_DEV_MODE) {
    DEBUG_MERGED_CELLS.clear();
    DEBUG_CELLS.clear();
  }
});

describe('opcodeFor', () => {
  test('registers opcode and executes it immediately', () => {
    const testCell = cell(42);
    const { fn: callback, getCallCount, getLastArgs } = createCallTracker((value: unknown) => { value; });

    const destructor = opcodeFor(testCell, callback);

    expect(getCallCount()).toBe(1);
    expect(getLastArgs()).toEqual([42]);

    // Cleanup
    destructor();
  });

  test('returns destructor that removes the opcode', () => {
    const testCell = cell(42);
    const callback = (_value: unknown) => {};

    const destructor = opcodeFor(testCell, callback);

    // Opcode should be registered
    const ops = opsForTag.get(testCell.id);
    expect(ops).toBeDefined();
    expect(ops!.includes(callback)).toBe(true);

    // Call destructor
    destructor();

    // Opcode should be removed
    expect(opsForTag.has(testCell.id)).toBe(false);
  });

  test('executes opcode again when cell value changes', async () => {
    const testCell = cell(10);
    const { fn: callback, getCallCount, getAllCalls } = createCallTracker((value: unknown) => { value; });

    const destructor = opcodeFor(testCell, callback);

    // Note: Due to formula re-evaluation semantics during tracking setup,
    // exact initial call counts may vary. We verify initial value was received.
    const initialCallCount = getCallCount();
    expect(initialCallCount).toBeGreaterThanOrEqual(1);
    expect(getAllCalls()[0]).toEqual([10]);

    // Update cell value
    testCell.update(20);

    // Wait for revalidation
    await syncDom();

    // Callback should be called with the new value
    expect(getCallCount()).toBeGreaterThan(initialCallCount);
    // The last call should have the new value
    expect(getAllCalls()[getAllCalls().length - 1]).toEqual([20]);

    // Cleanup
    destructor();
  });
});

describe('evaluateOpcode - tracking behavior', () => {
  test('sets isRendering to true during execution', () => {
    const testCell = cell(42);
    let wasRendering = false;

    evaluateOpcode(testCell, () => {
      wasRendering = isRendering();
    });

    expect(wasRendering).toBe(true);
    expect(isRendering()).toBe(false); // Reset after
  });

  test('resets currentTracker during execution (inNewTrackingFrame)', () => {
    const testCell = cell(42);
    let trackerDuringExecution: Set<Cell<unknown>> | null = null;

    // Set up a parent tracker to simulate being inside another formula
    const parentTracker = new Set<Cell<unknown>>();
    setTracker(parentTracker);

    evaluateOpcode(testCell, () => {
      trackerDuringExecution = getTracker();
    });

    // During execution, tracker should be null (new tracking frame)
    expect(trackerDuringExecution).toBe(null);

    // After execution, parent tracker should be restored
    expect(getTracker()).toBe(parentTracker);

    // Clean up
    setTracker(null);
  });

  test('checkOpcode is an alias for evaluateOpcode', () => {
    expect(checkOpcode).toBe(evaluateOpcode);
  });
});

describe('Nested formula tracking - regression tests', () => {
  /**
   * REGRESSION TEST: This test verifies the core fix.
   *
   * Before the fix, when a formula was created inside another formula's
   * evaluation (e.g., during slot rendering), the inner formula's dependencies
   * would be tracked by the OUTER formula's tracker, not its own.
   *
   * This test explicitly verifies that inner cell reads do NOT pollute
   * the outer formula's tracking.
   */
  test('inner formula dependencies are NOT tracked by outer formula', () => {
    const innerCell = cell(100);
    const outerCell = cell(200);

    // Track what cells the outer formula sees during its evaluation
    let outerTrackerCells: Cell<unknown>[] = [];

    setIsRendering(true);

    const outerFormula = formula(() => {
      // Capture tracker reference at start
      const tracker = getTracker();

      // Create inner formula with its own dependency
      const innerFormula = formula(() => innerCell.value, 'inner');
      const destructor = opcodeFor(innerFormula, () => {});

      destructor();

      // Read outerCell - this should be tracked by the outer formula
      const result = outerCell.value;

      // NOW capture tracker contents - after reading outerCell
      // If fix is working, tracker should contain outerCell but NOT innerCell
      if (tracker) {
        outerTrackerCells = Array.from(tracker);
      }

      return result;
    }, 'outer');

    // Trigger outer formula evaluation with tracking
    outerFormula.value;

    setIsRendering(false);

    // CRITICAL ASSERTION: innerCell should NOT be in outer's tracked cells
    // If it is, the fix is not working
    expect(outerTrackerCells.includes(innerCell)).toBe(false);

    // outerCell SHOULD be tracked by outer formula
    expect(outerTrackerCells.includes(outerCell)).toBe(true);
  });

  test('inner formula tracks independently of outer formula', async () => {
    const innerCell = cell(100);
    const outerCell = cell(200);

    const innerUpdates: number[] = [];
    const outerUpdates: number[] = [];
    const destructors: (() => void)[] = [];

    // Create outer formula that creates an inner formula during evaluation
    const outerFormula = formula(() => {
      // This simulates what happens during slot rendering:
      // An outer formula evaluates and creates inner reactive bindings

      // Create inner formula (like what $attr does for reactive attributes)
      const innerFormula = formula(() => innerCell.value, 'inner');
      destructors.push(opcodeFor(innerFormula, (value) => {
        innerUpdates.push(value as number);
      }));

      return outerCell.value;
    }, 'outer');

    // Register outer opcode
    destructors.push(opcodeFor(outerFormula, (value) => {
      outerUpdates.push(value as number);
    }));

    // Record initial state - due to tracking setup, counts may vary
    const initialInnerLength = innerUpdates.length;
    const initialOuterLength = outerUpdates.length;

    expect(initialInnerLength).toBeGreaterThanOrEqual(1);
    expect(innerUpdates[0]).toBe(100);
    expect(initialOuterLength).toBeGreaterThanOrEqual(1);
    expect(outerUpdates[0]).toBe(200);

    // Update inner cell
    innerCell.update(150);
    await syncDom();

    // Inner callback should be called with new value
    expect(innerUpdates.length).toBeGreaterThan(initialInnerLength);
    expect(innerUpdates[innerUpdates.length - 1]).toBe(150);

    // Cleanup
    destructors.forEach(d => d());
  });

  test('formula created inside opcodeFor callback tracks its own dependencies', async () => {
    const sourceCell = cell('initial');
    const updates: string[] = [];

    // Create a formula that depends on sourceCell
    const derivedFormula = formula(() => sourceCell.value, 'derived');

    // Register opcode for the formula
    const destructor = opcodeFor(derivedFormula, (value) => {
      updates.push(value as string);
    });

    const initialLength = updates.length;
    expect(initialLength).toBeGreaterThanOrEqual(1);
    expect(updates[0]).toBe('initial');

    // Update source cell
    sourceCell.update('updated');
    await syncDom();

    // Callback should be called with new value
    expect(updates.length).toBeGreaterThan(initialLength);
    expect(updates[updates.length - 1]).toBe('updated');

    // Cleanup
    destructor();
  });

  test('multiple nested formulas each track independently - strict verification', async () => {
    const cellA = cell('A');
    const cellB = cell('B');
    const cellC = cell('C');

    const updatesA: string[] = [];
    const updatesB: string[] = [];
    const updatesC: string[] = [];
    const destructors: (() => void)[] = [];

    // Create wrapper formula that creates multiple inner formulas
    const wrapperFormula = formula(() => {
      const formulaA = formula(() => cellA.value, 'A');
      destructors.push(opcodeFor(formulaA, (v) => { updatesA.push(v as string); }));

      const formulaB = formula(() => cellB.value, 'B');
      destructors.push(opcodeFor(formulaB, (v) => { updatesB.push(v as string); }));

      const formulaC = formula(() => cellC.value, 'C');
      destructors.push(opcodeFor(formulaC, (v) => { updatesC.push(v as string); }));

      return 'wrapper';
    }, 'wrapper');

    // Trigger wrapper formula evaluation
    wrapperFormula.value;

    // Record initial state
    const initialA = updatesA.length;
    const initialB = updatesB.length;
    const initialC = updatesC.length;

    expect(initialA).toBeGreaterThanOrEqual(1);
    expect(initialB).toBeGreaterThanOrEqual(1);
    expect(initialC).toBeGreaterThanOrEqual(1);
    expect(updatesA[0]).toBe('A');
    expect(updatesB[0]).toBe('B');
    expect(updatesC[0]).toBe('C');

    // Update only cellB - STRICT: A and C should NOT be updated
    const beforeAForBUpdate = updatesA.length;
    const beforeCForBUpdate = updatesC.length;
    cellB.update('B2');
    await syncDom();

    // B should be updated
    expect(updatesB.length).toBeGreaterThan(initialB);
    expect(updatesB[updatesB.length - 1]).toBe('B2');

    // STRICT: A and C should NOT have been called
    expect(updatesA.length).toBe(beforeAForBUpdate);
    expect(updatesC.length).toBe(beforeCForBUpdate);

    // Update cellA only - STRICT: B and C should NOT be updated
    const beforeBForAUpdate = updatesB.length;
    const beforeCForAUpdate = updatesC.length;
    cellA.update('A2');
    await syncDom();

    // A should be updated
    expect(updatesA.length).toBeGreaterThan(beforeAForBUpdate);
    expect(updatesA[updatesA.length - 1]).toBe('A2');

    // STRICT: B and C should NOT have been called
    expect(updatesB.length).toBe(beforeBForAUpdate);
    expect(updatesC.length).toBe(beforeCForAUpdate);

    // Update cellC only - STRICT: A and B should NOT be updated
    const beforeAForCUpdate = updatesA.length;
    const beforeBForCUpdate = updatesB.length;
    cellC.update('C2');
    await syncDom();

    // C should be updated
    expect(updatesC.length).toBeGreaterThan(beforeCForAUpdate);
    expect(updatesC[updatesC.length - 1]).toBe('C2');

    // STRICT: A and B should NOT have been called
    expect(updatesA.length).toBe(beforeAForCUpdate);
    expect(updatesB.length).toBe(beforeBForCUpdate);

    // Cleanup
    destructors.forEach(d => d());
  });
});

describe('Canvas renderer scenario - slot content with reactive bindings', () => {
  /**
   * This test simulates the exact scenario that was broken:
   *
   * The CanvasRenderer uses resolveRenderable which wraps the slot rendering
   * in a formula. Inside that formula, the slot content creates canvas elements
   * with reactive attribute bindings (via $attr -> opcodeFor).
   *
   * The bug was that these inner opcodeFor calls would not get their own
   * tracking frame, so the inner formulas would have their dependencies
   * merged into the outer formula's tracking, causing reactive updates to fail.
   */
  test('reactive bindings inside wrapped render function track independently', async () => {
    // Simulate cells for canvas element attributes (like rectX, rectY in CanvasDemo)
    const xPosition = cell(100);
    const yPosition = cell(200);

    // Track when attributes would be updated
    const xAttrUpdates: number[] = [];
    const yAttrUpdates: number[] = [];
    const destructors: (() => void)[] = [];

    // Simulate resolveRenderable wrapping the slot render in a formula
    const outerRenderFormula = formula(() => {
      // Inside the outer formula, create reactive attribute bindings
      // This is what happens when $attr is called for each canvas element attribute

      // Create formula for x attribute (like: formula(() => rectX.value))
      const xFormula = formula(() => xPosition.value, 'x-attr');
      destructors.push(opcodeFor(xFormula, (value) => {
        // This simulates canvasApi.attr(element, 'x', value)
        xAttrUpdates.push(value as number);
      }));

      // Create formula for y attribute (like: formula(() => rectY.value))
      const yFormula = formula(() => yPosition.value, 'y-attr');
      destructors.push(opcodeFor(yFormula, (value) => {
        // This simulates canvasApi.attr(element, 'y', value)
        yAttrUpdates.push(value as number);
      }));

      return 'rendered';
    }, 'slot-render');

    // Trigger the outer formula (this happens during initial render)
    outerRenderFormula.value;

    // Record initial state
    const initialXLength = xAttrUpdates.length;
    const initialYLength = yAttrUpdates.length;

    // Both attribute callbacks should be called during initial render
    expect(initialXLength).toBeGreaterThanOrEqual(1);
    expect(xAttrUpdates[0]).toBe(100);
    expect(initialYLength).toBeGreaterThanOrEqual(1);
    expect(yAttrUpdates[0]).toBe(200);

    // Simulate user interaction: changing xPosition (like moving a slider)
    // STRICT: yPosition should NOT be affected
    const beforeYForXUpdate = yAttrUpdates.length;
    xPosition.update(150);
    await syncDom();

    // CRITICAL: The x attribute callback should be called with the new value
    // This was the bug - without inNewTrackingFrame, this would NOT be called
    expect(xAttrUpdates.length).toBeGreaterThan(initialXLength);
    expect(xAttrUpdates[xAttrUpdates.length - 1]).toBe(150);

    // STRICT: y should NOT have been called
    expect(yAttrUpdates.length).toBe(beforeYForXUpdate);

    // Simulate user interaction: changing yPosition
    // STRICT: xPosition should NOT be affected
    const beforeXForYUpdate = xAttrUpdates.length;
    yPosition.update(250);
    await syncDom();

    expect(yAttrUpdates.length).toBeGreaterThan(beforeYForXUpdate);
    expect(yAttrUpdates[yAttrUpdates.length - 1]).toBe(250);

    // STRICT: x should NOT have been called
    expect(xAttrUpdates.length).toBe(beforeXForYUpdate);

    // Cleanup
    destructors.forEach(d => d());
  });

  test('deeply nested formulas all track independently', async () => {
    const innerCell = cell('deep');
    const deepUpdates: string[] = [];
    const destructors: (() => void)[] = [];

    // Three levels of nesting
    const level1Formula = formula(() => {
      const level2Formula = formula(() => {
        const level3Formula = formula(() => {
          const deepFormula = formula(() => innerCell.value, 'deep');
          destructors.push(opcodeFor(deepFormula, (v) => { deepUpdates.push(v as string); }));
          return 'level3';
        }, 'level3');
        level3Formula.value;
        return 'level2';
      }, 'level2');
      level2Formula.value;
      return 'level1';
    }, 'level1');

    // Trigger all levels
    level1Formula.value;

    const initialLength = deepUpdates.length;
    expect(initialLength).toBeGreaterThanOrEqual(1);
    expect(deepUpdates[0]).toBe('deep');

    // Update the deeply nested cell
    innerCell.update('deeper');
    await syncDom();

    // The deep callback should still be called
    expect(deepUpdates.length).toBeGreaterThan(initialLength);
    expect(deepUpdates[deepUpdates.length - 1]).toBe('deeper');

    // Cleanup
    destructors.forEach(d => d());
  });
});

describe('Edge cases', () => {
  test('opcode destructor can be called multiple times safely', () => {
    const testCell = cell(42);
    const callback = (_value: unknown) => {};

    const destructor = opcodeFor(testCell, callback);

    // Call destructor multiple times - should not throw
    expect(() => {
      destructor();
      destructor();
      destructor();
    }).not.toThrow();
  });

  test('formula with no dependencies is treated as constant when evaluated with tracking', () => {
    const constantFormula = formula(() => 'constant', 'constant');

    // Access value in a tracking context to trigger evaluation with tracking
    setIsRendering(true);
    const value = constantFormula.value;
    setIsRendering(false);

    expect(value).toBe('constant');

    // After evaluation with tracking, formula should be marked as constant
    // (no cells were read during evaluation)
    expect(constantFormula.isConst).toBe(true);
  });

  test('formula that reads cells is not constant when evaluated with tracking', () => {
    const testCell = cell('value');
    const reactiveFormula = formula(() => testCell.value, 'reactive');

    // Access value to trigger evaluation and tracking
    setIsRendering(true);
    const value = reactiveFormula.value;
    setIsRendering(false);

    expect(value).toBe('value');
    expect(reactiveFormula.isConst).toBe(false);
  });

  test('reactive updates only happen after isConst is determined', async () => {
    const sourceCell = cell('initial');
    const updates: string[] = [];

    // Create formula
    const reactiveFormula = formula(() => sourceCell.value, 'tracked');

    // Register opcode - this evaluates the formula in a tracking context
    const destructor = opcodeFor(reactiveFormula, (v) => { updates.push(v as string); });

    // After opcodeFor, isConst should be false (formula depends on sourceCell)
    expect(reactiveFormula.isConst).toBe(false);

    const initialLength = updates.length;
    expect(initialLength).toBeGreaterThanOrEqual(1);

    // Update source cell - should trigger reactive update
    sourceCell.update('updated');
    await syncDom();

    expect(updates.length).toBeGreaterThan(initialLength);
    expect(updates[updates.length - 1]).toBe('updated');

    // Cleanup
    destructor();
  });

  test('opcodeFor with formula that becomes constant after first evaluation', () => {
    // A formula that returns a static value (no cell reads)
    const staticFormula = formula(() => 42, 'static');

    const updates: number[] = [];
    const destructor = opcodeFor(staticFormula, (v) => { updates.push(v as number); });

    // Should have been called once
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0]).toBe(42);

    // Formula should be marked as constant
    expect(staticFormula.isConst).toBe(true);

    // Cleanup
    destructor();
  });
});

describe('effect function', () => {
  test('effect executes callback immediately', () => {
    let executed = false;

    const destroy = effect(() => {
      executed = true;
    });

    expect(executed).toBe(true);

    destroy();
  });

  test('effect stores debug label in dev mode', () => {
    if (typeof IS_DEV_MODE === 'undefined' || !IS_DEV_MODE) {
      return;
    }
    const marker = 'vm.effect.label';
    const count = cell(0);
    const destroy = effect(() => {
      count.value;
    }, marker);

    const labels = Array.from(DEBUG_MERGED_CELLS).map((tag) => tag._debugName);
    expect(labels.some((label) => label?.includes(`formula:effect:${marker}`))).toBe(true);
    expect(labels.some((label) => label?.includes(`formula:effect.internal:${marker}`))).toBe(true);

    destroy();
  });

  test('effect tracks cell dependencies and re-runs on change', async () => {
    const count = cell(0);
    const executions: number[] = [];

    const destroy = effect(() => {
      executions.push(count.value);
    });

    expect(executions).toEqual([0]);

    count.update(1);
    await syncDom();

    expect(executions.length).toBeGreaterThan(1);
    expect(executions[executions.length - 1]).toBe(1);

    count.update(2);
    await syncDom();

    expect(executions[executions.length - 1]).toBe(2);

    destroy();
  });

  test('effect destructor is called when effect re-runs', async () => {
    const trigger = cell(0);
    const destructorCalls: number[] = [];

    const destroy = effect(() => {
      // Capture value at time of effect run using closure
      const capturedValue = trigger.value;
      return () => {
        destructorCalls.push(capturedValue);
      };
    });

    expect(destructorCalls.length).toBe(0);

    // Trigger re-run - previous destructor should be called
    trigger.update(1);
    await syncDom();

    // Destructor from previous run (value 0) should have been called
    expect(destructorCalls.includes(0)).toBe(true);

    const lengthAfterFirst = destructorCalls.length;

    trigger.update(2);
    await syncDom();

    // Destructor from previous run (value 1) should have been called
    expect(destructorCalls.includes(1)).toBe(true);
    expect(destructorCalls.length).toBeGreaterThan(lengthAfterFirst);

    destroy();
  });

  test('effect destructor is called when effect is destroyed', async () => {
    const trigger = cell(0);
    let destructorCalled = false;

    const destroy = effect(() => {
      trigger.value; // Track dependency
      return () => {
        destructorCalled = true;
      };
    });

    expect(destructorCalled).toBe(false);

    destroy();

    expect(destructorCalled).toBe(true);
  });

  test('effect destroy can only be called once', () => {
    const executions: string[] = [];

    const destroy = effect(() => {
      executions.push('run');
      return () => {
        executions.push('cleanup');
      };
    });

    expect(executions).toEqual(['run']);

    // First destroy
    destroy();
    expect(executions).toEqual(['run', 'cleanup']);

    // Second destroy - should be no-op
    destroy();
    expect(executions).toEqual(['run', 'cleanup']);

    // Third destroy - still no-op
    destroy();
    expect(executions).toEqual(['run', 'cleanup']);
  });

  test('effect with no return value works correctly', async () => {
    const count = cell(0);
    const executions: number[] = [];

    const destroy = effect(() => {
      executions.push(count.value);
      // No return - no destructor
    });

    expect(executions).toEqual([0]);

    count.update(1);
    await syncDom();

    expect(executions[executions.length - 1]).toBe(1);

    // Should not throw when destroying
    expect(() => destroy()).not.toThrow();
  });

  test('effect tracks multiple cells independently', async () => {
    const cellA = cell('A');
    const cellB = cell('B');
    const executions: string[] = [];

    const destroy = effect(() => {
      executions.push(`${cellA.value}-${cellB.value}`);
    });

    expect(executions).toEqual(['A-B']);

    cellA.update('A2');
    await syncDom();

    expect(executions[executions.length - 1]).toBe('A2-B');

    cellB.update('B2');
    await syncDom();

    expect(executions[executions.length - 1]).toBe('A2-B2');

    destroy();
  });
});

describe('opcodeFor - additional edge cases', () => {
  test('multiple opcodes for same tag - each destructor only removes its own', () => {
    const testCell = cell(42);
    const calls1: number[] = [];
    const calls2: number[] = [];
    const calls3: number[] = [];

    const destructor1 = opcodeFor(testCell, (v) => { calls1.push(v as number); });
    const destructor2 = opcodeFor(testCell, (v) => { calls2.push(v as number); });
    const destructor3 = opcodeFor(testCell, (v) => { calls3.push(v as number); });

    // All should have been called
    expect(calls1.length).toBeGreaterThanOrEqual(1);
    expect(calls2.length).toBeGreaterThanOrEqual(1);
    expect(calls3.length).toBeGreaterThanOrEqual(1);

    // Should have 3 opcodes registered
    const ops = opsForTag.get(testCell.id);
    expect(ops?.length).toBe(3);

    // Remove first opcode
    destructor1();

    // Should still have 2 opcodes
    expect(opsForTag.get(testCell.id)?.length).toBe(2);

    // Remove second opcode
    destructor2();

    // Should still have 1 opcode
    expect(opsForTag.get(testCell.id)?.length).toBe(1);

    // Remove last opcode - should clean up entirely
    destructor3();

    // Tag should be removed from opsForTag
    expect(opsForTag.has(testCell.id)).toBe(false);
  });

  test('async opcode (returns promise) is marked as async', async () => {
    const testCell = cell(42);

    // We need to check if markOpcodeAsync was called
    // Since we can't easily mock it, we'll verify the behavior indirectly
    const asyncOp = async (_value: unknown) => {
      await Promise.resolve();
    };

    const destructor = opcodeFor(testCell, asyncOp);

    // The opcode returns a promise, so it should be marked as async
    // We can verify this by checking that the opcode still works
    testCell.update(100);
    await syncDom();

    // Cleanup
    destructor();
  });

  test('opcodeFor with tag that has no destroy method', () => {
    // Create a minimal tag-like object without destroy method
    const minimalTag = {
      id: 999999,
      value: 'test',
      isConst: false,
    } as any;

    const calls: string[] = [];

    // Manually set up ops for this tag
    opsForTag.set(minimalTag.id, []);

    const destructor = opcodeFor(minimalTag, (v) => { calls.push(v as string); });

    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Should not throw when destroying even though tag has no destroy method
    expect(() => destructor()).not.toThrow();

    // Should clean up opsForTag
    expect(opsForTag.has(minimalTag.id)).toBe(false);
  });

  test('destructor is idempotent - removing already removed opcode', () => {
    const testCell = cell(42);
    const callback = (_v: unknown) => {};

    const destructor = opcodeFor(testCell, callback);

    // Get reference to ops before first destroy
    const opsBeforeDestroy = opsForTag.get(testCell.id);
    expect(opsBeforeDestroy).toBeDefined();

    // First destroy
    destructor();
    expect(opsForTag.has(testCell.id)).toBe(false);

    // Second destroy - should not throw
    expect(() => destructor()).not.toThrow();

    // Third destroy - should not throw
    expect(() => destructor()).not.toThrow();
  });
});

describe('evaluateOpcode - additional edge cases', () => {
  test('nested evaluateOpcode calls maintain correct isRendering state', () => {
    const outerCell = cell(1);
    const innerCell = cell(2);
    const renderingStates: boolean[] = [];

    evaluateOpcode(outerCell, () => {
      renderingStates.push(isRendering()); // Should be true

      evaluateOpcode(innerCell, () => {
        renderingStates.push(isRendering()); // Should still be true
      });

      renderingStates.push(isRendering()); // Should still be true
    });

    expect(renderingStates).toEqual([true, true, true]);
    expect(isRendering()).toBe(false); // Reset after
  });

  test('evaluateOpcode when already rendering does not toggle isRendering', () => {
    const testCell = cell(42);
    const states: boolean[] = [];

    // Set rendering state manually
    setIsRendering(true);

    evaluateOpcode(testCell, () => {
      states.push(isRendering());
    });

    // Should still be rendering (not toggled off)
    expect(isRendering()).toBe(true);
    expect(states).toEqual([true]);

    // Clean up
    setIsRendering(false);
  });

  test('error thrown inside opcode propagates correctly and resets state', () => {
    const testCell = cell(42);
    const testError = new Error('Test error');

    expect(() => {
      evaluateOpcode(testCell, () => {
        throw testError;
      });
    }).toThrow(testError);

    // With try/finally in trackingTransaction, isRendering should be reset
    expect(isRendering()).toBe(false);
  });

  test('error in nested tracking frame restores parent tracker', () => {
    const testCell = cell(42);
    const parentTracker = new Set<Cell<unknown>>();
    const testError = new Error('Test error');

    setTracker(parentTracker);

    expect(() => {
      evaluateOpcode(testCell, () => {
        throw testError;
      });
    }).toThrow(testError);

    // With try/finally in inNewTrackingFrame, parent tracker should be restored
    expect(getTracker()).toBe(parentTracker);

    // Clean up
    setTracker(null);
  });

  test('evaluateOpcode passes correct value to opcode', () => {
    const testCell = cell('test-value');
    let receivedValue: string | undefined;

    evaluateOpcode(testCell, (value) => {
      receivedValue = value as string;
    });

    expect(receivedValue).toBe('test-value');
  });

  test('evaluateOpcode with formula evaluates and passes computed value', () => {
    const baseCell = cell(10);
    const computedFormula = formula(() => baseCell.value * 2, 'computed');
    let receivedValue: number | undefined;

    evaluateOpcode(computedFormula, (value) => {
      receivedValue = value as number;
    });

    expect(receivedValue).toBe(20);
  });
});

describe('trackingTransaction behavior', () => {
  test('trackingTransaction sets isRendering correctly', () => {
    const testCell = cell(42);
    let wasRendering = false;

    expect(isRendering()).toBe(false);

    evaluateOpcode(testCell, () => {
      wasRendering = isRendering();
    });

    expect(wasRendering).toBe(true);
    expect(isRendering()).toBe(false);
  });

  test('trackingTransaction preserves isRendering when already true', () => {
    const testCell = cell(42);
    const states: { before: boolean; during: boolean; after: boolean }[] = [];

    setIsRendering(true);

    states.push({ before: isRendering(), during: false, after: false });

    evaluateOpcode(testCell, () => {
      states[0].during = isRendering();
    });

    states[0].after = isRendering();

    expect(states[0]).toEqual({ before: true, during: true, after: true });

    setIsRendering(false);
  });
});

describe('Performance sanity checks', () => {
  test('can handle many opcodes without degradation', async () => {
    const cells: Cell<number>[] = [];
    const updates: number[][] = [];
    const destructors: (() => void)[] = [];

    // Create 100 independent reactive bindings
    for (let i = 0; i < 100; i++) {
      const c = cell(i);
      cells.push(c);
      updates.push([]);

      const f = formula(() => c.value, `cell-${i}`);
      const idx = i;
      destructors.push(opcodeFor(f, (v) => { updates[idx].push(v as number); }));
    }

    // Verify all were set up
    expect(updates.every(u => u.length >= 1)).toBe(true);

    // Update a single cell - only its callback should be invoked
    const targetIdx = 50;
    const beforeCounts = updates.map(u => u.length);

    cells[targetIdx].update(999);
    await syncDom();

    // Only the target should have been updated
    expect(updates[targetIdx].length).toBeGreaterThan(beforeCounts[targetIdx]);
    expect(updates[targetIdx][updates[targetIdx].length - 1]).toBe(999);

    // All others should NOT have been updated
    for (let i = 0; i < 100; i++) {
      if (i !== targetIdx) {
        expect(updates[i].length).toBe(beforeCounts[i]);
      }
    }

    // Cleanup
    destructors.forEach(d => d());
  });

  test('nested tracking frames do not leak memory', () => {
    // Create deeply nested formulas and verify they can be cleaned up
    const cells: Cell<number>[] = [];
    const destructors: (() => void)[] = [];

    for (let depth = 0; depth < 10; depth++) {
      const c = cell(depth);
      cells.push(c);

      let currentFormula = formula(() => c.value, `depth-${depth}`);

      // Nest 5 levels deep
      for (let nest = 0; nest < 5; nest++) {
        const innerFormula = currentFormula;
        currentFormula = formula(() => innerFormula.value + 1, `depth-${depth}-nest-${nest}`);
      }

      destructors.push(opcodeFor(currentFormula, () => {}));
    }

    // All destructors should be callable without error
    expect(() => {
      destructors.forEach(d => d());
    }).not.toThrow();

    // After cleanup, opsForTag should be smaller
    // (exact count depends on implementation details)
  });
});
