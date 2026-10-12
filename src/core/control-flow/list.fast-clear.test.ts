/**
 * `SyncListComponent.fastCleanup` — the bulk clear (`clearChildren(parent)`)
 * of a list that goes empty. It is only correct when the list owns its parent;
 * static Text nodes outside the markers (Glimmer whitespace, kept by the Ember
 * native build: `<tbody>\n  {{#each}}…{{/each}}\n</tbody>`) do not disqualify
 * it — they are put back, the same node objects. Any other sibling (an element,
 * another block's comment anchor) keeps the per-row removal path.
 *
 * (The per-row tests do not compare the whole child list: under vitest
 * `IN_SSR_ENV` is on, which keeps the first render's fragment target comment.)
 */
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi, DOMApi } from '../dom-api';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, PARENT, TREE, CHILD } from '../shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { Root } from '../dom';
import { SyncListComponent } from './list';
import { cell } from '../reactive';

type Item = { id: number };

describe('SyncListComponent fastCleanup with siblings outside the markers', () => {
  let window: Window;
  let document: Document;
  let container: HTMLElement;
  let clearChildrenCalls: Node[];
  let destroyedNodes: Node[];

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    container = document.createElement('div');
    document.body.appendChild(container);
    clearChildrenCalls = [];
    destroyedNodes = [];
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  /**
   * Render a keyed list of `<div data-id>` rows into `container`, with `before`
   * appended ahead of the list and `after` behind it.
   */
  function renderList(items: Item[], before: Node[], after: Node[]) {
    const realApi: DOMApi = new HTMLBrowserDOMApi(document);
    const api = Object.create(realApi) as DOMApi;
    api.clearChildren = (element: Node) => {
      clearChildrenCalls.push(element);
      realApi.clearChildren(element);
    };
    api.destroy = (node: Node) => {
      destroyedNodes.push(node);
      realApi.destroy(node);
    };
    const root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parent);

    for (const node of before) container.appendChild(node);
    const itemsCell = cell(items);
    const list = new SyncListComponent<Item>(
      {
        tag: itemsCell,
        key: 'id',
        ctx: parent,
        ItemComponent: (item: Item) => {
          const div = document.createElement('div');
          div.setAttribute('data-id', String(item.id));
          div.textContent = String(item.id);
          return div;
        },
      },
      container,
      document.createComment('list top'),
    );
    for (const node of after) container.appendChild(node);
    return { list, itemsCell };
  }

  const rowIds = () =>
    Array.from(container.querySelectorAll('div[data-id]')).map((div) =>
      div.getAttribute('data-id'),
    );

  test('text on both sides: one bulk clear, the same DOM and the same text nodes', async () => {
    const lead = document.createTextNode('\n  ');
    const trail = document.createTextNode('\n');
    const { list, itemsCell } = renderList([{ id: 1 }, { id: 2 }, { id: 3 }], [lead], [trail]);
    await tick();
    expect(rowIds()).toEqual(['1', '2', '3']);
    const rows = Array.from(container.querySelectorAll('div[data-id]'));

    itemsCell.update([]);
    await tick();

    expect(clearChildrenCalls).toEqual([container]);
    expect(Array.from(container.childNodes)).toEqual([
      lead,
      list.topMarker,
      list.bottomMarker,
      trail,
    ]);
    expect(lead.textContent).toBe('\n  ');
    expect(trail.textContent).toBe('\n');
    for (const row of rows) expect(row.isConnected).toBe(false);
    expect(list.keyMap.size).toBe(0);
    expect(list.itemMarkers.size).toBe(0);

    // The list renders again between its markers, inside the kept text.
    itemsCell.update([{ id: 4 }, { id: 5 }]);
    await tick();
    expect(rowIds()).toEqual(['4', '5']);
    expect(container.firstChild).toBe(lead);
    expect(container.lastChild).toBe(trail);
    expect(lead.nextSibling).toBe(list.topMarker);
    expect(trail.previousSibling).toBe(list.bottomMarker);
  });

  test('several text nodes on one side only are kept in order', async () => {
    const a = document.createTextNode('a');
    const b = document.createTextNode('b');
    const { list, itemsCell } = renderList([{ id: 1 }, { id: 2 }], [], [a, b]);
    await tick();

    itemsCell.update([]);
    await tick();

    expect(clearChildrenCalls).toEqual([container]);
    expect(Array.from(container.childNodes)).toEqual([list.topMarker, list.bottomMarker, a, b]);
  });

  test('an element sibling keeps the per-row path', async () => {
    const span = document.createElement('span');
    const trail = document.createTextNode('\n');
    const { list, itemsCell } = renderList([{ id: 1 }, { id: 2 }], [span], [trail]);
    await tick();

    itemsCell.update([]);
    await tick();

    expect(clearChildrenCalls).toEqual([]);
    expect(rowIds()).toEqual([]);
    expect(container.firstChild).toBe(span);
    expect(span.nextSibling).toBe(list.topMarker);
    expect(container.lastChild).toBe(trail);
    expect(trail.previousSibling).toBe(list.bottomMarker);
    // per row: its node and its item marker
    expect(destroyedNodes.filter((node) => node.nodeType === 1)).toHaveLength(2);
    expect(list.keyMap.size).toBe(0);
  });

  test("a comment sibling (another block's anchor) keeps the per-row path", async () => {
    const lead = document.createTextNode('\n');
    const anchor = document.createComment('');
    const { list, itemsCell } = renderList([{ id: 1 }], [lead], [anchor]);
    await tick();

    itemsCell.update([]);
    await tick();

    expect(clearChildrenCalls).toEqual([]);
    expect(rowIds()).toEqual([]);
    expect(container.firstChild).toBe(lead);
    expect(lead.nextSibling).toBe(list.topMarker);
    expect(container.lastChild).toBe(anchor);
    expect(anchor.previousSibling).toBe(list.bottomMarker);
  });

  test('markers that own the parent: the historic bulk clear', async () => {
    const { list, itemsCell } = renderList([{ id: 1 }, { id: 2 }], [], []);
    await tick();

    itemsCell.update([]);
    await tick();

    expect(clearChildrenCalls).toEqual([container]);
    expect(Array.from(container.childNodes)).toEqual([list.topMarker, list.bottomMarker]);
  });
});
