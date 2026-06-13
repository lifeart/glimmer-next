/**
 * @vitest-environment node
 *
 * D1 — drain-overhead micro-benchmark: GXT's REAL push pipeline (pushReal)
 * vs a minimal push model doing identical work (pushMinimal). Adapted from
 * the E6 bench (exp/e6-binary-validation:src/core/validation-strategies.bench.test.ts),
 * with the segment-tree strategy and reorder scenarios dropped — this file
 * isolates the pushReal-vs-pushMinimal gap that E6 flagged as a standalone
 * optimization target (RESEARCH_LIST_TRACKING_OPTIMIZATION.md §5, E6 row:
 * "pushReal is 4-6× slower than a minimal push model — GXT's own drain
 * bookkeeping (dirty-set sort, relatedTags churn, epoch WeakMap) is a
 * standalone optimization target").
 *
 * Pure JS micro-benchmark, no DOM. "Apply update to row i" is the same
 * trivial sink for both strategies: write the row's current value into a
 * preallocated Float64Array slot.
 *
 *  a. PUSH-REAL — the actual GXT primitives:
 *     - one Cell per row via `cellFor(item, 'v')` (cellsMap Map + accessor
 *       defineProperty, exactly the Krausest `cellFor(item,'label')` path);
 *     - one `opcodeFor(cell, sink)` subscription per row;
 *     - dirty d rows via the accessor setter → `Cell.update` →
 *       `tagsToRevalidate.add` + `scheduleRevalidate`;
 *     - drain via the REAL production path: `takeRenderingControl()`
 *       suppresses the microtask scheduling, then the exported `syncDom()`
 *       dispatches to `syncDomSync` (the exact production drain).
 *
 *  b. PUSH-MINIMAL — stripped reimplementation of the model
 *     (Map<cellId, op[]> + dirty Set + drain loop). No relatedTags lookup,
 *     no dedup bookkeeping, no id-sort, no accessor indirection — isolates
 *     the push MODEL from GXT's bookkeeping overhead.
 *
 * Results print as one `PERF_RESULTS_JSON {...}` line (median of 7,
 * performance.now), including the per-d pushReal/pushMinimal ratio.
 *
 * Gated behind RUN_LIST_PERF=1 (like list-perf.bench.test.ts). Run with:
 *   RUN_LIST_PERF=1 npx vitest run --no-file-parallelism src/core/drain-overhead.bench.test.ts
 */
import { describe, test, expect } from 'vitest';
import { cellFor, hasAsyncOpcodes, tagsToRevalidate } from '@/core/reactive';
import { opcodeFor } from '@/core/vm';
import { syncDom, takeRenderingControl } from '@/core/runtime';

const N = 10_000;
const RUNS = 7;
const D_VALUES = [1, 10, 100, 1000, 10000] as const;
// repetitions per timed sample so tiny d values produce measurable times
const REPS: Record<number, number> = {
  1: 2000,
  10: 500,
  100: 200,
  1000: 40,
  10000: 7,
};
const MIXED_ROUNDS = 100;
const MIXED_D = 10;

let valSeq = 1;

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

interface Strategy {
  readonly name: string;
  readonly sink: Float64Array;
  /** untimed: raw user data (item objects exist in every model) */
  prepare(initial: Float64Array): void;
  /** timed: wire up the reactive bookkeeping */
  setup(initial: Float64Array): void;
  update(i: number, v: number): void;
  drain(): void;
  /** untimed */
  teardown(): void;
}

// ---------------------------------------------------------------------------
// a. PUSH-REAL — actual GXT primitives
// ---------------------------------------------------------------------------
interface Row {
  v: number;
}

class PushReal implements Strategy {
  readonly name = 'pushReal';
  readonly sink = new Float64Array(N);
  items: Row[] = [];
  destructors: Array<() => void> = [];

  prepare(initial: Float64Array) {
    const items: Row[] = new Array(N);
    for (let i = 0; i < N; i++) items[i] = { v: initial[i] };
    this.items = items;
  }
  setup(_initial: Float64Array) {
    const { sink, items, destructors } = this;
    for (let i = 0; i < N; i++) {
      // Cell + cellsMap Map-per-item + defineProperty accessor (Krausest path)
      const c = cellFor(items[i], 'v');
      const idx = i;
      // NB: braces — an expression-bodied arrow would RETURN the value and
      // evaluateOpcode (ASYNC_COMPILE_TRANSFORMS) would mark the op async,
      // silently rerouting syncDom to the async drain.
      destructors.push(
        opcodeFor(c, (val) => {
          sink[idx] = val as number;
        }),
      );
    }
  }
  update(i: number, v: number) {
    // accessor setter → Cell.update → tagsToRevalidate.add + scheduleRevalidate
    this.items[i].v = v;
  }
  drain() {
    // real production drain (syncDomSync behind the exported dispatcher)
    syncDom();
  }
  teardown() {
    for (const d of this.destructors) d();
    this.destructors.length = 0;
    this.items.length = 0;
    tagsToRevalidate.clear();
  }
}

// ---------------------------------------------------------------------------
// b. PUSH-MINIMAL — the model without GXT's bookkeeping
// ---------------------------------------------------------------------------
class MiniCell {
  constructor(
    public id: number,
    public value: number,
  ) {}
}

class PushMinimal implements Strategy {
  readonly name = 'pushMinimal';
  readonly sink = new Float64Array(N);
  ops: Map<number, Array<(v: number) => void>> = new Map();
  dirty: Set<MiniCell> = new Set();
  cells: MiniCell[] = [];

  prepare(_initial: Float64Array) {
    // no separate user-data carrier needed: MiniCell IS the row holder,
    // created in setup (it is part of this model's bookkeeping)
  }
  setup(initial: Float64Array) {
    const { sink, ops, cells } = this;
    for (let i = 0; i < N; i++) {
      const c = new MiniCell(i, initial[i]);
      cells.push(c);
      const idx = i;
      const op = (v: number) => {
        sink[idx] = v;
      };
      ops.set(c.id, [op]);
      op(c.value); // initial apply (parity with opcodeFor's evaluateOpcode)
    }
  }
  update(i: number, v: number) {
    const c = this.cells[i];
    c.value = v;
    this.dirty.add(c);
  }
  drain() {
    // dirty → direct op arrays; no sort, no relatedTags, no dedup bookkeeping
    for (const c of this.dirty) {
      const list = this.ops.get(c.id);
      if (list !== undefined) {
        for (let k = 0; k < list.length; k++) list[k](c.value);
      }
    }
    this.dirty.clear();
  }
  teardown() {
    this.ops.clear();
    this.dirty.clear();
    this.cells.length = 0;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeInitial(): Float64Array {
  const a = new Float64Array(N);
  for (let i = 0; i < N; i++) a[i] = i + 0.25;
  return a;
}

function dirtyIndices(d: number): number[] {
  const step = N / d;
  const idx: number[] = new Array(d);
  for (let k = 0; k < d; k++) idx[k] = Math.floor(k * step);
  return idx;
}

function buildStrategy(kind: 'pushReal' | 'pushMinimal'): Strategy {
  if (kind === 'pushReal') return new PushReal();
  return new PushMinimal();
}

const KINDS = ['pushReal', 'pushMinimal'] as const;

describe('D1: real push pipeline vs minimal push model', () => {
  test('both strategies produce identical sinks for the same update stream', () => {
    const release = takeRenderingControl();
    try {
      const initial = makeInitial();
      const strategies = KINDS.map((k) => {
        const s = buildStrategy(k);
        s.prepare(initial);
        s.setup(initial);
        return s;
      });
      expect(hasAsyncOpcodes()).toBe(false); // sink ops must stay sync
      let initMismatches = 0;
      for (const s of strategies) {
        for (let i = 0; i < N; i++) {
          if (s.sink[i] !== initial[i]) initMismatches++;
        }
      }
      expect(initMismatches).toBe(0);
      for (let round = 0; round < 5; round++) {
        const idx = dirtyIndices([1, 10, 100, 1000, 10000][round]);
        const vals = idx.map(() => ++valSeq);
        for (const s of strategies) {
          for (let k = 0; k < idx.length; k++) s.update(idx[k], vals[k]);
          const drained = (s.drain() as unknown) ?? undefined;
          expect(drained).toBeUndefined(); // pushReal: sync drain, no Promise
        }
        const [a, b] = strategies;
        let mismatches = 0;
        for (let i = 0; i < N; i++) {
          if (b.sink[i] !== a.sink[i]) mismatches++;
        }
        expect(mismatches).toBe(0);
      }
      strategies.forEach((s) => s.teardown());
    } finally {
      release();
    }
  });

  test.runIf(process.env.RUN_LIST_PERF)(
    'bench',
    { timeout: 300_000 },
    () => {
      const release = takeRenderingControl();
      try {
        const initial = makeInitial();
        const results: any = {
          meta: {
            N,
            runs: RUNS,
            reps: REPS,
            mixed: { rounds: MIXED_ROUNDS, d: MIXED_D },
            env: 'node',
            note:
              'pushReal drains via exported syncDom() (real syncDomSync); ' +
              'takeRenderingControl() suppresses microtask scheduling; ' +
              'updateDrainMs is per-cycle, setup/mixed are totals; ' +
              'ratio = pushReal / pushMinimal (lower is better for GXT)',
          },
          setupMs: {},
          updateDrainMs: {},
          updateDrainRatio: {},
          mixedMs: {},
        };

        // ---- SETUP (median of RUNS, fresh build each sample) ---------------
        for (const kind of KINDS) {
          const samples: number[] = [];
          for (let r = 0; r < RUNS; r++) {
            const s = buildStrategy(kind);
            s.prepare(initial); // untimed: raw user data
            const t0 = performance.now();
            s.setup(initial);
            const t1 = performance.now();
            samples.push(t1 - t0);
            s.teardown();
          }
          results.setupMs[kind] = round6(median(samples));
        }

        // ---- long-lived instances for update/drain benches -----------------
        const live: Record<string, Strategy> = {};
        for (const kind of KINDS) {
          const s = buildStrategy(kind);
          s.prepare(initial);
          s.setup(initial);
          live[kind] = s;
        }
        expect(hasAsyncOpcodes()).toBe(false);

        // ---- UPDATE+DRAIN per d (per-cycle ms, median of RUNS samples) -----
        for (const d of D_VALUES) {
          const idx = dirtyIndices(d);
          const reps = REPS[d];
          const key = `d=${d}`;
          results.updateDrainMs[key] = {};
          for (const kind of KINDS) {
            const s = live[kind];
            const samples: number[] = [];
            for (let r = 0; r < RUNS; r++) {
              const t0 = performance.now();
              for (let rep = 0; rep < reps; rep++) {
                for (let k = 0; k < d; k++) s.update(idx[k], ++valSeq);
                s.drain();
              }
              const t1 = performance.now();
              samples.push((t1 - t0) / reps);
            }
            results.updateDrainMs[key][kind] = round6(median(samples));
            // sanity (untimed): one checked cycle
            const checkVals = idx.map(() => ++valSeq);
            for (let k = 0; k < d; k++) s.update(idx[k], checkVals[k]);
            s.drain();
            let mismatches = 0;
            for (let k = 0; k < d; k++) {
              if (s.sink[idx[k]] !== checkVals[k]) mismatches++;
            }
            expect(mismatches).toBe(0);
          }
          results.updateDrainRatio[key] = round6(
            results.updateDrainMs[key].pushReal /
              results.updateDrainMs[key].pushMinimal,
          );
        }
        for (const kind of KINDS) live[kind].teardown();

        // ---- MIXED workload: create 10k + 100 rounds of d=10 ----------------
        const mixedIdx = dirtyIndices(MIXED_D);
        for (const kind of KINDS) {
          const samples: number[] = [];
          for (let r = 0; r < RUNS; r++) {
            const s = buildStrategy(kind);
            s.prepare(initial); // untimed
            const t0 = performance.now();
            s.setup(initial);
            for (let round = 0; round < MIXED_ROUNDS; round++) {
              for (let k = 0; k < MIXED_D; k++) s.update(mixedIdx[k], ++valSeq);
              s.drain();
            }
            const t1 = performance.now();
            samples.push(t1 - t0);
            s.teardown();
          }
          results.mixedMs[kind] = round6(median(samples));
        }

        // basic sanity on the numbers
        for (const kind of KINDS) {
          expect(Number.isFinite(results.setupMs[kind])).toBe(true);
          expect(Number.isFinite(results.mixedMs[kind])).toBe(true);
        }

        // eslint-disable-next-line no-console
        console.log('PERF_RESULTS_JSON ' + JSON.stringify(results));
      } finally {
        release();
      }
    },
  );
});
