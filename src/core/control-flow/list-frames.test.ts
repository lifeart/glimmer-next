/**
 * @vitest-environment happy-dom
 *
 * Frame-mode ({{#each}} static-block v2, list-frames.ts) correctness suite.
 *
 * Renders runtime-compiled templates whose each-bodies QUALIFY for frame mode
 * (single-root inline element, attr/class/text slots, no events, no index)
 * and asserts the full keyed contract: create / per-item update / shared-dep
 * sweep / LIS reorder / replace / clear / inverse / duplicate keys / rebind —
 * plus the gate (event bodies and {{index}} bodies stay on v1, observable via
 * the per-item marker comments frame mode eliminates) and a subscription-leak
 * bound across create+clear cycles.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from '../__test-utils__/list-harness';
import { Component } from '../component';
import { $template } from '../shared';
import {
  cellFor,
  opsForTag,
  relatedTags,
  applyCellUpdateSync,
  type Cell,
} from '../reactive';
import { destroyElementSync } from '../destroy';
import type { ComponentLike } from '../types';
import { template } from '../../../plugins/runtime-compiler';

describe('frame-mode {{#each}} (static-block v2)', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function defineRoot(listTemplate: string) {
    class FrameRoot extends Component {
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
      [$template] = template(listTemplate);
    }
    return FrameRoot as new (args: any) => Component<any> & {
      _items: HarnessItem[];
      _selected: number;
    };
  }

  const FRAME_TEMPLATE = `
    <table><tbody>
      {{#each this.items key="id" as |item|}}
        <tr class={{this.rowClass item.id}}>
          <td>{{item.id}}</td>
          <td><a class={{this.rowClass item.id}}>{{item.label}}</a></td>
          <td><span>x</span></td>
        </tr>
      {{else}}
        <tr><td>empty</td></tr>
      {{/each}}
    </tbody></table>
  `;

  const trs = () => fixture.container.querySelectorAll('tbody tr');
  const labelAt = (i: number) =>
    trs()[i]?.querySelector('a')?.textContent ?? '';
  const idAt = (i: number) =>
    trs()[i]?.querySelector('td')?.textContent ?? '';
  /** frame rows have NO per-item marker comments between top/bottom markers */
  const rowMarkerComments = () => {
    const tbody = fixture.container.querySelector('tbody')!;
    let count = 0;
    tbody.childNodes.forEach((n) => {
      if (n.nodeType === 8) count++;
    });
    return count;
  };

  test('create renders rows without per-item marker comments (frame mode active)', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(5);
    await settle();
    expect(trs().length).toBe(5);
    expect(labelAt(0)).toBe(root._items[0].label);
    expect(labelAt(4)).toBe(root._items[4].label);
    expect(idAt(2)).toBe(String(root._items[2].id));
    // top/bottom list markers + each-placeholder comments only — v1 would add
    // one marker comment per row (5 more)
    const baseline = rowMarkerComments();
    (root as any)._items = [...root._items, ...buildItems(5)];
    await settle();
    expect(trs().length).toBe(10);
    expect(rowMarkerComments()).toBe(baseline);
  });

  test('per-item cell update routes to one row (label push path)', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(10);
    await settle();
    root._items[3].label = 'updated three';
    root._items[7].label = 'updated seven';
    await settle();
    expect(labelAt(3)).toBe('updated three');
    expect(labelAt(7)).toBe('updated seven');
    expect(labelAt(0)).toBe(root._items[0].label);
  });

  test('shared-dep sweep: select applies/clears exactly one row, twice nested (tr + a)', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(20);
    await settle();
    (root as any)._selected = root._items[5].id;
    await settle();
    expect(fixture.container.querySelectorAll('tr.danger').length).toBe(1);
    expect(fixture.container.querySelectorAll('a.danger').length).toBe(1);
    expect(trs()[5].className).toBe('danger');
    (root as any)._selected = root._items[11].id;
    await settle();
    expect(trs()[5].className).toBe('');
    expect(trs()[11].className).toBe('danger');
    expect(fixture.container.querySelectorAll('.danger').length).toBe(2); // tr + a
    (root as any)._selected = 0;
    await settle();
    expect(fixture.container.querySelectorAll('.danger').length).toBe(0);
  });

  test('reorder: swap preserves row identity (same DOM elements relocate)', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(6);
    await settle();
    const el1 = trs()[1];
    const el4 = trs()[4];
    const swapped = [...root._items];
    const t = swapped[1];
    swapped[1] = swapped[4];
    swapped[4] = t;
    (root as any)._items = swapped;
    await settle();
    expect(trs()[1]).toBe(el4);
    expect(trs()[4]).toBe(el1);
    for (let i = 0; i < 6; i++) {
      expect(labelAt(i)).toBe(swapped[i].label);
    }
    // reactivity survives relocation
    swapped[1].label = 'moved row updated';
    await settle();
    expect(labelAt(1)).toBe('moved row updated');
  });

  test('reorder: full reverse (LIS path) keeps content + identity', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(7);
    await settle();
    const original = Array.from(trs());
    const reversed = [...root._items].reverse();
    (root as any)._items = reversed;
    await settle();
    expect(trs().length).toBe(7);
    for (let i = 0; i < 7; i++) {
      expect(labelAt(i)).toBe(reversed[i].label);
      expect(trs()[i]).toBe(original[6 - i]);
    }
  });

  test('partial removal + insertion in one sync', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(6);
    await settle();
    const kept = [root._items[4], root._items[0], root._items[2]];
    const fresh = buildItems(2);
    const next = [kept[0], fresh[0], kept[1], fresh[1], kept[2]];
    (root as any)._items = next;
    await settle();
    expect(trs().length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(labelAt(i)).toBe(next[i].label);
    }
  });

  test('replace-all with disjoint keys', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(50);
    await settle();
    (root as any)._selected = root._items[3].id;
    await settle();
    expect(fixture.container.querySelectorAll('tr.danger').length).toBe(1);
    const next = buildItems(50);
    (root as any)._items = next;
    await settle();
    expect(trs().length).toBe(50);
    expect(labelAt(0)).toBe(next[0].label);
    expect(labelAt(49)).toBe(next[49].label);
    // stale selection (old id) not present on any new row
    expect(fixture.container.querySelectorAll('.danger').length).toBe(0);
    // old items' label cells are unsubscribed: mutating them is a no-op
    // and new items stay reactive
    next[5].label = 'fresh five';
    await settle();
    expect(labelAt(5)).toBe('fresh five');
  });

  test('clear renders inverse; items again removes inverse', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(8);
    await settle();
    expect(trs().length).toBe(8);
    (root as any)._items = [];
    await settle();
    expect(trs().length).toBe(1);
    expect(trs()[0].textContent).toBe('empty');
    (root as any)._items = buildItems(3);
    await settle();
    expect(trs().length).toBe(3);
    expect(fixture.container.textContent).not.toContain('empty');
  });

  test('duplicate keys: same key value renders distinct position-qualified rows', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    const items = buildItems(3);
    // duplicate the SAME object reference (id collision by construction)
    (root as any)._items = [items[0], items[1], items[0], items[2]];
    await settle();
    expect(trs().length).toBe(4);
    expect(labelAt(0)).toBe(items[0].label);
    expect(labelAt(2)).toBe(items[0].label);
    items[0].label = 'dup updated';
    await settle();
    expect(labelAt(0)).toBe('dup updated');
    expect(labelAt(2)).toBe('dup updated');
    // dedupe back to unique
    (root as any)._items = [items[0], items[1], items[2]];
    await settle();
    expect(trs().length).toBe(3);
  });

  test('rebind: ref-swapped item under a stable key re-points subscriptions', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(4);
    await settle();
    const old = root._items[2];
    const el = trs()[2];
    const replacement: HarnessItem = { id: old.id, label: 'replacement label' };
    cellFor(replacement, 'label');
    const next = [...root._items];
    next[2] = replacement;
    (root as any)._items = next;
    await settle();
    // same key → same row element, new content
    expect(trs()[2]).toBe(el);
    expect(labelAt(2)).toBe('replacement label');
    // new item's cell drives the row…
    replacement.label = 'replacement updated';
    await settle();
    expect(labelAt(2)).toBe('replacement updated');
    // …and the old item's cell no longer does
    old.label = 'stale write';
    await settle();
    expect(labelAt(2)).toBe('replacement updated');
  });

  test('reorder + rebind in the same sync: a ref-swapped item that also MOVES relocates correctly', async () => {
    // Regression: pass 3 pushed EXIST_OLD AFTER rebindFrame had already
    // overwritten frame.index with the NEW position, so the LIS ran over
    // corrupted old positions and skipped required relocations.
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(3);
    await settle();
    const [a, b, c] = root._items;
    const elC = trs()[2];
    // ref-swap c under its stable key AND move it to the front
    const cPrime: HarnessItem = { id: c.id, label: 'c prime' };
    cellFor(cPrime, 'label');
    (root as any)._items = [cPrime, b, a];
    await settle();
    expect(trs().length).toBe(3);
    expect(labelAt(0)).toBe('c prime');
    expect(labelAt(1)).toBe(b.label);
    expect(labelAt(2)).toBe(a.label);
    // same key → same row element, relocated
    expect(trs()[0]).toBe(elC);
    // rebound subscriptions still live at the new position
    cPrime.label = 'c prime updated';
    await settle();
    expect(labelAt(0)).toBe('c prime updated');
  });

  test('error isolation: one throwing slot thunk does not abort the shared-cell sweep or kill the subscription', async () => {
    let boomId = -1;
    class BoomRoot extends Component {
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
      rowClass = (id: number) => {
        if (id === boomId && this._selected === id) {
          throw new Error('boom: bad row thunk');
        }
        return this._selected === id ? 'danger' : '';
      };
      [$template] = template(FRAME_TEMPLATE);
    }
    const root = mountRoot(fixture, BoomRoot as any) as any;
    root._items = buildItems(8);
    await settle();
    boomId = root._items[2].id;
    // select a healthy row first
    root._selected = root._items[5].id;
    await settle();
    expect(trs()[5].className).toBe('danger');
    // select the throwing row: its own slots fail (isolated + reported),
    // but every other row's slots still re-run — row 5 must clear.
    root._selected = boomId;
    await settle();
    expect(trs()[5].className).toBe('');
    // the shared-cell subscription survives: a later select still works
    root._selected = root._items[7].id;
    await settle();
    expect(trs()[7].className).toBe('danger');
    expect(trs()[2].className).toBe(''); // boom row recovered (no longer throws)
    (root as any)._selected = 0;
    await settle();
    expect(fixture.container.querySelectorAll('.danger').length).toBe(0);
  });

  test('probe re-entrancy: a nested slot run during thunk evaluation must not clobber outer dep tracking', async () => {
    // A thunk getter that synchronously flushes opcodes
    // (applyCellUpdateSync → flushCellOpcodes) re-enters runSlot while the
    // outer probe is mid-collection. Regression: both runs shared ONE
    // module-level probe Set — the nested run cleared the outer's
    // already-tracked-but-not-yet-routed deps, so the outer slot never
    // subscribed to them. Needs a SINGLE row (shared routing is list-level
    // and a second row's clean re-run would repair the loss) and a dep
    // (`_y`) first tracked on the very re-run that also triggers the flush.
    let fired = false;
    class ReentryRoot extends Component {
      _items: HarnessItem[] = [];
      _x = 0;
      _mode = 0;
      _y = 'y0';
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
        cellFor(this as any, '_x');
        cellFor(this as any, '_mode');
        cellFor(this as any, '_y');
      }
      get items() {
        return this._items;
      }
      // slot 0 (class): tracks _x → registers the shared-cell entry
      classFor = (id: number) => (this._x === id ? 'mark' : '');
      // slot 1 (text): tracks _mode; once flipped, tracks _y for the FIRST
      // time and triggers a synchronous sweep of _x (nested runSlot) before
      // returning
      compound = (id: number) => {
        if (this._mode === 0) return 'init';
        const v = `${this._y}:${id}`;
        if (!fired) {
          fired = true;
          applyCellUpdateSync(cellFor(this as any, '_x') as Cell<number>, id);
        }
        return v;
      };
      [$template] = template(`
        <ul>
          {{#each this.items key="id" as |item|}}
            <li class={{this.classFor item.id}}>{{this.compound item.id}}</li>
          {{/each}}
        </ul>
      `);
    }
    const root = mountRoot(fixture, ReentryRoot as any) as any;
    root._items = buildItems(1);
    await settle();
    const li = () => fixture.container.querySelector('li')!;
    expect(li().textContent).toBe('init');
    // flip: the slot re-runs, tracks _y for the first time and flushes _x
    // mid-collection (nested runSlot on the same frame's class slot)
    root._mode = 1;
    await settle();
    expect(fired).toBe(true);
    expect(li().textContent).toBe(`y0:${root._items[0].id}`);
    expect(li().className).toBe('mark'); // the nested sweep applied
    // the outer slot's first-time _y dep must have survived the nested run
    root._y = 'y1';
    await settle();
    expect(li().textContent).toBe(`y1:${root._items[0].id}`);
  });

  test('nested sync: a slot thunk synchronously syncing ANOTHER frame list must not corrupt the outer pass', async () => {
    // Cross-list re-entrancy: list A's row thunk (run inside A's
    // syncFrames pass 3 / fresh-render loop) synchronously flushes list B's
    // items cell → B's syncFrames runs NESTED inside A's. Regression: both
    // passes shared ONE set of module-level scratch arrays (KEYS &c.) — B's
    // pass truncated A's keys, so A registered rows under undefined keys.
    let fired = false;
    class NestedSyncRoot extends Component {
      _items: HarnessItem[] = [];
      _itemsB: HarnessItem[] = [];
      _selected = 0;
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
        cellFor(this as any, '_itemsB');
        cellFor(this as any, '_selected');
      }
      get items() {
        return this._items;
      }
      get itemsB() {
        return this._itemsB;
      }
      rowClass = (id: number) => {
        if (!fired) {
          fired = true;
          applyCellUpdateSync(
            cellFor(this as any, '_itemsB') as Cell<HarnessItem[]>,
            buildItems(2, (i) => `B item ${i}`),
          );
        }
        return this._selected === id ? 'danger' : '';
      };
      [$template] = template(`
        <div>
          <table><tbody>
            {{#each this.items key="id" as |item|}}
              <tr class={{this.rowClass item.id}}><td><a>{{item.label}}</a></td></tr>
            {{/each}}
          </tbody></table>
          <ul>
            {{#each this.itemsB key="id" as |item|}}
              <li>{{item.label}}</li>
            {{/each}}
          </ul>
        </div>
      `);
    }
    const root = mountRoot(fixture, NestedSyncRoot as any) as any;
    root._items = buildItems(3);
    await settle();
    expect(fired).toBe(true);
    // outer pass (list A) survived the nested sync intact
    expect(trs().length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(trs()[i].querySelector('a')!.textContent).toBe(
        root._items[i].label,
      );
    }
    // nested pass (list B) rendered correctly too
    const lis = fixture.container.querySelectorAll('li');
    expect(lis.length).toBe(2);
    expect(lis[0].textContent).toBe('B item 0');
    // list A's keyed bookkeeping is sane: reorder + per-item update work
    const reversed = [...root._items].reverse();
    (root as any)._items = reversed;
    await settle();
    expect(trs().length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(trs()[i].querySelector('a')!.textContent).toBe(reversed[i].label);
    }
    reversed[0].label = 'nested sync survivor';
    await settle();
    expect(trs()[0].querySelector('a')!.textContent).toBe(
      'nested sync survivor',
    );
    // and the bookkeeping is leak-free: exactly ONE live subscription per
    // item cell (a corrupted outer pass leaks overwritten frames' subs)
    for (const it of reversed) {
      const cell = cellFor(it, 'label') as any;
      expect(opsForTag.get(cell.id)?.length ?? 0).toBe(1);
    }
  });

  test('teardown ordering: list cleared synchronously from a thunk while a shared-cell sweep is mid-flight', async () => {
    const SENTINEL = -424242;
    let fired = false;
    class MidSweepRoot extends Component {
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
      rowClass = (id: number) => {
        if (this._selected === SENTINEL && !fired) {
          fired = true;
          // synchronous syncList([]) while the sweep iterates frames
          applyCellUpdateSync(
            cellFor(this as any, '_items') as Cell<HarnessItem[]>,
            [],
          );
        }
        return this._selected === id ? 'danger' : '';
      };
      [$template] = template(FRAME_TEMPLATE);
    }
    const root = mountRoot(fixture, MidSweepRoot as any) as any;
    root._items = buildItems(6);
    await settle();
    expect(trs().length).toBe(6);
    root._selected = SENTINEL;
    await settle();
    expect(fired).toBe(true);
    // cleared mid-sweep without corruption; inverse rendered
    expect(trs().length).toBe(1);
    expect(trs()[0].textContent).toBe('empty');
    // the list still works after the mid-sweep teardown
    root._selected = 0;
    root._items = buildItems(4);
    await settle();
    expect(trs().length).toBe(4);
    root._items[1].label = 'post-teardown update';
    await settle();
    expect(labelAt(1)).toBe('post-teardown update');
  });

  test('multi-list shared cell: each list unsubscribes ITS OWN sweep on destroy', async () => {
    class TwoListRoot extends Component {
      _items: HarnessItem[] = [];
      _itemsB: HarnessItem[] = [];
      _selected = 0;
      _showSecond = true;
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
        cellFor(this as any, '_itemsB');
        cellFor(this as any, '_selected');
        cellFor(this as any, '_showSecond');
      }
      get items() {
        return this._items;
      }
      get itemsB() {
        return this._itemsB;
      }
      get showSecond() {
        return this._showSecond;
      }
      rowClass = (id: number) => (this._selected === id ? 'danger' : '');
      [$template] = template(`
        <div>
          <table><tbody>
            {{#each this.items key="id" as |item|}}
              <tr class={{this.rowClass item.id}}><td><a>{{item.label}}</a></td></tr>
            {{/each}}
          </tbody></table>
          {{#if this.showSecond}}
            <ul>
              {{#each this.itemsB key="id" as |item|}}
                <li class={{this.rowClass item.id}}>{{item.label}}</li>
              {{/each}}
            </ul>
          {{/if}}
        </div>
      `);
    }
    const root = mountRoot(fixture, TwoListRoot as any) as any;
    root._items = buildItems(5);
    root._itemsB = buildItems(5);
    await settle();
    expect(trs().length).toBe(5);
    expect(fixture.container.querySelectorAll('li').length).toBe(5);
    const selectedCell = cellFor(root, '_selected') as Cell<number>;
    // both lists' sweeps react
    root._selected = root._items[1].id;
    await settle();
    expect(fixture.container.querySelectorAll('tr.danger').length).toBe(1);
    root._selected = root._itemsB[2].id;
    await settle();
    expect(fixture.container.querySelectorAll('li.danger').length).toBe(1);
    const opsWithBoth = opsForTag.get((selectedCell as any).id)?.length ?? 0;
    expect(opsWithBoth).toBeGreaterThanOrEqual(2);
    // destroy ONLY the second list ({{#if}} false) → its sweep unsubscribes
    root._showSecond = false;
    await settle();
    expect(fixture.container.querySelectorAll('li').length).toBe(0);
    const opsAfter = opsForTag.get((selectedCell as any).id)?.length ?? 0;
    expect(opsAfter).toBeLessThan(opsWithBoth);
    // the surviving list keeps reacting through ITS subscription
    root._selected = root._items[3].id;
    await settle();
    expect(trs()[3].className).toBe('danger');
  });

  test('rebind balance: repeated ref-swaps under a stable key neither leak nor double-subscribe', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(5);
    await settle();
    let current = root._items[2];
    const stableId = current.id;
    const opsBaseline = opsForTag.size;
    const relatedBaseline = relatedTags.size;
    for (let cycle = 0; cycle < 25; cycle++) {
      const oldCell = cellFor(current, 'label') as any;
      const replacement: HarnessItem = {
        id: stableId,
        label: `swap ${cycle}`,
      };
      cellFor(replacement, 'label');
      const next = [...root._items];
      next[2] = replacement;
      (root as any)._items = next;
      await settle();
      // the OLD item's cell fully unsubscribed (ops array emptied + deleted)
      expect(opsForTag.has(oldCell.id)).toBe(false);
      expect(labelAt(2)).toBe(`swap ${cycle}`);
      current = replacement;
    }
    expect(opsForTag.size).toBe(opsBaseline);
    expect(relatedTags.size).toBe(relatedBaseline);
    // exactly ONE live subscription on the current item's cell
    const liveCell = cellFor(current, 'label') as any;
    expect(opsForTag.get(liveCell.id)?.length).toBe(1);
    // and it still works
    current.label = 'final swap check';
    await settle();
    expect(labelAt(2)).toBe('final swap check');
  });

  test('duplicate keys: reorder with a duplicated ref keeps position-qualified rows consistent', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    const items = buildItems(2);
    const [a, b] = items;
    (root as any)._items = [a, b, a];
    await settle();
    expect(trs().length).toBe(3);
    // move the duplicate occurrence: [a, b, a] → [a, a, b]
    (root as any)._items = [a, a, b];
    await settle();
    expect(trs().length).toBe(3);
    expect(labelAt(0)).toBe(a.label);
    expect(labelAt(1)).toBe(a.label);
    expect(labelAt(2)).toBe(b.label);
    // both dup rows still track the shared item cell
    a.label = 'dup reorder updated';
    await settle();
    expect(labelAt(0)).toBe('dup reorder updated');
    expect(labelAt(1)).toBe('dup reorder updated');
    expect(labelAt(2)).toBe(b.label);
  });

  test('no subscription leak: opsForTag/relatedTags bounded across create+clear cycles', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(30);
    await settle();
    (root as any)._items = [];
    await settle();
    const opsAfterFirst = opsForTag.size;
    const relatedAfterFirst = relatedTags.size;
    for (let cycle = 0; cycle < 5; cycle++) {
      (root as any)._items = buildItems(30);
      await settle();
      (root as any)._items = [];
      await settle();
    }
    expect(opsForTag.size).toBe(opsAfterFirst);
    expect(relatedTags.size).toBe(relatedAfterFirst);
  });

  test('gate: event-bodied each stays on v1 (per-item markers present)', async () => {
    const EVENT_TEMPLATE = `
      <table><tbody>
        {{#each this.items key="id" as |item|}}
          <tr><td><button {{on "click" this.rowClass}}>{{item.label}}</button></td></tr>
        {{/each}}
      </tbody></table>
    `;
    const root = mountRoot(fixture, defineRoot(EVENT_TEMPLATE));
    const empty = rowMarkerComments();
    (root as any)._items = buildItems(4);
    await settle();
    expect(trs().length).toBe(4);
    // v1 adds one marker comment per row
    expect(rowMarkerComments()).toBe(empty + 4);
  });

  test('gate: index-reading body stays on v1 and renders live indices', async () => {
    const INDEX_TEMPLATE = `
      <table><tbody>
        {{#each this.items key="id" as |item index|}}
          <tr><td>{{index}}</td><td><a>{{item.label}}</a></td></tr>
        {{/each}}
      </tbody></table>
    `;
    const root = mountRoot(fixture, defineRoot(INDEX_TEMPLATE));
    const empty = rowMarkerComments();
    (root as any)._items = buildItems(3);
    await settle();
    expect(trs().length).toBe(3);
    expect(rowMarkerComments()).toBe(empty + 3);
    expect(idAt(0)).toBe('0');
    expect(idAt(2)).toBe('2');
  });

  test('attr slots: dynamic + static attributes apply and update', async () => {
    const ATTR_TEMPLATE = `
      <ul>
        {{#each this.items key="id" as |item|}}
          <li data-id={{item.id}} title={{item.label}} data-static="yes">{{item.label}}</li>
        {{/each}}
      </ul>
    `;
    const root = mountRoot(fixture, defineRoot(ATTR_TEMPLATE));
    (root as any)._items = buildItems(3);
    await settle();
    const lis = fixture.container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(lis[0].getAttribute('data-id')).toBe(String(root._items[0].id));
    expect(lis[0].getAttribute('title')).toBe(root._items[0].label);
    expect(lis[0].getAttribute('data-static')).toBe('yes');
    root._items[1].label = 'attr updated';
    await settle();
    expect(
      fixture.container.querySelectorAll('li')[1].getAttribute('title'),
    ).toBe('attr updated');
    expect(
      fixture.container.querySelectorAll('li')[1].textContent,
    ).toBe('attr updated');
  });

  test('list destroy (unmount) reclaims frame subscriptions', async () => {
    const root = mountRoot(fixture, defineRoot(FRAME_TEMPLATE));
    (root as any)._items = buildItems(15);
    await settle();
    expect(trs().length).toBe(15);
    const items = root._items;
    // destroy the WHOLE component tree from the render root (runs the list's
    // destructors, incl. destroyFrameState) — fixture.cleanup() only wipes
    // the tree maps. The list parents under the mount-level component, so the
    // cascade must start at the root.
    destroyElementSync(fixture.root as unknown as ComponentLike, true, fixture.api);
    // the default {{#each}} is the ASYNC list — its teardown destructor
    // resolves on a microtask
    await settle();
    // post-unmount, the item cells must not be left in opsForTag
    for (const item of items) {
      const cell = cellFor(item, 'label');
      expect(opsForTag.has((cell as any).id)).toBe(false);
    }
  });
});
