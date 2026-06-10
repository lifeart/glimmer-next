/**
 * @vitest-environment happy-dom
 *
 * List performance harness for the keyed {{#each}} hot paths (see
 * RESEARCH_LIST_TRACKING_OPTIMIZATION.md for the cost analysis and measured
 * history). Methodology — item shape, timing, root component, mount ritual —
 * lives in __test-utils__/list-harness.ts and is shared with the recycle
 * variant so comparisons stay apples-to-apples. Results print as one JSON
 * line prefixed with PERF_RESULTS_JSON.
 *
 * Caveat: happy-dom measures JS-side cost only — browser-level effects
 * (layout, native cloneNode) are not captured.
 *
 * Gated behind RUN_LIST_PERF=1: the full matrix takes ~40-90s, which would
 * blow the CI vitest job's 4-minute budget. Run locally with:
 *   RUN_LIST_PERF=1 npx vitest run src/core/list-perf.bench.test.ts
 */
import { describe, test, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import {
  buildItems,
  settle,
  timed,
  median,
  mountRoot,
  defineBenchRoot,
  setupRuntimeTemplateGlobals,
} from './__test-utils__/list-harness';

const BenchRoot = defineBenchRoot('id');

describe('list-perf harness', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test.runIf(process.env.RUN_LIST_PERF)(
    'scenarios',
    { timeout: 600_000 },
    async () => {
      const ROUNDS = 5;
      const results: Record<string, number> = {};
      const rows = () =>
        fixture.container.querySelectorAll('tbody tr').length;
      const assert = (cond: boolean, msg: string) => {
        if (!cond) throw new Error(`harness sanity failed: ${msg}`);
      };

      const samples: Record<string, number[]> = {};
      const record = (name: string, ms: number) => {
        (samples[name] ??= []).push(ms);
      };

      for (let round = 0; round < ROUNDS; round++) {
        const root = mountRoot(fixture, BenchRoot);

        // create 1000
        record('create1k', await timed(() => {
          (root as any)._items = buildItems(1000);
        }));
        assert(rows() === 1000, `create1k rows=${rows()}`);

        // update every 10th label (per-item cell push path)
        record('update10th', await timed(() => {
          const items = root._items;
          for (let i = 0; i < items.length; i += 10) {
            items[i].label = items[i].label + ' !!!';
          }
        }));

        // select: 20 consecutive selections (shared-cell fan-out)
        record('select20', await timed(async () => {
          const items = root._items;
          for (let s = 1; s <= 20; s++) {
            (root as any)._selected = items[s * 37].id;
            await settle();
          }
        }));
        assert(
          fixture.container.querySelectorAll('tr.danger').length === 1,
          'select applied',
        );

        // swap rows 1 and 998
        record('swap', await timed(() => {
          const newData = [...root._items];
          const t = newData[1];
          newData[1] = newData[998];
          newData[998] = t;
          (root as any)._items = newData;
        }));

        // append 1000
        record('append1k', await timed(() => {
          (root as any)._items = [...root._items, ...buildItems(1000)];
        }));
        assert(rows() === 2000, `append1k rows=${rows()}`);

        // replace all with fresh 1000 (disjoint keys)
        record('replace1k', await timed(() => {
          (root as any)._items = buildItems(1000);
        }));
        assert(rows() === 1000, `replace1k rows=${rows()}`);

        // clear
        record('clear1k', await timed(() => {
          (root as any)._items = [];
        }));
        assert(rows() === 0, `clear rows=${rows()}`);

        // create 5000
        record('create5k', await timed(() => {
          (root as any)._items = buildItems(5000);
        }));
        assert(rows() === 5000, `create5k rows=${rows()}`);

        record('clear5k', await timed(() => {
          (root as any)._items = [];
        }));

        fixture.cleanup();
        fixture = createDOMFixture();
      }

      for (const [name, xs] of Object.entries(samples)) {
        results[name] = Math.round(median(xs) * 100) / 100;
      }
      // eslint-disable-next-line no-console
      console.log('PERF_RESULTS_JSON ' + JSON.stringify(results));
    },
  );
});
