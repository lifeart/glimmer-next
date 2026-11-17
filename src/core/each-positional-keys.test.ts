/**
 * Positional `{{#each key="@index"}}` keys (emberjs/ember.js#21340: the
 * `@index`-key Updating test and native "@key keys items by position").
 *
 * `@index` keys a row by its POSITION, so a reorder leaves every row node in
 * place (no move — "node has not changed") and `@index` yields the stable
 * position. A row is built with a reference to its item and reads the item
 * through it, so a kept row shows the item now at its position — an object, a
 * primitive or an array a nested `{{#each}}` iterates — without being
 * re-created. `key="@key"` is the same key for an `{{#each}}`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
} from './__test-utils__/list-harness';
import { Component } from './component';
import { $template } from './shared';
import { cellFor } from './reactive';
import { template } from '../../plugins/runtime-compiler';
import { HOST_HOOKS } from './host-hooks';

function defineRoot(tpl: string) {
  class Root extends Component {
    _items: unknown[] = [];
    constructor(args: any) {
      super(args);
      cellFor(this as any, '_items');
    }
    get items() {
      return this._items;
    }
    [$template] = template(tpl);
  }
  return Root as unknown as new (args: any) => Component<any> & {
    _items: unknown[];
  };
}

const indexRoot = (eachKey: string) =>
  defineRoot(
    `<ul>{{#each this.items key="${eachKey}" as |item index|}}<li data-item-id={{item.id}}>{{item.label}}:{{index}}</li>{{/each}}</ul>`,
  );

describe('positional {{#each key="@index"}} keys (rows stay in place on reorder)', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  const lis = () => Array.from(fixture.container.querySelectorAll('li'));
  const texts = () => lis().map((li) => li.textContent);

  test('@index keeps row nodes in place on reorder, yields the position and shows the new items', async () => {
    const root = mountRoot(fixture, indexRoot('@index'));
    const [a, b, c] = buildItems(3, (i) => `L${i}`);
    root._items = [a, b, c];
    await settle();

    const before = lis();
    expect(texts()).toEqual(['L0:0', 'L1:1', 'L2:2']);

    // Reverse the items.
    root._items = [c, b, a];
    await settle();

    const after = lis();
    expect(after).toHaveLength(3);
    // Position keys: every row node stays at its position (none moved).
    expect(after).toEqual(before);
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
    // ... and shows the item now at its position, at its stable index.
    expect(texts()).toEqual(['L2:0', 'L1:1', 'L0:2']);
    expect(after.map((li) => li.dataset.itemId)).toEqual([c, b, a].map((x) => String(x.id)));

    // A kept row stays reactive on its new item.
    c.label = 'L2b';
    await settle();
    expect(texts()).toEqual(['L2b:0', 'L1:1', 'L0:2']);
  });

  test('key="@key" keys an {{#each}} by position too', async () => {
    const root = mountRoot(fixture, indexRoot('@key'));
    const [a, b] = buildItems(2, (i) => `K${i}`);
    root._items = [a, b];
    await settle();
    const before = lis();

    root._items = [b, a];
    await settle();
    expect(lis()).toEqual(before);
    expect(texts()).toEqual(['K1:0', 'K0:1']);
  });

  test('@identity (contrast) MOVES nodes on reorder', async () => {
    const root = mountRoot(fixture, indexRoot('@identity'));
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

  test('a row of a primitive shows the value now at its position', async () => {
    const root = mountRoot(
      fixture,
      defineRoot('<ul>{{#each this.items key="@index" as |name|}}<li>{{name}}</li>{{/each}}</ul>'),
    );
    root._items = ['Foo', 4];
    await settle();
    const before = lis();
    expect(texts()).toEqual(['Foo', '4']);

    root._items = ['Bar', 4, 'Baz'];
    await settle();
    expect(texts()).toEqual(['Bar', '4', 'Baz']);
    expect(lis()[0]).toBe(before[0]);
    expect(lis()[1]).toBe(before[1]);

    root._items = ['Baz'];
    await settle();
    expect(texts()).toEqual(['Baz']);
    expect(lis()[0]).toBe(before[0]);
  });

  test('a nested {{#each}} over the item iterates the array now at its position', async () => {
    const root = mountRoot(
      fixture,
      defineRoot(
        '<div>{{#each this.items key="@index" as |list|}}<p>{{#each list as |word|}}<i>{{word}}</i>{{/each}}</p>{{/each}}</div>',
      ),
    );
    root._items = [['caterpillar']];
    await settle();
    const p = fixture.container.querySelector('p');
    expect(fixture.container.textContent).toBe('caterpillar');

    root._items = [['lady', 'bird']];
    await settle();
    expect(fixture.container.textContent).toBe('ladybird');
    expect(fixture.container.querySelector('p')).toBe(p);

    root._items = [['caterpillar'], ['bird']];
    await settle();
    expect(fixture.container.textContent).toBe('caterpillarbird');
  });

  test('a row appended by a growing update keeps its position as its index', async () => {
    const root = mountRoot(fixture, indexRoot('@index'));
    const [a, b, c] = buildItems(3, (i) => `A${i}`);
    root._items = [a, b];
    await settle();
    // append-only growth builds the third row on its own
    root._items = [a, b, c];
    await settle();
    expect(texts()).toEqual(['A0:0', 'A1:1', 'A2:2']);

    root._items = [c, a, b];
    await settle();
    expect(texts()).toEqual(['A2:0', 'A0:1', 'A1:2']);
  });

  test('the host rebindEachItem hook is not called for a positional row: its reference names its item', async () => {
    const calls: Array<[unknown, unknown]> = [];
    HOST_HOOKS.rebindEachItem = (oldItem, newItem) => {
      calls.push([oldItem, newItem]);
    };
    try {
      const root = mountRoot(fixture, indexRoot('@index'));
      const [a, b, c] = buildItems(3);
      root._items = [a, b, c];
      await settle();

      root._items = [c, b, a];
      await settle();

      expect(calls).toEqual([]);
      expect(lis().map((li) => li.dataset.itemId)).toEqual([c, b, a].map((x) => String(x.id)));
    } finally {
      delete (HOST_HOOKS as Record<string, unknown>).rebindEachItem;
    }
  });
});
