/**
 * The async list (`$_each`) destroys a removed row asynchronously: its async
 * element destructors (a fade-out) are awaited before the row's marker goes.
 * A row built for the same key meanwhile — the item added back, a position a
 * shrunk positional list grows into again — gets a marker of its own; the
 * late teardown of the old row must not remove it, or the new row can no
 * longer be moved.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from '../__test-utils__/list-harness';
import { Component } from '../component';
import { $template } from '../shared';
import { cellFor } from '../reactive';
import { template } from '../../../plugins/runtime-compiler';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('async list: a late row teardown keeps the marker of a new row of the same key', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  function defineRoot(eachKey: string) {
    class Root extends Component {
      _items: unknown[] = [];
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
      }
      get items() {
        return this._items;
      }
      // An element destructor that finishes later, as a fade-out does.
      slowly = () => async () => {
        await delay(20);
      };
      // Text around the row's element: an unstable row, whose async element
      // destructors the list awaits.
      [$template] = template(
        `<ul>{{#each this.items key="${eachKey}" as |item|}}-<li {{this.slowly}}>{{item.id}}</li>{{/each}}</ul>`,
      );
    }
    return Root as unknown as new (args: any) => Component<any> & { _items: unknown[] };
  }
  const ids = () =>
    Array.from(fixture.container.querySelectorAll('li')).map((li) => li.textContent);

  test('an item added back while its row is torn down can still be moved', async () => {
    const root = mountRoot(fixture, defineRoot('@identity'));
    const a = { id: 'a' };
    const b = { id: 'b' };
    root._items = [a, b];
    await settle();
    expect(ids()).toEqual(['a', 'b']);

    root._items = [a];
    await settle();
    // b is added back while its old row's async teardown runs
    root._items = [a, b];
    await settle();
    await delay(50);
    expect(ids()).toEqual(['a', 'b']);

    root._items = [b, a];
    await settle();
    expect(ids()).toEqual(['b', 'a']);
  });

  test('a positional list grown back while a row is torn down keeps every row in order', async () => {
    const root = mountRoot(fixture, defineRoot('@index'));
    root._items = [{ id: 'a' }, { id: 'b' }];
    await settle();

    root._items = [{ id: 'a' }];
    await settle();
    root._items = [{ id: 'a' }, { id: 'c' }];
    await settle();
    await delay(50);
    expect(ids()).toEqual(['a', 'c']);

    root._items = [{ id: 'd' }, { id: 'e' }, { id: 'f' }];
    await settle();
    expect(ids()).toEqual(['d', 'e', 'f']);
  });
});
