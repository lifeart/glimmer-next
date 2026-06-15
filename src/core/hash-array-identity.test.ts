/**
 * Spec for the `(hash)` / `(array)` identity-stability fix.
 *
 * Classic Glimmer memoizes `(hash)` / `(array)` so the produced object/array
 * keeps a STABLE reference across reads/re-renders, only changing when an input
 * changes (the `createComputeRef` contract). GXT previously rebuilt a fresh
 * object/array on every read of the arg getter (`$_args` re-invokes the getter,
 * which re-ran `$__hash` / `$__array`), so `childInstance.obj !== childInstance.obj`
 * for two reads in the SAME render — causing reference-comparing consumers
 * (Ember child components, modifiers) to over-invalidate.
 *
 * This suite proves:
 *   - two reads of the same (hash)/(array) in ONE render are `===`;
 *   - the reference is stable across an UNRELATED re-render;
 *   - (hash) keeps its reference and updates the property in place when an input
 *     changes; (array) produces a NEW reference when an input changes;
 *   - value-correctness is preserved throughout.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree, $template, $args } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cell, formula, cachedHelper, setTracker, type Cell } from './reactive';
import { renderElement } from './render-core';
import {
  template,
  compileTemplate,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../plugins/runtime-compiler';

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('(hash)/(array) identity memoization — cachedHelper (runtime primitive)', () => {
  test('zero-dep factory (the (hash) shape) returns a stable reference forever', () => {
    let builds = 0;
    const read = cachedHelper(() => ({ id: ++builds }));
    const a = read();
    const b = read();
    expect(a).toBe(b); // same reference across reads
    expect(builds).toBe(1); // factory ran exactly once
  });

  test('input-reading factory (the (array) shape) is stable until the input changes', () => {
    const x = cell(1);
    let builds = 0;
    const read = cachedHelper(() => {
      builds++;
      return [x.value, 2];
    });

    // Read inside a consumer formula so deps are captured/replayed.
    const consumer = formula(() => read());

    const a1 = consumer.value as number[];
    const a2 = consumer.value as number[];
    expect(a1).toBe(a2); // stable while the input is unchanged
    expect(a1).toEqual([1, 2]); // value-correct
    expect(builds).toBe(1);

    // An input change yields a NEW reference with the correct value.
    x.update(9);
    const a3 = consumer.value as number[];
    expect(a3).not.toBe(a1);
    expect(a3).toEqual([9, 2]);
  });

  test('captured deps are replayed into the ambient tracker on every read', () => {
    const x = cell(1);
    const read = cachedHelper(() => [x.value]);

    // First (recompute) read inside an ambient tracker frame forwards the dep.
    const frame1 = new Set<Cell>();
    setTracker(frame1);
    try {
      read();
    } finally {
      setTracker(null);
    }
    expect(frame1.size).toBeGreaterThan(0);

    // A subsequent CLEAN (memoized) read still replays the dep into a fresh
    // frame, so a consumer that re-reads keeps depending on the input cell.
    const frame2 = new Set<Cell>();
    setTracker(frame2);
    try {
      read();
    } finally {
      setTracker(null);
    }
    expect(frame2.size).toBeGreaterThan(0);
  });
});

describe('(hash)/(array) identity memoization — compiled output', () => {
  test('a (hash) / (array) component arg is wrapped in $__cached', () => {
    const result = compileTemplate(
      '<Child @obj={{hash key=this.x}} @arr={{array this.x 2}} />',
      { bindings: new Set(['Child']), flags: { IS_GLIMMER_COMPAT_MODE: true } }
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$__cached(() => $__hash(');
    expect(result.code).toContain('$__cached(() => $__array(');
  });
});

describe('(hash)/(array) identity memoization — render behavior', () => {
  let fixture: DOMFixture;

  function render(C: any, args: Record<string, unknown> = {}) {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const a = $_args(args, false, $_edp as any);
    const instance = $_c(C as any, a, parent);
    renderElement(fixture.api, parent, fixture.container, instance);
    return instance;
  }

  beforeEach(() => {
    fixture = createDOMFixture();
    setupGlobalScope();
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  afterEach(() => fixture.cleanup());

  test('(hash) keeps a stable reference; property updates in place; no over-invalidation', async () => {
    let child: any = null;
    class HashChild extends Component {
      constructor(...rest: any[]) {
        // @ts-expect-error component ctor args
        super(...rest);
        child = this;
      }
      [$template] = template('<span data-test-hash>{{@obj.name}}</span>');
    }

    class Parent extends Component {
      nameCell = cell('a');
      unrelatedCell = cell(0);
      get nameVal() {
        return this.nameCell.value;
      }
      get unrelatedVal() {
        return this.unrelatedCell.value;
      }
      [$template] = template(
        '<HashChild @obj={{hash name=this.nameVal}} /><i>{{this.unrelatedVal}}</i>',
        { scope: { HashChild } }
      );
    }

    const parent = render(Parent) as any;
    expect(fixture.container.textContent).toContain('a');

    const childArgs = child[$args];

    // Two reads of the SAME (hash) in one render -> identical reference.
    const r1 = childArgs.obj;
    const r2 = childArgs.obj;
    expect(r1).toBe(r2);
    expect(r1.name).toBe('a'); // value-correct

    // Unrelated re-render -> reference stays stable.
    parent.unrelatedCell.update(1);
    await flush();
    expect(childArgs.obj).toBe(r1);

    // Input change -> SAME reference, value updated in place (classic hash).
    parent.nameCell.update('b');
    await flush();
    expect(fixture.container.textContent).toContain('b');
    expect(childArgs.obj).toBe(r1);
    expect(childArgs.obj.name).toBe('b');
  });

  test('(array) is stable across reads/unrelated re-render; new reference when an input changes', async () => {
    let child: any = null;
    class ArrChild extends Component {
      constructor(...rest: any[]) {
        // @ts-expect-error component ctor args
        super(...rest);
        child = this;
      }
      [$template] = template('<span data-test-arr>{{@arr.length}}</span>');
    }

    class Parent extends Component {
      xCell = cell(1);
      unrelatedCell = cell(0);
      get xVal() {
        return this.xCell.value;
      }
      get unrelatedVal() {
        return this.unrelatedCell.value;
      }
      [$template] = template(
        '<ArrChild @arr={{array this.xVal 2}} /><i>{{this.unrelatedVal}}</i>',
        { scope: { ArrChild } }
      );
    }

    const parent = render(Parent) as any;
    const childArgs = child[$args];

    // Two reads of the SAME (array) in one render -> identical reference.
    const a1 = childArgs.arr;
    const a2 = childArgs.arr;
    expect(a1).toBe(a2);
    expect([...a1]).toEqual([1, 2]); // value-correct

    // Unrelated re-render -> reference stays stable.
    parent.unrelatedCell.update(1);
    await flush();
    expect(childArgs.arr).toBe(a1);

    // Input change -> NEW reference, value-correct.
    parent.xCell.update(9);
    await flush();
    const a3 = childArgs.arr;
    expect(a3).not.toBe(a1);
    expect([...a3]).toEqual([9, 2]);
  });
});
