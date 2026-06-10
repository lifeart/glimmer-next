/**
 * @vitest-environment happy-dom
 *
 * Functional coverage for opt-in row recycling (`{{#each items key="@recycle"}}`).
 * Perf characteristics live in src/core/list-perf.recycle.bench.test.ts (gated
 * behind RUN_LIST_PERF); this file covers the semantic contract:
 *   - positional reuse: replacing the data REBINDS rows in place (DOM node
 *     identity survives — the intentional, documented difference from keyed mode);
 *   - shrink retires rows into the (capped) pool, growth reuses them before
 *     building new;
 *   - per-item cell updates and shared-cell bindings stay reactive through the
 *     state-object indirection — including prototype-accessor (@tracked-style)
 *     items;
 *   - empty data renders the inverse block.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { $template } from '../shared';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from '../__test-utils__/list-harness';
import { cellFor } from '../reactive';
import { template } from '../../../plugins/runtime-compiler';

const LIST_TEMPLATE = `
  <table><tbody>
    {{#each this.items key="@recycle" as |item|}}
      <tr class={{this.rowClass item.id}}><td>{{item.id}}</td><td>{{item.label}}</td></tr>
    {{else}}
      <tr data-empty="true"><td>empty</td></tr>
    {{/each}}
  </tbody></table>
`;

class RecycleRoot extends Component {
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
  rowClass = (id: number) => (this._selected === id ? 'selected' : '');
  [$template] = template(LIST_TEMPLATE);
}

describe('{{#each}} key="@recycle" (opt-in row recycling)', () => {
  let fixture: DOMFixture;
  let root: RecycleRoot;

  beforeEach(async () => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
    root = mountRoot(fixture, RecycleRoot);
    await settle();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  const rows = () =>
    Array.from(fixture.container.querySelectorAll('tbody tr:not([data-empty])'));
  const rowText = (tr: Element) =>
    `${tr.children[0]!.textContent}:${tr.children[1]!.textContent}`;
  const setItems = async (items: HarnessItem[]) => {
    (root as any)._items = items;
    await settle();
  };
  const labels = (...ls: string[]) => buildItems(ls.length, (i) => ls[i]);

  test('renders items and rebinds rows in place on replace (DOM identity survives)', async () => {
    const first = labels('a', 'b', 'c');
    await setItems(first);
    expect(rows().map(rowText)).toEqual(first.map((i) => `${i.id}:${i.label}`));

    const initialNodes = rows();
    const second = labels('x', 'y', 'z');
    await setItems(second);

    const replaced = rows();
    expect(replaced.map(rowText)).toEqual(
      second.map((i) => `${i.id}:${i.label}`),
    );
    // The recycle contract: same <tr> elements, new data.
    expect(replaced).toHaveLength(3);
    replaced.forEach((tr, i) => expect(tr).toBe(initialNodes[i]));
  });

  test('shrink retires rows; growth reuses pooled rows before building new ones', async () => {
    const four = labels('a', 'b', 'c', 'd');
    await setItems(four);
    const fullNodes = rows();
    expect(fullNodes).toHaveLength(4);

    await setItems(four.slice(0, 2));
    expect(rows()).toHaveLength(2);

    const six = labels('p', 'q', 'r', 's', 't', 'u');
    await setItems(six);
    const grown = rows();
    expect(grown.map(rowText)).toEqual(six.map((i) => `${i.id}:${i.label}`));
    // First two rows never moved; rows 3-4 came back from the pool.
    expect(grown[0]).toBe(fullNodes[0]);
    expect(grown[1]).toBe(fullNodes[1]);
    expect(grown.slice(2, 4)).toEqual(
      expect.arrayContaining([fullNodes[2], fullNodes[3]]),
    );
  });

  test('per-item cell updates reach the DOM through the state object', async () => {
    const items = labels('a', 'b', 'c');
    await setItems(items);

    items[1].label = 'B!';
    await settle();

    expect(rows()[1].children[1]!.textContent).toBe('B!');
    expect(rows()[0].children[1]!.textContent).toBe('a');
  });

  test('prototype-accessor items (legacy @tracked shape) are forwarded', async () => {
    // Legacy `@tracked` installs ENUMERABLE accessors on the prototype — the
    // state object must forward those, not just own properties.
    class TrackedItem {
      id: number;
      _label: string;
      declare label: string;
      constructor(id: number, label: string) {
        this.id = id;
        this._label = label;
        cellFor(this as any, '_label');
      }
    }
    Object.defineProperty(TrackedItem.prototype, 'label', {
      get(this: TrackedItem) {
        return this._label;
      },
      set(this: TrackedItem, v: string) {
        this._label = v;
      },
      enumerable: true,
      configurable: true,
    });
    const items = [
      new TrackedItem(9001, 'proto-a'),
      new TrackedItem(9002, 'proto-b'),
    ] as unknown as HarnessItem[];
    await setItems(items);

    expect(rows().map(rowText)).toEqual(['9001:proto-a', '9002:proto-b']);

    (items[0] as unknown as TrackedItem).label = 'proto-a2';
    await settle();
    expect(rows()[0].children[1]!.textContent).toBe('proto-a2');
  });

  test('shared-cell bindings (selection) stay reactive across rebinds', async () => {
    const items = labels('a', 'b', 'c');
    await setItems(items);

    (root as any)._selected = items[1].id;
    await settle();
    expect(rows()[1].className).toBe('selected');
    expect(rows()[0].className).toBe('');

    // Rebind the selected row to a different item: the class binding
    // re-evaluates against the new id and deselects.
    const swapped = [items[0], labels('n')[0], items[2]];
    await setItems(swapped);
    expect(rows()[1].className).toBe('');
    expect(rows()[1].children[1]!.textContent).toBe('n');
  });

  test('empty data renders the inverse block; refill restores rows', async () => {
    await setItems(labels('a', 'b'));
    expect(rows()).toHaveLength(2);

    await setItems([]);
    expect(rows()).toHaveLength(0);
    expect(fixture.container.querySelector('[data-empty]')).not.toBeNull();

    const refill = labels('c');
    await setItems(refill);
    expect(fixture.container.querySelector('[data-empty]')).toBeNull();
    expect(rows().map(rowText)).toEqual(refill.map((i) => `${i.id}:${i.label}`));
  });

  test('pool is capped: shrinking far below the cap still grows back correctly', async () => {
    // RECYCLE_POOL_LIMIT is 256 — retire 300 rows so 44 overflow rows get
    // real teardown, then grow back mixing pooled + freshly built rows.
    const big = buildItems(300);
    await setItems(big);
    expect(rows()).toHaveLength(300);

    await setItems([]);
    expect(rows()).toHaveLength(0);

    const next = buildItems(300);
    await setItems(next);
    expect(rows()).toHaveLength(300);
    expect(rows().map(rowText)).toEqual(next.map((i) => `${i.id}:${i.label}`));

    // Reactivity intact for both pooled and freshly built rows.
    next[0].label = 'pooled!';
    next[299].label = 'fresh!';
    await settle();
    expect(rows()[0].children[1]!.textContent).toBe('pooled!');
    expect(rows()[299].children[1]!.textContent).toBe('fresh!');
  });
});
