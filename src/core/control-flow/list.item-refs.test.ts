/**
 * A positional list's kept rows read their item through a reference, which an
 * update points at the item now at the row once every row is placed
 * (`flushItemRefs`). When building a new row throws, the update stops there,
 * but the kept rows are bound to their new items already: their references
 * follow them, and no write queued by the failed update lands in a later one.
 */
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi } from '../dom-api';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, PARENT, TREE, CHILD } from '../shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { Root } from '../dom';
import { SyncListComponent } from './list';
import { cell, type Cell } from '../reactive';
import { registerItemReferenceRuntime } from '../item-references';

type Item = { id: number; name: string };

describe('item references of a positional list when building a row throws', () => {
  let window: Window;
  let document: Document;
  let container: HTMLElement;

  beforeEach(() => {
    // the rows of a positional list are built by the item reference runtime
    registerItemReferenceRuntime();
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  test('the kept rows hold the items they are bound to, and a later update writes only its own', () => {
    const api = new HTMLBrowserDOMApi(document);
    const root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parent);

    const a: Item = { id: 1, name: 'a' };
    const b: Item = { id: 2, name: 'b' };
    const c: Item = { id: 3, name: 'c' };
    const boom: Item = { id: 4, name: 'boom' };
    const refs: Array<Cell<Item>> = [];
    const list = new SyncListComponent<Item>(
      {
        tag: cell([a, b]),
        key: '@index',
        ctx: parent,
        ItemComponent: (item: Item) => {
          const ref = item as unknown as Cell<Item>;
          if (ref.value === boom) throw new Error('boom');
          refs.push(ref);
          return document.createElement('div');
        },
      },
      container,
      document.createComment('list top'),
    );
    expect(refs.map((ref) => ref.value)).toEqual([a, b]);

    expect(() => list.syncList([b, a, boom])).toThrow('boom');
    expect(refs.map((ref) => ref.value)).toEqual([b, a]);

    // Back to what the rows showed before the failed update: each kept row is
    // pointed back (no write of the failed update is left to land later).
    list.syncList([a, b]);
    expect(refs.map((ref) => ref.value)).toEqual([a, b]);

    list.syncList([c, b]);
    expect(refs.map((ref) => ref.value)).toEqual([c, b]);
  });
});
