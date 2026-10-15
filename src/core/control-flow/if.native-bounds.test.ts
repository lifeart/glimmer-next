/**
 * EMBER_NATIVE `{{#if}}` DOM: Glimmer's block bounds.
 *
 * Glimmer renders an `{{#if}}` as one resettable block (`ReplayableIf` →
 * `TryOpcode`): an EMPTY block appends `<!---->` (`AppendingBlock#finalize`), a
 * block with content owns exactly its nodes — no anchor comment — and its
 * first / last node delegate to the nested block at its edge. On a branch swap
 * the block is cleared and the new branch renders at its next sibling.
 *
 * Under the EMBER_NATIVE runtime the `IfCondition` placeholder is in the DOM
 * only while the branch is empty (`settleNativeBounds`); a swap parks it after
 * the outgoing branch, renders the new branch before it, and removes it again
 * when the new branch has content (`parkPlaceholder`). The block's rendered
 * nodes are the live branch, so a parent, a list row and the Inspector read its
 * edges through nested blocks.
 *
 * Templates are compiled with the native flags and bound to the main entry (as
 * the Ember native runtime compiler evaluates them); each test turns on the
 * EMBER_NATIVE / WITH_EMBER_INTEGRATION runtime constants, which vitest exposes
 * as globals (the Ember native build defines both).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as main from '../index';
import { Component } from '../component';
import {
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
  addToTree,
  $template,
  TREE,
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
import { destroyElementSync } from '../destroy';
import { captureRenderTree } from '../inspector/capture-render-tree';
import { cell } from '../reactive';
import { $_if } from '../dom';
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

type RuntimeConstants = {
  EMBER_NATIVE: boolean;
  WITH_EMBER_INTEGRATION: boolean;
};
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
 * The DOM as Glimmer would print it: comments as `<!---->`, gxt's node ids
 * dropped. Each list keeps its own markers (one comment per row plus its two
 * boundary comments) — `withoutListMarkers` drops exactly those.
 */
const html = (el: Element) =>
  el.innerHTML
    .replace(/ data-node-id="\d+"/g, '')
    .replace(/<!--[^>]*-->/g, '<!---->');

const ifs = () =>
  ([...TREE.values()] as unknown[]).filter(
    (node): node is IfCondition => node instanceof IfCondition,
  );
const lists = () =>
  ([...TREE.values()] as unknown[]).filter(
    (node): node is SyncListComponent<any> => node instanceof SyncListComponent,
  );

/**
 * The DOM with its anchors classified: an `{{#if}}` placeholder prints as
 * `<!---->`, an `{{#each}}` row marker as `|`; a list's own boundary comments
 * and whitespace-only text are dropped. Rows can then be compared as
 * `|<row content>` — a block's `<!---->` / content must sit inside its own row.
 */
function digest(el: Node): string {
  const placeholders = new Set(ifs().map((node) => node.placeholder as Node));
  const rowMarkers = new Set<Node>();
  for (const list of lists())
    for (const marker of list.markerSet) rowMarkers.add(marker);
  const walk = (node: Node): string => {
    if (node.nodeType === 3)
      return node.nodeValue!.trim() === '' ? '' : node.nodeValue!;
    if (node.nodeType === 8)
      return placeholders.has(node)
        ? '<!---->'
        : rowMarkers.has(node)
          ? '|'
          : '';
    const tag = (node as Element).tagName.toLowerCase();
    return `<${tag}>${Array.from(node.childNodes, walk).join('')}</${tag}>`;
  };
  return Array.from(el.childNodes, walk).join('');
}

/** The first / last DOM node a render node's rendered nodes reach (the Inspector's bounds walk). */
function edge(item: unknown, fromStart: boolean): Node | null {
  if (item === null || typeof item !== 'object') return null;
  if (typeof (item as Node).nodeType === 'number') return item as Node;
  const list = Array.isArray(item)
    ? item
    : (item as any)[RENDERED_NODES_PROPERTY];
  if (!Array.isArray(list)) return null;
  for (let i = 0; i < list.length; i++) {
    const found = edge(list[fromStart ? i : list.length - 1 - i], fromStart);
    if (found !== null) return found;
  }
  return null;
}

describe('EMBER_NATIVE {{#if}} block bounds', () => {
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
    return { parent, instance };
  }

  async function set(obj: object, key: string, value: unknown) {
    (obj as Record<string, unknown>)[key] = value;
    dirtyCell(tagFor(obj, key));
    await syncDom();
  }

  /** Every `{{#if}}` / `{{#each}}` alive in the render tree right now. */
  const liveIfs = () => ifs().filter((node) => !isDestructionStarted(node));

  test('a branch with content owns exactly its nodes; an empty branch is <!---->', async () => {
    const self = { a: true };
    render(
      withSelf(compileNative('<p>x{{#if this.a}}<b>A</b>{{/if}}y</p>'), self),
    );
    const p = fixture.container.querySelector('p')!;
    const [ifc] = ifs();
    expect(html(p)).toBe('x<b>A</b>y');
    expect(edge(ifc, true)).toBe(p.querySelector('b'));
    expect(edge(ifc, false)).toBe(p.querySelector('b'));
    await set(self, 'a', false);
    expect(html(p)).toBe('x<!---->y');
    expect(edge(ifc, true)).toBe(ifc.placeholder);
    expect(edge(ifc, false)).toBe(ifc.placeholder);
    await set(self, 'a', true);
    expect(html(p)).toBe('x<b>A</b>y');
    expect(ifc.placeholder.isConnected).toBe(false);
    expect(edge(ifc, true)).toBe(p.querySelector('b'));
  });

  test('{{else}}: the next branch renders in place of the previous one, never with an anchor', async () => {
    const self = { a: true };
    render(
      withSelf(
        compileNative(
          '<p>x{{#if this.a}}<b>T</b>t{{else}}f<i>F</i>{{/if}}y</p>',
        ),
        self,
      ),
    );
    const p = fixture.container.querySelector('p')!;
    expect(html(p)).toBe('x<b>T</b>ty');
    await set(self, 'a', false);
    expect(html(p)).toBe('xf<i>F</i>y');
    await set(self, 'a', true);
    expect(html(p)).toBe('x<b>T</b>ty');
  });

  test('a constant condition: an empty branch is <!---->, a branch with content has none', () => {
    render(
      compileNative(
        '<p>{{#if true}}<b>T</b>{{/if}}|{{#if false}}<b>F</b>{{/if}}</p>',
      ),
    );
    expect(html(fixture.container.querySelector('p')!)).toBe(
      '<b>T</b>|<!---->',
    );
  });

  describe('a branch whose content is itself empty', () => {
    test("a nested {{#if}} with an empty branch: one <!---->, the nested block's", async () => {
      const self = { a: true, b: false };
      render(
        withSelf(
          compileNative(
            '<p>x{{#if this.a}}{{#if this.b}}<b>B</b>{{/if}}{{/if}}y</p>',
          ),
          self,
        ),
      );
      const p = fixture.container.querySelector('p')!;
      const [outer, inner] = ifs();
      expect(html(p)).toBe('x<!---->y');
      expect(p.childNodes[1]).toBe(inner.placeholder);
      expect(outer.placeholder.isConnected).toBe(false);
      await set(self, 'b', true);
      expect(html(p)).toBe('x<b>B</b>y');
      expect(edge(outer, true)).toBe(p.querySelector('b'));
      await set(self, 'a', false);
      expect(html(p)).toBe('x<!---->y');
      expect(p.childNodes[1]).toBe(outer.placeholder);
      expect(isDestructionStarted(inner)).toBe(true);
      await set(self, 'b', false);
      await set(self, 'a', true);
      expect(html(p)).toBe('x<!---->y');
      await set(self, 'b', true);
      expect(html(p)).toBe('x<b>B</b>y');
      expect(liveIfs()).toHaveLength(2);
    });

    test("a branch that renders no DOM keeps the block's own <!---->", async () => {
      const Empty = compileNative('{{#if false}}never{{/if}}');
      const Nothing = compileNative('');
      const self = { a: true };
      render(
        withSelf(
          compileNative('<p>x{{#if this.a}}<Nothing />{{/if}}y</p>', {
            Nothing,
          }),
          self,
        ),
      );
      const p = fixture.container.querySelector('p')!;
      const [ifc] = ifs();
      expect(html(p)).toBe('x<!---->y');
      expect(p.childNodes[1]).toBe(ifc.placeholder);
      await set(self, 'a', false);
      expect(html(p)).toBe('x<!---->y');
      await set(self, 'a', true);
      expect(html(p)).toBe('x<!---->y');
      expect(p.childNodes).toHaveLength(3);
      // a component whose only content is an empty block: that block's <!---->
      fixture.container.innerHTML = '';
      render(
        withSelf(
          compileNative('<p>{{#if this.a}}<Empty />{{/if}}</p>', { Empty }),
          self,
        ),
      );
      expect(html(fixture.container.querySelector('p')!)).toBe('<!---->');
    });
  });

  test('a branch that starts / ends with a nested {{#if}} / {{#each}}: its edges are read live', async () => {
    const self = { a: true, b: true, items: [1, 2] as unknown[] };
    const Wrapper = compileNative(
      '{{#if this.a}}{{#if this.b}}<b>B</b>{{/if}}<i>mid</i>{{#each this.items as |i|}}<u>{{i}}</u>{{/each}}{{/if}}',
    );
    const { instance } = render(withSelf(Wrapper, self));
    const root = fixture.container;
    const [outer, inner] = ifs();
    const [list] = lists();
    const tags = () => digest(root);
    expect(tags()).toBe('<b>B</b><i>mid</i>|<u>1</u>|<u>2</u>');
    // the outer block (and the component around it) starts at the nested block's node
    expect(edge(outer, true)).toBe(root.querySelector('b'));
    expect(edge(instance, true)).toBe(root.querySelector('b'));
    expect(edge(outer, false)).toBe(list.bottomMarker);
    await set(self, 'b', false);
    expect(tags()).toBe('<!----><i>mid</i>|<u>1</u>|<u>2</u>');
    expect(edge(outer, true)).toBe(inner.placeholder);
    expect(edge(instance, true)).toBe(inner.placeholder);
    await set(self, 'b', true);
    expect(edge(outer, true)).toBe(root.querySelector('b'));
    await set(self, 'items', []);
    expect(tags()).toBe('<b>B</b><i>mid</i>');
    // the outer swap clears exactly its range — the nested blocks with it
    await set(self, 'a', false);
    expect(html(root)).toBe('<!---->');
    expect(root.firstChild).toBe(outer.placeholder);
    expect(isDestructionStarted(inner)).toBe(true);
    expect(isDestructionStarted(list)).toBe(true);
    await set(self, 'items', [3]);
    await set(self, 'b', false);
    await set(self, 'a', true);
    expect(tags()).toBe('<!----><i>mid</i>|<u>3</u>');
    const [, newInner] = liveIfs();
    expect(edge(outer, true)).toBe(newInner.placeholder);
    expect(edge(instance, false)).toBe(
      lists().find((l) => !isDestructionStarted(l))!.bottomMarker,
    );
    // after the outer block re-rendered, it still follows the nested block at its edge
    await set(self, 'b', true);
    expect(tags()).toBe('<b>B</b><i>mid</i>|<u>3</u>');
    expect(edge(outer, true)).toBe(root.querySelector('b'));
    expect(edge(instance, true)).toBe(root.querySelector('b'));
  });

  describe('{{#if}} as the first / last node of an {{#each}} row', () => {
    type Item = { id: number; a: boolean; b: boolean };
    const item = (id: number, a: boolean, b: boolean): Item => ({ id, a, b });
    const rows = (items: Item[]) => items.map((i) => '|' + rowHtml(i)).join('');
    const rowHtml = (i: Item) =>
      (i.a ? `<li>a${i.id}</li>` : '<!---->') +
      `<li>${i.id}</li>` +
      (i.b ? `<li>b${i.id}</li>` : '<!---->');

    /** Count bulk clears (the list's fast path) on the fixture's DOM api. */
    function countBulkClears() {
      let count = 0;
      const original = fixture.api.clearChildren.bind(fixture.api);
      fixture.api.clearChildren = (element: Node) => {
        count++;
        original(element);
      };
      return () => count;
    }

    async function exercise(tpl: string, scope: Record<string, unknown> = {}) {
      const [one, two, three, four, five] = [
        item(1, true, true),
        item(2, true, false),
        item(3, false, true),
        item(4, false, false),
        item(5, true, true),
      ];
      const self = { items: [one, two, three, four] as Item[] };
      render(withSelf(compileNative(tpl, scope), self));
      const ul = fixture.container.querySelector('ul')!;
      const check = () => expect(digest(ul)).toBe(rows(self.items));
      check();
      // toggle the edge blocks of some rows
      await set(one, 'a', false);
      await set(four, 'b', true);
      await set(three, 'a', true);
      check();
      // move (reverse) and swap, then toggle again: each block stays in its row
      await set(self, 'items', [four, three, two, one]);
      check();
      await set(self, 'items', [one, three, two, four]);
      check();
      await set(one, 'b', false);
      await set(four, 'a', true);
      await set(two, 'b', true);
      check();
      // remove (per-row path): exactly the removed rows' blocks are destroyed
      const before = liveIfs();
      await set(self, 'items', [one, four]);
      check();
      expect(before.filter((node) => isDestructionStarted(node))).toHaveLength(
        4,
      );
      expect(liveIfs()).toHaveLength(4);
      for (const node of liveIfs())
        expect(edge(node, true)!.isConnected).toBe(true);
      // insert between, then toggle the neighbours
      await set(self, 'items', [one, five, four]);
      await set(four, 'a', false);
      await set(one, 'b', true);
      check();
      // clear (bulk path) destroys every block
      const bulk = countBulkClears();
      const rowIfs = liveIfs();
      await set(self, 'items', []);
      check();
      expect(bulk()).toBe(1);
      for (const node of rowIfs) expect(isDestructionStarted(node)).toBe(true);
      // re-create
      await set(self, 'items', [two, three]);
      check();
      await set(two, 'a', false);
      check();
      return ul;
    }

    test('rows without whitespace', async () => {
      await exercise(
        '<ul>{{#each this.items key="id" as |item|}}{{#if item.a}}<li>a{{item.id}}</li>{{/if}}<li>{{item.id}}</li>{{#if item.b}}<li>b{{item.id}}</li>{{/if}}{{/each}}</ul>',
      );
    });

    test('rows with Glimmer whitespace (static text around the list: the bulk clear keeps it)', async () => {
      await exercise(
        '<ul>\n  {{#each this.items key="id" as |item|}}\n    {{#if item.a}}<li>a{{item.id}}</li>{{/if}}\n    <li>{{item.id}}</li>\n    {{#if item.b}}<li>b{{item.id}}</li>{{/if}}\n  {{/each}}\n</ul>',
      );
    });

    test('unwrapped rows: a row component whose template starts and ends with {{#if}}', async () => {
      const Row = compileNative(
        '{{#if @item.a}}<li>a{{@item.id}}</li>{{/if}}<li>{{@item.id}}</li>{{#if @item.b}}<li>b{{@item.id}}</li>{{/if}}',
      );
      const ul = await exercise(
        '<ul>\n  {{#each this.items key="id" as |item|}}\n    <Row @item={{item}} />\n  {{/each}}\n</ul>',
        { Row },
      );
      // the rows are unwrapped (W5 L1: static text around one stable node)
      const [list] = lists().filter(
        (l) => !isDestructionStarted(l) && ul.contains(l.topMarker),
      );
      expect([...list.keyMap.values()].every((row) => Array.isArray(row))).toBe(
        true,
      );
    });
  });

  test('an {{#if}} directly inside {{#in-element}}', async () => {
    const dest = fixture.document.createElement('section');
    fixture.document.body.appendChild(dest);
    const self = { a: true };
    const { parent } = render(
      withSelf(
        compileNative(
          '[{{#in-element dest}}{{#if this.a}}<b>X</b>{{/if}}{{/in-element}}]',
          { dest },
        ),
        self,
      ),
    );
    expect(html(dest)).toBe('<b>X</b>');
    await set(self, 'a', false);
    expect(html(dest)).toBe('<!---->');
    await set(self, 'a', true);
    expect(html(dest)).toBe('<b>X</b>');
    await set(self, 'a', false);
    destroyElementSync(parent, false, fixture.api);
    expect(dest.childNodes).toHaveLength(0);
  });

  test("an {{#if}} inside a component: its bounds, and the component's, as the Inspector captures them", async () => {
    const self = { a: false };
    const { parent, instance } = render(
      withSelf(compileNative('first{{#if this.a}}<b>x</b>{{/if}}'), self),
    );
    const bounds = () => {
      const [node] = captureRenderTree([parent as any]);
      const component = node.children.find(
        (child) => child.instance === instance,
      )!;
      const block = component.children.find((child) => child.name === 'if')!;
      return { component: component.bounds!, block: block.bounds! };
    };
    const root = fixture.container;
    expect(html(root)).toBe('first<!---->');
    expect(bounds().component.firstNode).toBe(root.firstChild);
    expect(bounds().component.lastNode).toBe(root.lastChild);
    expect(bounds().block.firstNode).toBe(root.lastChild);
    await set(self, 'a', true);
    expect(html(root)).toBe('first<b>x</b>');
    expect(bounds().component.lastNode).toBe(root.lastChild);
    expect(bounds().block.firstNode).toBe(root.lastChild);
    expect(bounds().block.lastNode).toBe(root.lastChild);
    expect(bounds().component.parentElement).toBe(root);
  });

  test("the Inspector keeps a branch wrapper node: the host keys its elements' modifiers by it", async () => {
    const Child = compileNative('<i>child</i>');
    const self = { a: true };
    const { parent, instance } = render(
      withSelf(
        compileNative('{{#if this.a}}<Child />{{/if}}', { Child }),
        self,
      ),
    );
    const [node] = captureRenderTree([parent as any]);
    const component = node.children.find(
      (child) => child.instance === instance,
    )!;
    const [block] = component.children;
    expect(block.name).toBe('if');
    const [wrapper] = block.children;
    const ifc = ifs()[0];
    // the branch's wrapper (one child) is not collapsed into that child
    expect(wrapper.instance).toBe(ifc.prevComponent);
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.children[0].bounds!.firstNode).toBe(
      fixture.container.querySelector('i'),
    );
  });

  test('true → false → true within one revalidation leaves the DOM untouched', async () => {
    const self = { a: true };
    render(
      withSelf(compileNative('<p>{{#if this.a}}<b>A</b>{{/if}}</p>'), self),
    );
    const p = fixture.container.querySelector('p')!;
    const b = p.querySelector('b');
    self.a = false;
    dirtyCell(tagFor(self, 'a'));
    self.a = true;
    dirtyCell(tagFor(self, 'a'));
    await syncDom();
    expect(html(p)).toBe('<b>A</b>');
    expect(p.querySelector('b')).toBe(b);
    // and quick successive revalidations settle on the last value
    for (const value of [false, true, false, false, true, false])
      await set(self, 'a', value);
    expect(html(p)).toBe('<!---->');
    expect(p.childNodes).toHaveLength(1);
  });

  test("destroy removes exactly the block's range", async () => {
    const Inner = compileNative('{{#if @on}}<b>in</b>{{/if}}');
    const self = { show: true, on: true };
    const { parent } = render(
      withSelf(
        compileNative(
          '<p><i>1</i>{{#if this.show}}<Inner @on={{this.on}} />{{/if}}<i>2</i></p>',
          { Inner },
        ),
        self,
      ),
    );
    const p = fixture.container.querySelector('p')!;
    expect(html(p)).toBe('<i>1</i><b>in</b><i>2</i>');
    await set(self, 'show', false);
    expect(html(p)).toBe('<i>1</i><!----><i>2</i>');
    await set(self, 'on', false);
    await set(self, 'show', true);
    expect(html(p)).toBe('<i>1</i><!----><i>2</i>');
    // the outer block shows the inner's <!---->; dropping it removes exactly that
    await set(self, 'show', false);
    expect(html(p)).toBe('<i>1</i><!----><i>2</i>');
    expect(liveIfs()).toHaveLength(1);
    // the whole render: nothing is left behind, content or anchor
    await set(self, 'show', true);
    await set(self, 'on', true);
    destroyElementSync(parent, false, fixture.api);
    expect(fixture.container.childNodes).toHaveLength(0);
  });
});

describe('without the EMBER_NATIVE runtime the {{#if}} anchor is permanent (unchanged)', () => {
  let fixture: DOMFixture;
  let saved: RuntimeConstants;

  beforeEach(() => {
    saved = {
      EMBER_NATIVE: runtime.EMBER_NATIVE,
      WITH_EMBER_INTEGRATION: runtime.WITH_EMBER_INTEGRATION,
    };
    runtime.EMBER_NATIVE = false;
    runtime.WITH_EMBER_INTEGRATION = true;
    fixture = createDOMFixture();
  });

  afterEach(() => {
    fixture.cleanup();
    runtime.EMBER_NATIVE = saved.EMBER_NATIVE;
    runtime.WITH_EMBER_INTEGRATION = saved.WITH_EMBER_INTEGRATION;
  });

  test('the placeholder stays after the content', async () => {
    const condition = cell(true);
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parent);
    const instance = $_if(
      condition,
      () => fixture.api.element('b'),
      () => [],
      parent as any,
    );
    renderElement(fixture.api, parent, fixture.container, instance as any);
    expect(html(fixture.container)).toBe('<b></b><!---->');
    condition.update(false);
    await syncDom();
    expect(html(fixture.container)).toBe('<!---->');
    condition.update(true);
    await syncDom();
    expect(html(fixture.container)).toBe('<b></b><!---->');
  });
});
