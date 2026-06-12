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
import { cellFor, opsForTag, relatedTags } from '../reactive';
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
