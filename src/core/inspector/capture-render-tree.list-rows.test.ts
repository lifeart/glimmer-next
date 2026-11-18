/**
 * The render-tree capture reads a list's rows structurally (`listRows` in
 * capture-render-tree.ts: the component's `keyMap`, when it is a `Map`), so it
 * does not import the list classes. capture-render-tree.test.ts pins the
 * captured shape over list fixtures; this pins what those fixtures stand for
 * on the real classes: the sync and the async list each keep every row's
 * rendered result in a `keyMap` Map, by row key, and drop a removed row from it.
 */
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi } from '../dom-api';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, PARENT, TREE, CHILD } from '../shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { Root } from '../dom';
import { cell } from '../reactive';
import { SyncListComponent, AsyncListComponent } from '../control-flow/list';

type Item = { id: number };

describe('the list classes keep their rows where the render-tree capture reads them', () => {
  let window: Window;
  let document: Document;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, new HTMLBrowserDOMApi(document));
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

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  async function createList(kind: 'sync' | 'async', items: Item[]) {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parent);
    // What the row body rendered for each item, as the list got it.
    const rendered = new Map<number, Node[]>();
    const itemsCell = cell(items);
    const args = {
      tag: itemsCell,
      key: 'id',
      ctx: parent,
      ItemComponent: (item: Item) => {
        const div = document.createElement('div');
        div.textContent = String(item.id);
        const row = [div];
        rendered.set(item.id, row);
        return row;
      },
    };
    const topMarker = document.createComment('list top');
    const list =
      kind === 'sync'
        ? new SyncListComponent<Item>(args, container, topMarker)
        : new AsyncListComponent<Item>(args, container, topMarker);
    await settle();
    return { list, itemsCell, rendered };
  }

  for (const kind of ['sync', 'async'] as const) {
    test(`the ${kind} list: a keyMap Map holds each row's rendered result, by row key`, async () => {
      const [a, b, c] = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const { list, itemsCell, rendered } = await createList(kind, [a, b, c]);
      expect(list.keyMap).toBeInstanceOf(Map);
      const rows = Array.from(list.keyMap.values());
      expect(rows).toHaveLength(3);
      rows.forEach((row, i) => expect(row).toBe(rendered.get(i + 1)));

      itemsCell.update([a, c]);
      await settle();
      const kept = Array.from(list.keyMap.values());
      expect(kept).toHaveLength(2);
      expect(kept[0]).toBe(rendered.get(1));
      expect(kept[1]).toBe(rendered.get(3));
    });
  }
});
