/**
 * @vitest-environment happy-dom
 *
 * Perf bench: opt-in row recycling — "sliding window of references"
 * (reference-swap variant, RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A2).
 *
 * Methodology (timed/settle/median, ROUNDS=5, happy-dom, item shape, root
 * component) is shared with src/core/list-perf.bench.test.ts via
 * __test-utils__/list-harness.ts — the comparison stays apples-to-apples by
 * construction. The ONLY difference is the opt-in `key="@recycle"`.
 *
 * Headline comparison: `replaceAll1k` here vs the standard harness's
 * `replace1k` (destroy+create). Correctness-with-reactivity is proven by
 * `update10th` (per-item cellFor push through the recycled state objects)
 * and `select20` (shared-cell fan-out), plus full DOM-content scans after
 * every structural mutation (ids/labels actually correct after replace /
 * shrink / grow-from-pool — the easy thing to get wrong).
 *
 * Note on shrink/grow numbers: the retire pool is capped (RECYCLE_POOL_LIMIT
 * in list.ts), so shrinking by more than the cap destroys the overflow rows
 * for real, and the following growth mixes pool reuse with fresh builds —
 * the numbers measure the shipped behavior, not an unbounded pool.
 *
 * Results print as a single JSON line prefixed with PERF_RESULTS_JSON.
 *
 * Gated behind RUN_LIST_PERF=1 (CI vitest budget); functional coverage for
 * recycling runs ungated in src/core/control-flow/list.recycle.test.ts.
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
  type HarnessItem,
} from './__test-utils__/list-harness';

// Identical root/body shape to the keyed harness; the ONLY difference is the
// opt-in recycle sentinel key (rows are reused by position, never destroyed).
const BenchRoot = defineBenchRoot('@recycle');

describe('list-perf recycle harness', () => {
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
      const trs = () => fixture.container.querySelectorAll('tbody tr');
      const rows = () => trs().length;
      const assert = (cond: boolean, msg: string) => {
        if (!cond) throw new Error(`recycle harness failed: ${msg}`);
      };

      // DOM-content assertion: every rendered row's id/label cells must match
      // the items array, position by position. This is the recycle-mode
      // correctness contract (stale bindings after a reference swap are the
      // easy thing to get wrong).
      const assertContent = (items: HarnessItem[], where: string) => {
        const rendered = trs();
        assert(
          rendered.length === items.length,
          `${where}: rows=${rendered.length} expected=${items.length}`,
        );
        for (let i = 0; i < items.length; i++) {
          const tr = rendered[i];
          const idText = tr.children[0]!.textContent;
          const labelText = tr.children[1]!.querySelector('a')!.textContent;
          assert(
            idText === String(items[i].id),
            `${where}: row ${i} id="${idText}" expected="${items[i].id}"`,
          );
          assert(
            labelText === items[i].label,
            `${where}: row ${i} label="${labelText}" expected="${items[i].label}"`,
          );
        }
      };

      const samples: Record<string, number[]> = {};
      const record = (name: string, ms: number) => {
        (samples[name] ??= []).push(ms);
      };

      for (let round = 0; round < ROUNDS; round++) {
        const root = mountRoot(fixture, BenchRoot);

        // create 1000 against a COLD pool (all rows freshly built)
        const first = buildItems(1000);
        record('createInitial1k', await timed(() => {
          (root as any)._items = first;
        }));
        assertContent(first, 'createInitial1k');

        // update every 10th label — the per-item cellFor push path must reach
        // the DOM THROUGH the recycled state objects (holder + item cell).
        record('update10th', await timed(() => {
          const items = root._items;
          for (let i = 0; i < items.length; i += 10) {
            items[i].label = items[i].label + ' !!!';
          }
        }));
        assertContent(first, 'update10th'); // first[] labels mutated in place
        assert(
          trs()[0].children[1]!.textContent!.endsWith(' !!!'),
          'update10th: row 0 label not updated in DOM',
        );
        assert(
          !trs()[1].children[1]!.textContent!.endsWith(' !!!'),
          'update10th: row 1 label must be untouched',
        );

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
        assert(
          fixture.container.querySelector('tr.danger')!.children[0]!
            .textContent === String(first[20 * 37].id),
          'select20: danger row id mismatch',
        );

        // replace all with fresh 1000 (disjoint ids) — THE HEADLINE: pure
        // reference swap, zero destroy/create.
        const fresh = buildItems(1000);
        record('replaceAll1k', await timed(() => {
          (root as any)._items = fresh;
        }));
        assertContent(fresh, 'replaceAll1k');

        // correctness-after-swap: per-item push must target the NEW items
        fresh[5].label = fresh[5].label + ' post-swap';
        await settle();
        assert(
          trs()[5].children[1]!.textContent === fresh[5].label,
          'post-swap update: row 5 label not updated through new item cell',
        );
        // correctness-after-swap: select must resolve against NEW ids
        (root as any)._selected = fresh[123].id;
        await settle();
        assert(
          fixture.container.querySelectorAll('tr.danger').length === 1 &&
            fixture.container.querySelector('tr.danger')!.children[0]!
              .textContent === String(fresh[123].id),
          'post-swap select: danger row mismatch',
        );

        // shrink to half: trailing rows retire (pool-capped; overflow rows
        // are destroyed for real)
        record('shrinkToHalf', await timed(() => {
          (root as any)._items = fresh.slice(0, 500);
        }));
        assertContent(fresh.slice(0, 500), 'shrinkToHalf');

        // grow back: pooled rows return first (re-insert + re-bind), the
        // overflow remainder is built fresh
        record('growBack', await timed(() => {
          (root as any)._items = fresh;
        }));
        assertContent(fresh, 'growBack');

        // clear: rows retire into the pool up to the cap
        record('clear1k', await timed(() => {
          (root as any)._items = [];
        }));
        assert(rows() === 0, `clear rows=${rows()}`);

        // create 1000 against a WARM (cap-bounded) pool
        const reborn = buildItems(1000);
        record('recreateFromPool1k', await timed(() => {
          (root as any)._items = reborn;
        }));
        assertContent(reborn, 'recreateFromPool1k');

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
