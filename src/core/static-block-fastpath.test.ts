/**
 * @vitest-environment happy-dom
 *
 * Integration coverage for the static-block fast path
 * (src/core/static-block.ts + plugins/compiler/serializers/static-block.ts;
 * RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A1/§4).
 *
 * Qualifying inline-element {{#each}} bodies are built via cloneNode + slot
 * binding instead of per-element $_tag calls. The contract under test:
 *   - the fast path is ACTUALLY exercised (no per-row $_tag calls);
 *   - DOM output is identical to the compiled-callback path (static parts
 *     baked, dynamic slots wired);
 *   - reactivity is unchanged: per-item cell updates, shared-cell class
 *     fan-out, {{on}} events, reactive {{index}};
 *   - row destroy unsubscribes the slot binding opcodes (no leak across
 *     create/clear cycles);
 *   - keyed reorder keeps row identity; {{else}} inverse still works.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import { $template } from './shared';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from './__test-utils__/list-harness';
import { cellFor, relatedTags } from './reactive';
import { template, compileTemplate } from '../../plugins/runtime-compiler';

const LIST_TEMPLATE = `
  <table><tbody>
    {{#each this.items key="id" as |item|}}
      <tr class={{this.rowClass item.id}} data-static="yes">
        <td>{{item.id}}</td>
        <td><a {{on "click" this.onRowClick}}>{{item.label}}</a></td>
        <td><span>x</span></td>
      </tr>
    {{else}}
      <tr data-empty="true"><td>empty</td></tr>
    {{/each}}
  </tbody></table>
`;

class FastPathRoot extends Component {
  _items: HarnessItem[] = [];
  _selected = 0;
  clicks: number[] = [];
  constructor(args: any) {
    super(args);
    cellFor(this as any, '_items');
    cellFor(this as any, '_selected');
  }
  get items() {
    return this._items;
  }
  rowClass = (id: number) => (this._selected === id ? 'danger' : '');
  onRowClick = (e: Event) => {
    const tr = (e.target as Element).closest('tr')!;
    this.clicks.push(Number(tr.querySelector('td')!.textContent));
  };
  [$template] = template(LIST_TEMPLATE);
}

const INDEX_TEMPLATE = `
  <ul>
    {{#each this.items key="id" as |item i|}}
      <li data-i={{i}}>{{item.label}}</li>
    {{/each}}
  </ul>
`;

class IndexRoot extends Component {
  _items: HarnessItem[] = [];
  constructor(args: any) {
    super(args);
    cellFor(this as any, '_items');
  }
  get items() {
    return this._items;
  }
  [$template] = template(INDEX_TEMPLATE);
}

describe('static-block fast path ({{#each}} cloneNode rows)', () => {
  let fixture: DOMFixture;
  let realTag: unknown;
  let tagCalls: number;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
    // Instrument $_tag (compiled templates resolve it from globalThis at
    // render time) so tests can prove rows do NOT go through the
    // per-element build path.
    const g = globalThis as any;
    realTag = g.$_tag;
    tagCalls = 0;
    g.$_tag = (...args: unknown[]) => {
      tagCalls++;
      return (realTag as Function)(...args);
    };
  });

  afterEach(() => {
    (globalThis as any).$_tag = realTag;
    fixture.cleanup();
  });

  const rows = () =>
    Array.from(
      fixture.container.querySelectorAll('tbody tr:not([data-empty])'),
    );

  test('compiler emits $_blk for the inline <tr> body', () => {
    const { code, errors } = compileTemplate(LIST_TEMPLATE, {});
    expect(errors).toHaveLength(0);
    expect(code).toContain('$_blk(');
    expect(code).toContain('data-static=\\"yes\\"');
  });

  test('rows render via the block (no per-row $_tag) with correct DOM', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    await settle();
    const tagCallsAfterMount = tagCalls;

    const items = buildItems(3, (i) => `label-${i}`);
    (root as any)._items = items;
    await settle();

    // fast path proof: building 3 rows issued ZERO additional $_tag calls
    expect(tagCalls).toBe(tagCallsAfterMount);

    const trs = rows();
    expect(trs).toHaveLength(3);
    trs.forEach((tr, i) => {
      // baked static attribute survived the clone
      expect(tr.getAttribute('data-static')).toBe('yes');
      expect(tr.children).toHaveLength(3);
      expect(tr.children[0].textContent).toBe(String(items[i].id));
      expect(tr.children[1].firstChild!.textContent).toBe(`label-${i}`);
      // baked static text child
      expect(tr.children[2].firstChild!.textContent).toBe('x');
    });
  });

  test('per-item cell update reaches the DOM', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    const items = buildItems(3);
    (root as any)._items = items;
    await settle();

    items[1].label = 'updated!';
    await settle();

    expect(rows()[1].children[1].firstChild!.textContent).toBe('updated!');
    expect(rows()[0].children[1].firstChild!.textContent).toBe(
      items[0].label,
    );
  });

  test('shared-cell class binding toggles', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    const items = buildItems(3);
    (root as any)._items = items;
    await settle();

    (root as any)._selected = items[1].id;
    await settle();
    expect(rows()[1].className).toBe('danger');
    expect(
      fixture.container.querySelectorAll('tr.danger'),
    ).toHaveLength(1);

    (root as any)._selected = items[2].id;
    await settle();
    expect(rows()[1].className).toBe('');
    expect(rows()[2].className).toBe('danger');
  });

  test('{{on "click"}} handlers fire', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    const items = buildItems(3);
    (root as any)._items = items;
    await settle();

    const anchor = rows()[2].querySelector('a')!;
    anchor.dispatchEvent(new Event('click', { bubbles: true }));
    expect(root.clicks).toEqual([items[2].id]);
  });

  test('row destroy unsubscribes slot binding opcodes (no leak)', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    const items = buildItems(5);
    const labelCell = cellFor(items[0], 'label');
    const selectedCell = cellFor(root as any, '_selected');

    (root as any)._items = items;
    await settle();
    // text binding formula is subscribed to the per-item label cell
    expect(relatedTags.get(labelCell.id)?.size ?? 0).toBeGreaterThan(0);
    const selectedSubsRendered = relatedTags.get(selectedCell.id)?.size ?? 0;
    expect(selectedSubsRendered).toBeGreaterThan(0);

    (root as any)._items = [];
    await settle();
    expect(relatedTags.get(labelCell.id)?.size ?? 0).toBe(0);
    const selectedSubsCleared = relatedTags.get(selectedCell.id)?.size ?? 0;
    expect(selectedSubsCleared).toBe(0);

    // repeated create/clear cycles stay bounded (no cumulative growth)
    for (let cycle = 0; cycle < 3; cycle++) {
      (root as any)._items = buildItems(5);
      await settle();
      expect(relatedTags.get(selectedCell.id)?.size ?? 0).toBe(
        selectedSubsRendered,
      );
      (root as any)._items = [];
      await settle();
      expect(relatedTags.get(selectedCell.id)?.size ?? 0).toBe(0);
    }
  });

  test('keyed reorder/swap keeps content correct and row identity stable', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    const items = buildItems(4, (i) => `row-${i}`);
    (root as any)._items = items;
    await settle();

    const before = rows();
    const swapped = [...items];
    const tmp = swapped[0];
    swapped[0] = swapped[3];
    swapped[3] = tmp;
    (root as any)._items = swapped;
    await settle();

    const after = rows();
    expect(after.map((tr) => tr.children[0].textContent)).toEqual(
      swapped.map((i) => String(i.id)),
    );
    // keyed semantics: the same <tr> nodes moved (no rebuild)
    expect(after[0]).toBe(before[3]);
    expect(after[3]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  test('{{else}} inverse renders when empty and after clearing', async () => {
    const root = mountRoot(fixture, FastPathRoot);
    await settle();
    expect(
      fixture.container.querySelector('tr[data-empty]'),
    ).not.toBeNull();

    (root as any)._items = buildItems(2);
    await settle();
    expect(fixture.container.querySelector('tr[data-empty]')).toBeNull();
    expect(rows()).toHaveLength(2);

    (root as any)._items = [];
    await settle();
    expect(rows()).toHaveLength(0);
    expect(
      fixture.container.querySelector('tr[data-empty]'),
    ).not.toBeNull();
  });

  test('reactive {{index}} flows through blockValues and updates on removal', async () => {
    const { code } = compileTemplate(INDEX_TEMPLATE, {});
    expect(code).toContain('$_blk(');
    expect(code).toContain('null, true,');

    const root = mountRoot(fixture, IndexRoot);
    const items = buildItems(3, (i) => `i${i}`);
    (root as any)._items = items;
    await settle();

    const lis = () => Array.from(fixture.container.querySelectorAll('li'));
    expect(lis().map((li) => li.getAttribute('data-i'))).toEqual([
      '0',
      '1',
      '2',
    ]);

    // removing the head shifts the surviving rows' reactive indices
    (root as any)._items = items.slice(1);
    await settle();
    expect(lis().map((li) => li.textContent)).toEqual(['i1', 'i2']);
    expect(lis().map((li) => li.getAttribute('data-i'))).toEqual(['0', '1']);
  });
});
