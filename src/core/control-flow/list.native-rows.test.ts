/**
 * EMBER_NATIVE `{{#each}}` rows of static text around ONE stable node.
 *
 * The Ember native build keeps Glimmer's template whitespace, so a row body is
 * typically `\n    <li>…</li>\n`. The compiler emits such a body unwrapped —
 * a plain `[text, node, text]` array — instead of a per-row
 * UnstableChildWrapper component, and the list's native row path
 * (`buildNativeRow`) gives the row's ctx the wrapper's job: the static strings
 * become Text nodes the row owns, and the nested blocks the body creates hang
 * off the row's ctx, so they are torn down with the row (per row and by the
 * bulk clear).
 *
 * Templates are compiled with the native flags and bound to the main entry
 * (the way the Ember native runtime compiler evaluates them). The runtime side
 * is gated on the EMBER_NATIVE / WITH_EMBER_INTEGRATION build constants, which
 * vitest exposes as globals: each test turns them on (the Ember native build
 * defines both).
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as main from '../index';
import { Component } from '../component';
import {
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  addToTree,
  $template,
  TREE,
  PARENT,
  isArray,
} from '../shared';
import { $SELF } from '../self';
import { cId } from '../tree';
import { $_c, $_args, $_edp, bindNativeContent } from '../dom';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import { renderElement } from '../render-core';
import { tagFor, dirtyCell } from '../tags';
import { syncDom } from '../runtime';
import { setNativeContentBinding } from '../native-content';
import { isDestructionStarted } from '../glimmer/destroyable';
import { compileTemplateSource } from '../../../plugins/runtime-compiler';
import { IfCondition } from './if';
import { SyncListComponent } from './list';

const NATIVE_FLAGS = {
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
  FORCE_SYNC_LIST: true,
  EMBER_IN_ELEMENT: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
};

type RuntimeConstants = { EMBER_NATIVE: boolean; WITH_EMBER_INTEGRATION: boolean };
const runtime = globalThis as unknown as RuntimeConstants;

function compileNative(tpl: string, scope: Record<string, unknown> = {}) {
  const bindings = new Set(Object.keys(scope));
  const { source, scopeNames, errors } = compileTemplateSource(tpl, {
    flags: NATIVE_FLAGS,
    bindings,
  });
  expect(errors).toHaveLength(0);
  const exported = main as unknown as Record<string, unknown>;
  const names = [...scopeNames, ...bindings];
  // eslint-disable-next-line no-new-func
  return new Function(...names, `"use strict"; return ${source};`)(
    ...scopeNames.map((name) => exported[name]),
    ...[...bindings].map((name) => scope[name]),
  ) as (...args: unknown[]) => unknown;
}

/** A definition rendering `tpl` on a fresh node whose self is `self` (the Ember host's shape). */
function withSelf(tpl: unknown, self: object) {
  return function SelfComponent() {
    return { [COMPONENT_ID_PROPERTY]: cId(), [$SELF]: self, [$template]: tpl };
  };
}

/**
 * The first DOM node a block renders (its rendered nodes, descending into nested
 * render nodes). Native `{{#if}}` blocks have no anchor while their branch has
 * content (Glimmer's block bounds), so a block is located by what it rendered.
 */
function firstDomNode(item: unknown): Node | null {
  if (item === null || typeof item !== 'object') return null;
  if (typeof (item as Node).nodeType === 'number') return item as Node;
  const list = isArray(item) ? item : (item as any)[RENDERED_NODES_PROPERTY];
  if (!isArray(list)) return null;
  for (const entry of list) {
    const found = firstDomNode(entry);
    if (found !== null) return found;
  }
  return null;
}

const wrapperCount = () =>
  [...TREE.values()].filter(
    (node) => (node as object).constructor?.name === 'UnstableChildWrapper',
  ).length;

/** The DOM without the list / block anchor comments (and gxt's node ids). */
const markup = (el: Element) =>
  el.innerHTML.replace(/ data-node-id="\d+"/g, '').replace(/<!--[^>]*-->/g, '');

describe('compiler: EMBER_NATIVE each-row stability', () => {
  const compile = (tpl: string, flags: Record<string, boolean>) =>
    compileTemplateSource(tpl, { flags }).source;
  const row = (body: string, key = 'id') =>
    `{{#each this.items key="${key}" as |item|}}\n  ${body}\n{{/each}}`;

  test('static text around one stable element / component: no per-row wrapper', () => {
    expect(compile(row('<li><b>{{item.label}}</b></li>'), NATIVE_FLAGS)).not.toContain('$_ucw');
    expect(compile(row('<Row @item={{item}} />'), NATIVE_FLAGS)).not.toContain('$_ucw');
  });

  test('still wrapped: two nodes, text only, an unstable node, recycled rows', () => {
    expect(compile(row('<li>a</li><li>b</li>'), NATIVE_FLAGS)).toContain('$_ucw');
    expect(compile(row('label: {{item.label}}'), NATIVE_FLAGS)).toContain('$_ucw');
    // an element whose only child is a mustache is not "stable"
    expect(compile(row('<li>{{item.label}}</li>'), NATIVE_FLAGS)).toContain('$_ucw');
    expect(compile(row('<li><b>{{item.label}}</b></li>', '@recycle'), NATIVE_FLAGS)).toContain(
      '$_ucw',
    );
  });
});

describe('EMBER_NATIVE unwrapped each rows', () => {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;

  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = true;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
    setNativeContentBinding(bindNativeContent);
  });

  afterEach(() => {
    setNativeContentBinding(null);
    fixture.cleanup();
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
  });

  function render(tpl: unknown) {
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_c(tpl as any, $_args({}, false, $_edp as any), parent);
    renderElement(fixture.api, parent, fixture.container, instance);
  }

  async function set(obj: object, key: string, value: unknown) {
    (obj as Record<string, unknown>)[key] = value;
    dirtyCell(tagFor(obj, key));
    await syncDom();
  }

  const lists = () => [...TREE.values()].filter((node) => node instanceof SyncListComponent);

  describe('element rows', () => {
    const TPL =
      '<ul>\n  {{#each this.items key="id" as |item|}}\n    <li><b>{{item.label}}</b></li>\n  {{/each}}\n</ul>';
    const expected = (...labels: string[]) =>
      '\n' + labels.map((label) => `    <li><b>${label}</b></li>\n`).join('');

    test('create, keyed reorder, remove, clear, re-create', async () => {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((label, id) => ({ id, label }));
      const self = { items: [a, b, c] as unknown[] };
      render(withSelf(compileNative(TPL), self));
      const ul = fixture.container.querySelector('ul')!;
      const lis = () => Array.from(ul.querySelectorAll('li'));

      expect(wrapperCount()).toBe(0);
      expect(markup(ul)).toBe(expected('a', 'b', 'c'));
      const [la, lb, lc] = lis();
      // each row owns the text around its node
      expect(la.previousSibling!.nodeType).toBe(3);
      expect(la.nextSibling!.textContent).toBe('\n');
      const [list] = lists() as SyncListComponent<any>[];
      expect(list.keyMap.get(a.id as never)).toEqual([la.previousSibling, la, la.nextSibling]);

      // keyed reorder: the same nodes, moved together with their text
      await set(self, 'items', [c, a, b]);
      expect(lis()).toEqual([lc, la, lb]);
      expect(markup(ul)).toBe(expected('c', 'a', 'b'));

      // remove (per-row path): the row's node AND its text nodes go
      const removedText = [lb.previousSibling!, lb.nextSibling!];
      await set(self, 'items', [c, a]);
      expect(lis()).toEqual([lc, la]);
      expect(markup(ul)).toBe(expected('c', 'a'));
      for (const node of [lb, ...removedText]) expect(node.isConnected).toBe(false);

      // clear: only the static text around the list is left
      await set(self, 'items', []);
      expect(markup(ul)).toBe(expected());
      expect(list.keyMap.size).toBe(0);
      expect(list.rowCtxMap?.size ?? 0).toBe(0);

      await set(self, 'items', [d, a]);
      expect(markup(ul)).toBe(expected('d', 'a'));
      expect(wrapperCount()).toBe(0);
    });

    test('a swap keeps every row node', async () => {
      const rows = [1, 2, 3, 4].map((id) => ({ id, label: `r${id}` }));
      const self = { items: rows as unknown[] };
      render(withSelf(compileNative(TPL), self));
      const ul = fixture.container.querySelector('ul')!;
      const before = Array.from(ul.childNodes).filter((node) => node.nodeType !== 8);
      await set(self, 'items', [rows[0], rows[3], rows[2], rows[1]]);
      expect(markup(ul)).toBe(expected('r1', 'r4', 'r3', 'r2'));
      const after = Array.from(ul.childNodes).filter((node) => node.nodeType !== 8);
      expect(new Set(after)).toEqual(new Set(before));
    });
  });

  describe('component rows with whitespace', () => {
    test('create, reorder, remove, clear; a removed row component is destroyed', async () => {
      const Row = compileNative('<p>{{@item.label}}</p>');
      const [a, b, c] = ['a', 'b', 'c'].map((label, id) => ({ id, label }));
      const self = { items: [a, b, c] as unknown[] };
      render(
        withSelf(
          compileNative(
            '<div>\n  {{#each this.items key="id" as |item|}}\n    <Row @item={{item}} />\n  {{/each}}\n</div>',
            { Row },
          ),
          self,
        ),
      );
      const div = fixture.container.querySelector('div')!;
      const ps = () => Array.from(div.querySelectorAll('p'));
      const expected = (...labels: string[]) =>
        '\n' + labels.map((label) => `    <p>${label}</p>\n`).join('');
      // the Row component instance that rendered `p`
      const ownerOf = (p: Element) =>
        [...TREE.values()].find(
          (node) =>
            !(node instanceof SyncListComponent) &&
            ((node as any)[RENDERED_NODES_PROPERTY] as unknown[] | undefined)?.includes(p),
        )!;

      expect(wrapperCount()).toBe(0);
      expect(markup(div)).toBe(expected('a', 'b', 'c'));
      const [pa, pb, pc] = ps();
      const rowB = ownerOf(pb);
      expect(rowB).toBeDefined();

      await set(self, 'items', [c, b, a]);
      expect(ps()).toEqual([pc, pb, pa]);
      expect(markup(div)).toBe(expected('c', 'b', 'a'));

      // destroyed once: with the row's ctx (dev builds report a second destroy)
      const info = vi.spyOn(console, 'info');
      try {
        await set(self, 'items', [c, a]);
        expect(info.mock.calls.flat()).not.toContain('node-is-already-destroyed-here');
      } finally {
        info.mockRestore();
      }
      expect(markup(div)).toBe(expected('c', 'a'));
      expect(isDestructionStarted(rowB as object)).toBe(true);

      const rowC = ownerOf(pc);
      await set(self, 'items', []);
      expect(markup(div)).toBe(expected());
      expect(isDestructionStarted(rowC as object)).toBe(true);
    });
  });

  describe('nested blocks inside a row', () => {
    const TPL =
      '<table><tbody>\n  {{#each this.rows key="id" as |row|}}\n' +
      '    <tr><td>{{row.id}}</td>{{#if row.on}}<td>on</td>{{/if}}' +
      '{{#each row.tags as |tag|}}<td>{{tag}}</td>{{/each}}</tr>\n  {{/each}}\n</tbody></table>';

    class Row {
      reads = 0;
      constructor(
        public id: number,
        public _on: boolean,
        public tags: string[],
      ) {}
      get on() {
        this.reads++;
        return this._on;
      }
    }

    function setup() {
      const rows = [new Row(1, true, ['x']), new Row(2, false, []), new Row(3, true, ['y', 'z'])];
      const self = { rows: rows as unknown[] };
      render(withSelf(compileNative(TPL), self));
      const tbody = fixture.container.querySelector('tbody')!;
      const trs = Array.from(tbody.querySelectorAll('tr'));
      const outer = lists().find((list) => !trs.some((tr) => tr.contains(list.topMarker)))!;
      // the nested {{#if}} / {{#each}} of each row, by its anchor inside the row's <tr>
      const nested = trs.map((tr) => ({
        ifc: ([...TREE.values()] as unknown[]).find(
          (node): node is IfCondition =>
            node instanceof IfCondition && tr.contains(firstDomNode(node)),
        )!,
        inner: lists().find((list) => tr.contains(list.topMarker))!,
      }));
      return { rows, self, tbody, outer, nested };
    }

    const cells = (tbody: Element) =>
      Array.from(tbody.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td')).map((td) => td.textContent),
      );

    test('they belong to the row, not to the list, and stay reactive', async () => {
      const { rows, self, tbody, outer, nested } = setup();
      // the rows themselves are unwrapped (the if branch / inner rows are not
      // static-text bodies, so they keep their wrappers)
      for (const row of outer.keyMap.values()) expect(isArray(row)).toBe(true);
      expect(cells(tbody)).toEqual([['1', 'on', 'x'], ['2'], ['3', 'on', 'y', 'z']]);
      for (const { ifc, inner } of nested) {
        expect(ifc).toBeDefined();
        expect(inner).toBeDefined();
        // their tree parent is the row's ctx, a child of the list
        const ifParent = PARENT.get(ifc[COMPONENT_ID_PROPERTY as never] as number);
        expect(ifParent).not.toBe(outer[COMPONENT_ID_PROPERTY]);
        expect(PARENT.get(ifParent!)).toBe(outer[COMPONENT_ID_PROPERTY]);
        expect(PARENT.get(inner[COMPONENT_ID_PROPERTY])).toBe(ifParent);
      }
      await set(rows[1], '_on', true);
      dirtyCell(tagFor(rows[1], 'on'));
      await syncDom();
      await set(rows[1], 'tags', ['w']);
      await set(self, 'rows', [rows[1], rows[0], rows[2]]);
      expect(cells(tbody)).toEqual([['2', 'on', 'w'], ['1', 'on', 'x'], ['3', 'on', 'y', 'z']]);
    });

    test('removing a row destroys its nested blocks (per-row path)', async () => {
      const { rows, self, nested } = setup();
      await set(self, 'rows', [rows[0], rows[2]]);
      expect(isDestructionStarted(nested[1].ifc)).toBe(true);
      expect(isDestructionStarted(nested[1].inner)).toBe(true);
      expect(isDestructionStarted(nested[0].ifc)).toBe(false);
      expect(isDestructionStarted(nested[2].inner)).toBe(false);
    });

    test('a row written without whitespace (a single node) owns its nested blocks too', async () => {
      const rows = [new Row(1, true, []), new Row(2, true, [])];
      const self = { rows: rows as unknown[] };
      render(
        withSelf(
          compileNative(
            '<table><tbody>{{#each this.rows key="id" as |row|}}<tr><td>{{row.id}}</td>{{#if row.on}}<td>on</td>{{/if}}</tr>{{/each}}</tbody></table>',
          ),
          self,
        ),
      );
      const tr = fixture.container.querySelectorAll('tr')[1];
      const ifc = ([...TREE.values()] as unknown[]).find(
        (node): node is IfCondition => node instanceof IfCondition && tr.contains(firstDomNode(node)),
      )!;
      await set(self, 'rows', [rows[0]]);
      expect(isDestructionStarted(ifc)).toBe(true);
    });

    test('clearing the list destroys every nested block (bulk path)', async () => {
      const { rows, self, tbody, nested } = setup();
      await set(self, 'rows', []);
      expect(markup(tbody)).toBe('\n');
      for (const { ifc, inner } of nested) {
        expect(isDestructionStarted(ifc)).toBe(true);
        expect(isDestructionStarted(inner)).toBe(true);
      }
      // nothing re-evaluates a removed row's condition any more (a first flush
      // may still drop the destroyed formula's subscription)
      rows[0]._on = false;
      dirtyCell(tagFor(rows[0], 'on'));
      await syncDom();
      const settled = rows[0].reads;
      rows[0]._on = true;
      dirtyCell(tagFor(rows[0], 'on'));
      await syncDom();
      expect(rows[0].reads).toBe(settled);
    });
  });
});
