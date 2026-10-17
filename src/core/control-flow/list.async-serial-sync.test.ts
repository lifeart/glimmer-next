/**
 * The async list (`$_each`) applies one sync at a time.
 *
 * Its sync awaits the teardown of the rows it removes (async element
 * destructors) before it renders the new ones. One DOM sync can run the list's
 * opcode twice, and a second sync that started while the first was waiting
 * found the old rows' keys already gone, rendered the new rows, and the first
 * sync then rendered them again: with a source whose items are new objects on
 * every read (a Map's entries, `(array (array …))` re-evaluated), the list
 * showed every row twice, one more copy per update.
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

describe('async list: one sync at a time', () => {
  const compat = useEmberCompatRuntime();

  test('a source of fresh items replaced by another', async () => {
    const source = cell(freshItems(['a', 'b']));
    compat.render(compileCompat('{{#each source.value as |item|}}[{{item.name}}]{{/each}}', { source }));
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[a][b]');

    source.update(freshItems(['c', 'd', 'e']));
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[c][d][e]');

    source.update(freshItems(['f']));
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('[f]');
  });

  test('nested eaches over (array (array …)) show one copy after each update', async () => {
    const one = cell('Tom');
    const two = cell('Yehuda');
    // A helper returning a new array per call, as Ember's `array` does: every
    // read of the outer source is a new outer array holding a new inner one.
    const array = (...items: unknown[]) => items;
    compat.render(
      compileCompat(
        '{{#each (array (array one.value two.value)) as |people|}}List: {{#each people as |person|}}{{person}}, {{/each}}{{/each}}',
        { one, two, array },
      ),
    );
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Tom, Yehuda, ');

    one.update('Chad');
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Chad, Yehuda, ');

    two.update('Balint');
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Chad, Balint, ');

    one.update('Tom');
    two.update('Yehuda');
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Tom, Yehuda, ');
  });

  test('the same through a {{#let}} of (array (array …))', async () => {
    const one = cell('Tom');
    const two = cell('Yehuda');
    // A helper returning a new array per call, as Ember's `array` does.
    const array = (...items: unknown[]) => items;
    compat.render(
      compileCompat(
        '{{#let (array (array one.value two.value)) as |lists|}}{{#each lists as |people|}}List: {{#each people as |person|}}{{person}}, {{/each}}{{/each}}{{/let}}',
        { one, two, array },
      ),
    );
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Tom, Yehuda, ');

    one.update('Chad');
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Chad, Yehuda, ');

    two.update('Tom');
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Chad, Tom, ');

    one.update('Tom');
    two.update('Yehuda');
    await syncDom();
    expect(compat.fixture.container.textContent).toBe('List: Tom, Yehuda, ');
  });

  test('an array source keeps its rows', async () => {
    const a = { name: 'a' };
    const b = { name: 'b' };
    const source = cell([a, b]);
    compat.render(compileCompat('{{#each source.value as |item|}}<i>{{item.name}}</i>{{/each}}', { source }));
    await syncDom();
    const [first, second] = Array.from(compat.fixture.container.querySelectorAll('i'));
    source.update([b, a, { name: 'c' }]);
    await syncDom();
    const after = Array.from(compat.fixture.container.querySelectorAll('i'));
    expect(after.map((i) => i.textContent)).toEqual(['b', 'a', 'c']);
    expect(after[0]).toBe(second);
    expect(after[1]).toBe(first);
  });
});
