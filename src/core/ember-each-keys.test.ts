/**
 * Ember compat: Glimmer's `@identity` key for primitive items.
 *
 * Under `@identity` a primitive (and `null` / `undefined`) row is keyed by its
 * value (type-qualified; duplicates position-qualified), so a moved primitive
 * keeps its node and its index follows it. Compat keyed primitives by
 * position (`value:index`) and re-created a moved row; only the native
 * runtime keyed them by value.
 */
import { describe, test, expect } from 'vitest';
import { compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { cell } from './reactive';
import { syncDom } from './runtime';

describe('Ember compat: {{#each}} @identity of primitives', () => {
  const compat = useEmberCompatRuntime();
  const items = () => Array.from(compat.fixture.container.querySelectorAll('li'));

  test('@identity keeps the node of a moved primitive (and null)', async () => {
    const list = cell<unknown[]>([null, 1, 'x']);
    compat.render(
      compileCompat(
        '<ul>{{#each this.list.value key="@identity" as |item index|}}<li>{{index}}</li>{{/each}}</ul>',
      ),
      { list },
    );
    const [nullItem, one, x] = items();
    list.update(['x', 1, null]);
    await syncDom();
    const after = items();
    expect(after).toEqual([x, one, nullItem]);
    expect(after.map((li) => li.textContent)).toEqual(['0', '1', '2']);
  });
});
