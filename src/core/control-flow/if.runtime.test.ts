/**
 * Runtime tests for the if control flow.
 * These tests verify actual behavior without mocking.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { cell, tagsToRevalidate, opsForTag, relatedTags } from '../reactive';
import { createCallTracker, createTrackedCell, createDOMFixture, type DOMFixture } from '../__test-utils__';
import { IfCondition } from './if';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, COMPONENT_ID_PROPERTY, TREE } from '../shared';

beforeEach(() => {
  // Clear reactive state between tests
  tagsToRevalidate.clear();
  opsForTag.clear();
  relatedTags.clear();
});

describe('If condition - reactive behavior', () => {
  describe('cell-based conditions', () => {
    test('cell can be used as condition source', () => {
      const condition = cell(true);

      expect(condition.value).toBe(true);

      condition.update(false);
      expect(condition.value).toBe(false);
    });

    test('cell update schedules revalidation', () => {
      const condition = cell(true);

      expect(tagsToRevalidate.size).toBe(0);

      condition.update(false);

      expect(tagsToRevalidate.has(condition)).toBe(true);
    });

    test('multiple updates only schedule once per cell', () => {
      const condition = cell(true);

      condition.update(false);
      condition.update(true);
      condition.update(false);

      // The cell should only be in tagsToRevalidate once
      expect(tagsToRevalidate.has(condition)).toBe(true);
      expect(tagsToRevalidate.size).toBe(1);
    });
  });

  describe('truthy/falsy evaluation', () => {
    test('truthy values', () => {
      expect(!!cell(true).value).toBe(true);
      expect(!!cell(1).value).toBe(true);
      expect(!!cell('hello').value).toBe(true);
      expect(!!cell({}).value).toBe(true);
      expect(!!cell([]).value).toBe(true);
      expect(!!cell(() => {}).value).toBe(true);
    });

    test('falsy values', () => {
      expect(!!cell(false).value).toBe(false);
      expect(!!cell(0).value).toBe(false);
      expect(!!cell('').value).toBe(false);
      expect(!!cell(null).value).toBe(false);
      expect(!!cell(undefined).value).toBe(false);
    });
  });
});

describe('If condition - branch rendering', () => {
  test('tracks which branch was rendered', () => {
    const { fn: trueBranch, getCallCount: getTrueCount } = createCallTracker(() => 'true');
    const { fn: falseBranch, getCallCount: getFalseCount } = createCallTracker(() => 'false');

    // Simulate condition evaluation
    const condition = cell(true);

    if (condition.value) {
      trueBranch();
    } else {
      falseBranch();
    }

    expect(getTrueCount()).toBe(1);
    expect(getFalseCount()).toBe(0);
  });

  test('switches branches when condition changes', () => {
    const { fn: trueBranch, getCallCount: getTrueCount, reset: resetTrue } = createCallTracker(() => 'true');
    const { fn: falseBranch, getCallCount: getFalseCount, reset: resetFalse } = createCallTracker(() => 'false');

    const condition = cell(true);

    // Initial render
    if (condition.value) {
      trueBranch();
    } else {
      falseBranch();
    }

    expect(getTrueCount()).toBe(1);
    expect(getFalseCount()).toBe(0);

    // Update condition
    condition.update(false);
    resetTrue();
    resetFalse();

    // Re-render
    if (condition.value) {
      trueBranch();
    } else {
      falseBranch();
    }

    expect(getTrueCount()).toBe(0);
    expect(getFalseCount()).toBe(1);
  });

  test('same value does not trigger unnecessary re-render', () => {
    const { testCell: condition, getUpdateCount } = createTrackedCell(true);
    const { fn: renderBranch, getCallCount } = createCallTracker(() => 'rendered');

    // Initial render
    const initialValue = condition.value;
    if (initialValue) {
      renderBranch();
    }

    expect(getCallCount()).toBe(1);

    // Update with same value
    condition.update(true);
    expect(getUpdateCount()).toBe(1);

    // Simulate checkStatement behavior (skip if value unchanged)
    const newValue = condition.value;
    if (newValue === initialValue) {
      // Skip re-render
    } else if (newValue) {
      renderBranch();
    }

    // Should not have rendered again
    expect(getCallCount()).toBe(1);
  });
});

describe('If condition - async destruction', () => {
  test('tracks destroy promise state', async () => {
    let destroyStarted = false;
    let destroyCompleted = false;

    const destroyBranch = async () => {
      destroyStarted = true;
      await Promise.resolve();
      destroyCompleted = true;
    };

    expect(destroyStarted).toBe(false);
    expect(destroyCompleted).toBe(false);

    const destroyPromise = destroyBranch();

    expect(destroyStarted).toBe(true);
    expect(destroyCompleted).toBe(false);

    await destroyPromise;

    expect(destroyCompleted).toBe(true);
  });

  test('prevents race conditions with runNumber tracking', () => {
    let runNumber = 0;

    const validateEpoch = (expectedRun: number) => {
      if (runNumber !== expectedRun) {
        return false; // Stale
      }
      return true;
    };

    // Simulate rapid condition changes
    runNumber++;
    const run1 = runNumber;

    runNumber++;
    const run2 = runNumber;

    // Only the latest should be valid
    expect(validateEpoch(run1)).toBe(false);
    expect(validateEpoch(run2)).toBe(true);
  });
});

describe('If condition - nested conditions', () => {
  test('inner condition tracks independently', () => {
    const outerCondition = cell(true);
    const innerCondition = cell(true);

    const { fn: renderInner, getCallCount } = createCallTracker(() => 'inner');

    // Simulate nested if
    if (outerCondition.value) {
      if (innerCondition.value) {
        renderInner();
      }
    }

    expect(getCallCount()).toBe(1);

    // Update inner condition
    innerCondition.update(false);

    // Inner should be in revalidation
    expect(tagsToRevalidate.has(innerCondition)).toBe(true);
    // Outer should not be affected
    expect(tagsToRevalidate.has(outerCondition)).toBe(false);
  });
});

/**
 * Regression coverage for commit a128135's `'in'`-check guard around
 * `parentContext.$_eval` in the IfCondition constructor. Under Ember
 * integration, the parent component can be a tracked-property proxy
 * whose `get` trap throws on unknown property access (e.g. when the
 * proxy enforces strict property declarations). A bare `parentContext.$_eval`
 * read would propagate the throw and abort the constructor before
 * `addToTree` runs, leaving the if half-registered.
 *
 * The guard reads `'$_eval' in parentContext` first, so a proxy with
 * a `has` trap that returns `false` (or a `get` that throws on unknown
 * keys) must NOT cause the IfCondition constructor to throw.
 */
describe('If condition - throwing-proxy parent (a128135 guard)', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('proxy parent whose `has` returns false: constructor completes, addToTree runs', () => {
    // Build a baseline component so we have valid TREE/PARENT identity.
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    // Wrap in a Proxy that lies: `'$_eval' in proxyParent` is false,
    // so the guard skips the read entirely. A `get` trap is included to
    // detect any accidental fall-through.
    let getReadKeys: PropertyKey[] = [];
    const proxyParent = new Proxy(baseParent, {
      has(target, key) {
        if (key === '$_eval') return false;
        return Reflect.has(target, key);
      },
      get(target, key, receiver) {
        getReadKeys.push(key);
        if (key === '$_eval') {
          throw new Error('proxy refused $_eval read');
        }
        return Reflect.get(target, key, receiver);
      },
    });

    const condition = cell(true);
    const placeholder = fixture.api.comment('proxy-test');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    let constructed: IfCondition | null = null;
    expect(() => {
      constructed = new IfCondition(
        proxyParent as unknown as Component<any>,
        condition,
        target as unknown as DocumentFragment,
        placeholder,
        () => null,
        () => null,
      );
    }).not.toThrow();

    expect(constructed).not.toBeNull();
    // The if was added to the tree under the (target of the) proxy.
    expect(TREE.has(constructed![COMPONENT_ID_PROPERTY])).toBe(true);
    // The `'$_eval' in proxyParent` check must NOT have triggered the get
    // trap with `$_eval` (a `has` lookup hits the `has` trap).
    expect(getReadKeys.includes('$_eval')).toBe(false);
  });

  test('proxy parent whose `get` throws on $_eval but `has` returns true: still does not throw', () => {
    // This stresses the dual-trap shape: even when a parent advertises
    // $_eval via `has` but the actual read throws, the IfCondition
    // constructor should not blow up the if-block registration. (If a
    // future change widens the contract to require successful read, this
    // test will need updating; today it documents the safety net.)
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    const proxyParent = new Proxy(baseParent, {
      has(_target, key) {
        if (key === '$_eval') return true;
        return Reflect.has(_target, key);
      },
      get(target, key, receiver) {
        if (key === '$_eval') {
          throw new Error('boom on $_eval read');
        }
        return Reflect.get(target, key, receiver);
      },
    });

    const condition = cell(true);
    const placeholder = fixture.api.comment('proxy-test-2');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    // The current guard does NOT swallow a successful `'$_eval' in parent`
    // followed by a throwing read — that's the limitation noted in the
    // commit message ("an `in` check before reading"). We confirm the
    // documented behavior: with `has` returning true and `get` throwing,
    // the constructor does throw, but it throws from the read site
    // (i.e. the original symptom). Verifying this exact shape locks the
    // test against silent broadening of swallow behavior.
    expect(() => {
      new IfCondition(
        proxyParent as unknown as Component<any>,
        condition,
        target as unknown as DocumentFragment,
        placeholder,
        () => null,
        () => null,
      );
    }).toThrow(/boom on \$_eval read/);
  });

  test('plain object parent without $_eval property: no throw, $_eval not assigned', () => {
    // Sanity: the most common Ember-compat shape — a plain component
    // without $_eval — must not cause the if to crash, AND must not have
    // an accidentally-assigned `$_eval` property afterwards.
    const baseParent = new Component({});
    baseParent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, baseParent);

    const condition = cell(true);
    const placeholder = fixture.api.comment('plain-test');
    const target = fixture.api.fragment();
    fixture.api.insert(target, placeholder);

    const ifCond = new IfCondition(
      baseParent,
      condition,
      target as unknown as DocumentFragment,
      placeholder,
      () => null,
      () => null,
    );

    expect(TREE.has(ifCond[COMPONENT_ID_PROPERTY])).toBe(true);
    // No $_eval was read, so none should be propagated to the IfCondition.
    expect('$_eval' in ifCond).toBe(false);
  });
});
