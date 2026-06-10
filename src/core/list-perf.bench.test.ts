/**
 * @vitest-environment happy-dom
 *
 * List performance harness — shared measurement methodology for the
 * {{#each}} tracking-context experiments (see RESEARCH_LIST_TRACKING_OPTIMIZATION.md).
 *
 * IMPORTANT FOR EXPERIMENT BRANCHES: do NOT change the scenarios, item shape,
 * iteration counts, or timing methodology — only the framework internals (or,
 * for opt-in features, the template/flags marked EXPERIMENT-TUNABLE below).
 * The shared methodology helpers live in __test-utils__/list-harness.ts.
 * Results print as a single JSON line prefixed with PERF_RESULTS_JSON so they
 * can be collected mechanically.
 *
 * Caveat: happy-dom measures JS-side cost (which is what these experiments
 * target). Browser-level DOM wins (layout, native cloneNode) are NOT captured.
 *
 * Gated behind RUN_LIST_PERF=1: the full matrix takes ~40-90s, which would
 * blow the CI vitest job's 4-minute budget. Run locally with:
 *   RUN_LIST_PERF=1 npx vitest run src/core/list-perf.bench.test.ts
 */
import { describe, test, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { $template } from './shared';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cellFor } from './reactive';
import { template } from '../../plugins/runtime-compiler';
import {
  buildItems,
  settle,
  timed,
  median,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from './__test-utils__/list-harness';

// Each-body shape mirrors the Krausest Row: one static-ish <tr>, a reactive
// text binding (per-item cell) and TWO bindings on the shared `selected`
// cell (the select fan-out path). EXPERIMENT-TUNABLE: experiments may render
// an alternative template variant ADDITIONALLY, never instead.
const LIST_TEMPLATE = `
  <table><tbody>
    {{#each this.items key="id" as |item|}}
      <tr class={{this.rowClass item.id}}>
        <td>{{item.id}}</td>
        <td><a class={{this.rowClass item.id}}>{{item.label}}</a></td>
        <td><span>x</span></td>
      </tr>
    {{/each}}
  </tbody></table>
`;

class BenchRoot extends Component {
  _items: HarnessItem[] = [];
  _selected = 0;
  constructor(args: any) {
    super(args);
    cellFor(this as any, '_items');
    cellFor(this as any, '_selected');
  }
  get items() {
    return this._items;
  }
  rowClass = (id: number) => (this._selected === id ? 'danger' : '');
  [$template] = template(LIST_TEMPLATE);
}

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
