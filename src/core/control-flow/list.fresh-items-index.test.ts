/**
 * `{{#each source as |item index|}}` over an iterable that yields a NEW object
 * per item on every iteration (a Map yields fresh `[key, value]` entries; a
 * generator may build its items as it goes).
 *
 * A row's index formula locates the row's item in a fresh read of the source:
 * by identity, then by key. A fresh item is found by neither, and the index was
 * -1. Glimmer's index is the item's position in the iteration that created or
 * last moved the row, which is the position the list gave the row.
 */
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from '../__test-utils__/ember-compat';
import { cell } from '../reactive';
import { syncDom } from '../runtime';

/** An iterable whose items are new objects on every iteration. */
function freshItems(names: string[]) {
  return {
    *[Symbol.iterator]() {
      for (const name of names) yield { name };
    },
  };
}

const SYNC_LIST = { FORCE_SYNC_LIST: true };
const MAP_TPL = '{{#each source.value as |entry i|}}[{{i}}:{{entry.length}}]{{/each}}';
const ITEMS_TPL = '{{#each source.value as |item i|}}[{{i}}{{item.name}}]{{/each}}';

describe('each over an iterable of fresh items: the index', () => {
  const compat = useEmberCompatRuntime();

  test("a Map's entries", async () => {
    const source = cell(new Map<string, number>([['foo', 1], ['bar', 2]]));
    compat.render(compileCompat(MAP_TPL, { source }, SYNC_LIST));
    expect(compat.fixture.container.textContent).toBe('[0:2][1:2]');

    source.update(new Map([['foo', 1], ['bar', 2], ['baz', 3]]));
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[0:2][1:2][2:2]');
  });

  test("a Map's entries in the async list", async () => {
    const source = cell(new Map<string, number>([['foo', 1], ['bar', 2]]));
    compat.render(compileCompat(MAP_TPL, { source }));
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[0:2][1:2]');
  });

  test("a generator's items", async () => {
    const source = cell(freshItems(['a', 'b']));
    compat.render(compileCompat(ITEMS_TPL, { source }, SYNC_LIST));
    expect(compat.fixture.container.textContent).toBe('[0a][1b]');

    source.update(freshItems(['c', 'a', 'b']));
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[0c][1a][2b]');
  });

  test('an array still locates its items after a move', async () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    const source = cell([a, b]);
    compat.render(compileCompat(ITEMS_TPL, { source }, SYNC_LIST));
    expect(compat.fixture.container.textContent).toBe('[0a][1b]');

    source.update([b, a]);
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[0b][1a]');
  });
});
