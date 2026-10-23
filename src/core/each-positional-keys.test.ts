/**
 * R10 (ember.js#21340 C36, N20): positional `{{#each key="@index"}}` keys.
 *
 * `@index` keys a row by its POSITION, so a reorder leaves every row node in
 * place (no move — "node has not changed") and `@index` yields the stable
 * position; the row's bound item is rebound in place (the host's
 * `rebindEachItem` body-proxy swap — observed here via the seam). Previously the
 * compiler rewrote `@index` to `@identity`, which keyed by value and moved rows.
 *
 * Standalone gxt has no body-proxy, so a reused row's DISPLAYED item does not
 * change without a host; these tests cover the achievable core — node identity,
 * the positional index, and that the rebind seam fires. The item-content update
 * itself is validated by #21340 C36/N20 in Ember CI.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from './__test-utils__/list-harness';
import { Component } from './component';
import { $template } from './shared';
import { cellFor } from './reactive';
import { template } from '../../plugins/runtime-compiler';
import { HOST_HOOKS } from './host-hooks';

function defineIndexRoot(eachKey: string) {
  const TPL = `<ul>{{#each this.items key="${eachKey}" as |item index|}}<li data-item-id={{item.id}}>idx:{{index}}</li>{{/each}}</ul>`;
  class Root extends Component {
    _items: HarnessItem[] = [];
    constructor(args: any) {
      super(args);
      cellFor(this as any, '_items');
    }
    get items() {
      return this._items;
    }
    [$template] = template(TPL);
  }
  return Root as unknown as new (args: any) => Component<any> & {
    _items: HarnessItem[];
  };
}

describe('positional {{#each key="@index"}} keys (R10)', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  const lis = () => Array.from(fixture.container.querySelectorAll('li'));

  test('@index keeps row nodes in place on reorder and yields the position', async () => {
    const root = mountRoot(fixture, defineIndexRoot('@index'));
    const [a, b, c] = buildItems(3);
    root._items = [a, b, c];
    await settle();

    const before = lis();
    expect(before).toHaveLength(3);
    expect(before.map((li) => li.textContent)).toEqual(['idx:0', 'idx:1', 'idx:2']);

    // Reverse the items.
    root._items = [c, b, a];
    await settle();

    const after = lis();
    expect(after).toHaveLength(3);
    // Position keys: every row node stays at its position (none moved).
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
    // `@index` still yields the stable position at each row.
    expect(after.map((li) => li.textContent)).toEqual(['idx:0', 'idx:1', 'idx:2']);
  });

  test('@identity (contrast) MOVES nodes on reorder', async () => {
    const root = mountRoot(fixture, defineIndexRoot('@identity'));
    const [a, b, c] = buildItems(3);
    root._items = [a, b, c];
    await settle();
    const before = lis();

    root._items = [c, b, a];
    await settle();
    const after = lis();

    // With identity keying a reversal relocates nodes: position 0 is no longer
    // the node that was there (it now holds c's node, originally last).
    expect(after[0]).not.toBe(before[0]);
    expect(after[0]).toBe(before[2]);
  });

  test('@index fires the rebindEachItem seam for each position whose item changed', async () => {
    const calls: Array<[unknown, unknown]> = [];
    HOST_HOOKS.rebindEachItem = (oldItem, newItem) => {
      calls.push([oldItem, newItem]);
    };
    try {
      const root = mountRoot(fixture, defineIndexRoot('@index'));
      const [a, b, c] = buildItems(3);
      root._items = [a, b, c];
      await settle();
      calls.length = 0;

      // Reverse: positions 0 and 2 change their bound item; position 1 (b) does not.
      root._items = [c, b, a];
      await settle();

      expect(calls).toContainEqual([a, c]);
      expect(calls).toContainEqual([c, a]);
      // The unchanged middle row is not rebound.
      expect(calls.some(([, nv]) => nv === b)).toBe(false);
    } finally {
      delete (HOST_HOOKS as Record<string, unknown>).rebindEachItem;
    }
  });
});
