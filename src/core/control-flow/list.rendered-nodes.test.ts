/**
 * @vitest-environment happy-dom
 *
 * A list's own RENDERED_NODES must not keep removed rows.
 *
 * `renderElement` lists every plain DOM node it inserts for a list — a
 * single-element row body (`$_blk` rows, `$_tag` rows) and node inverse
 * content — in the list's RENDERED_NODES. Before the fix no removal path
 * took them out again, so every row a long-lived list ever rendered (its
 * subtree, listeners, bound item) stayed reachable: the bench/budgets inline
 * kind kept ~519 KB of heap per create-1k/clear cycle.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi } from '../dom-api';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, PARENT, TREE, CHILD, $template } from '../shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { Root } from '../dom';
import { SyncListComponent, AsyncListComponent, type BasicListComponent } from './list';
import { cell, cellFor, type Cell } from '../reactive';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from '../__test-utils__/list-harness';
import { template } from '../../../plugins/runtime-compiler';

type Item = { id: number };

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe.each([
  ['SyncListComponent', SyncListComponent],
  ['AsyncListComponent', AsyncListComponent],
] as const)('%s: removed node rows leave RENDERED_NODES', (_name, ListClass) => {
  let window: Window;
  let document: Document;
  let container: HTMLElement;

  beforeEach(() => {
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

  function renderList(items: Item[], withInverse = false) {
    const api = new HTMLBrowserDOMApi(document);
    const root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parent);
    const itemsCell = cell(items);
    const list = new ListClass<Item>(
      {
        tag: itemsCell,
        key: 'id',
        ctx: parent,
        ItemComponent: (item: Item) => {
          const div = document.createElement('div');
          div.setAttribute('data-id', String(item.id));
          return div;
        },
        inverseFn: withInverse
          ? () => {
              const p = document.createElement('p');
              p.textContent = 'empty';
              return p;
            }
          : undefined,
      },
      container,
      document.createComment('list top'),
    );
    return { list: list as BasicListComponent<Item>, itemsCell };
  }

  const listedRows = (list: BasicListComponent<Item>) =>
    list[RENDERED_NODES_PROPERTY].filter(
      (n) => (n as Element).tagName === 'DIV',
    ) as Element[];
  const ids = (from: number, to: number) => {
    const out: Item[] = [];
    for (let i = from; i <= to; i++) out.push({ id: i });
    return out;
  };

  test('clear, disjoint replace and single removals', async () => {
    const { list, itemsCell } = renderList(ids(1, 3));
    await tick();
    expect(listedRows(list)).toHaveLength(3);

    itemsCell.update([]);
    await tick();
    expect(listedRows(list)).toHaveLength(0);

    itemsCell.update(ids(4, 6));
    await tick();
    // disjoint non-empty replace: the per-row destroyItem path
    itemsCell.update(ids(7, 9));
    await tick();
    expect(listedRows(list).map((n) => n.getAttribute('data-id'))).toEqual(['7', '8', '9']);

    itemsCell.update([{ id: 7 }, { id: 9 }]);
    await tick();
    expect(listedRows(list).map((n) => n.getAttribute('data-id'))).toEqual(['7', '9']);
    for (const row of listedRows(list)) expect(row.isConnected).toBe(true);
    expect(container.querySelectorAll('div[data-id]')).toHaveLength(2);
  });

  test('create/clear cycles keep RENDERED_NODES bounded by the live rows', async () => {
    const { list, itemsCell } = renderList([]);
    await tick();
    const base = list[RENDERED_NODES_PROPERTY].length;
    for (let cycle = 0; cycle < 10; cycle++) {
      itemsCell.update(ids(cycle * 100 + 1, cycle * 100 + 50));
      await tick();
      expect(listedRows(list)).toHaveLength(50);
      itemsCell.update([]);
      await tick();
    }
    expect(list[RENDERED_NODES_PROPERTY].length).toBe(base);
  });

  test('node inverse content is released when rows arrive', async () => {
    const { list, itemsCell } = renderList([], true);
    await tick();
    for (let cycle = 0; cycle < 5; cycle++) {
      itemsCell.update([{ id: cycle + 1 }]);
      await tick();
      itemsCell.update([]);
      await tick();
    }
    const listedInverse = list[RENDERED_NODES_PROPERTY].filter(
      (n) => (n as Element).tagName === 'P',
    );
    expect(listedInverse).toHaveLength(1);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});

describe('compiled $_blk rows with {{on}}: no retained rows across cycles', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('the list lists only live rows; TREE returns to its size', async () => {
    class Root extends Component {
      _items: HarnessItem[] = [];
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
      }
      get items() {
        return this._items;
      }
      pick = () => {};
      // `{{index}}` keeps the static block on v1 (frame mode does not use
      // RENDERED_NODES at all)
      [$template] = template(`
        <table><tbody>
          {{#each this.items key="id" as |item index|}}
            <tr><td><a {{on "click" this.pick}}>{{item.label}}</a></td><td>{{index}}</td></tr>
          {{/each}}
        </tbody></table>
      `);
    }
    const root = mountRoot(fixture, Root as any) as unknown as Root;
    await settle();
    const list = [...TREE.values()].find(
      (c) => c instanceof AsyncListComponent || c instanceof SyncListComponent,
    ) as BasicListComponent<HarnessItem>;
    expect(list).toBeDefined();
    // the compiled body is a static block with an event slot, on v1
    expect(list.block).not.toBeNull();
    expect(list.frameMode).toBe(false);
    const listedBase = list[RENDERED_NODES_PROPERTY].length;
    const treeBase = TREE.size;

    for (let cycle = 0; cycle < 5; cycle++) {
      root._items = buildItems(40);
      await settle();
      expect(fixture.container.querySelectorAll('tbody tr')).toHaveLength(40);
      root._items = [];
      await settle();
    }
    expect(list[RENDERED_NODES_PROPERTY].length).toBe(listedBase);
    expect(TREE.size).toBe(treeBase);

    // per-row removals
    const items = buildItems(10);
    root._items = items;
    await settle();
    root._items = items.filter((_, i) => i % 2 === 0);
    await settle();
    expect(fixture.container.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(list[RENDERED_NODES_PROPERTY].length).toBe(listedBase + 5);
    (cellFor(root as any, '_items') as Cell<HarnessItem[]>).update([]);
    await settle();
  });
});
