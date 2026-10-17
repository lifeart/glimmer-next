/**
 * A keyed `{{#each}}` row reused for a NEW object with the same key is
 * re-bound to that object (the host's `rebindEachItem` hook), also when the
 * list grows in the same update.
 *
 * `syncList` takes an append-only fast path when every existing key keeps its
 * position and items were only added at the end: it builds the new tail rows
 * and leaves the prefix alone. It skipped the keyed-reuse re-bind of the
 * general diff, so a prefix row whose object was replaced (same key, new
 * object) kept rendering the old object: in Ember,
 * `[{key: 2, name: 'Kris Selden'}]` → `[…, {key: 2, name: 'Kristoph Selden'},
 * {key: 3, …}]` still showed "Kris Selden". Same-length updates re-bound.
 *
 * Pure fix: without a host hook nothing is re-bound, as before.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { HOST_HOOKS } from './host-hooks';
import { cell } from './reactive';
import { syncDom, takeRenderingControl } from './runtime';

type Person = { key: string; name: string };

describe.each([
  ['async list', {}],
  ['sync list (Ember compat: FORCE_SYNC_LIST)', { FORCE_SYNC_LIST: true }],
] as const)('a keyed row reused for a new object is re-bound when the list grows: %s', (_label, flags) => {
  const compat = useEmberCompatRuntime();
  let release: () => void;
  let saved: typeof HOST_HOOKS.rebindEachItem;
  let rebinds: string[];
  beforeEach(() => {
    release = takeRenderingControl();
    saved = HOST_HOOKS.rebindEachItem;
    rebinds = [];
    HOST_HOOKS.rebindEachItem = (oldItem, newItem) => {
      rebinds.push(`${(oldItem as Person).name} -> ${(newItem as Person).name}`);
    };
  });
  afterEach(() => {
    HOST_HOOKS.rebindEachItem = saved;
    release();
  });

  const template = () =>
    compileCompat('<ul>{{#each this.list.value key="key" as |item|}}<li>{{item.name}}</li>{{/each}}</ul>', {}, flags);

  test('the prefix rows whose object changed are re-bound, then the tail is appended', async () => {
    const list = cell<Person[]>([
      { key: '1', name: 'Martin' },
      { key: '2', name: 'Kris Selden' },
    ]);
    compat.render(template(), { list });
    list.update([
      { key: '1', name: 'Martin' },
      { key: '2', name: 'Kristoph Selden' },
      { key: '3', name: 'Matthew Beale' },
    ]);
    await syncDom();
    expect(rebinds).toEqual(['Martin -> Martin', 'Kris Selden -> Kristoph Selden']);
    expect(compat.fixture.container.querySelectorAll('li')).toHaveLength(3);
  });

  test('a prefix row with the same object is not re-bound', async () => {
    const martin = { key: '1', name: 'Martin' };
    const kris = { key: '2', name: 'Kris Selden' };
    const list = cell<Person[]>([martin, kris]);
    compat.render(template(), { list });
    list.update([martin, { key: '2', name: 'Kristoph Selden' }, { key: '3', name: 'Matthew Beale' }]);
    await syncDom();
    expect(rebinds).toEqual(['Kris Selden -> Kristoph Selden']);
    // The next update re-binds against the object bound now.
    list.update([martin, { key: '2', name: 'Kristoph' }, { key: '3', name: 'Matthew Beale' }, { key: '4', name: 'Robert' }]);
    await syncDom();
    expect(rebinds).toEqual([
      'Kris Selden -> Kristoph Selden',
      'Kristoph Selden -> Kristoph',
      'Matthew Beale -> Matthew Beale',
    ]);
  });

  test('a same-length update re-binds (guard)', async () => {
    const list = cell<Person[]>([{ key: '1', name: 'Martin' }]);
    compat.render(template(), { list });
    list.update([{ key: '1', name: 'Martin Muñoz' }]);
    await syncDom();
    expect(rebinds).toEqual(['Martin -> Martin Muñoz']);
  });
});
