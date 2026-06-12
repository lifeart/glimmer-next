/**
 * @vitest-environment happy-dom
 *
 * Regression coverage for nullish CONST bindings (`data-x={{undefined}}`,
 * `data-y={{null}}` — any binding whose compiled value is constantly nullish
 * without being a lazy getter).
 *
 * `resolveBindingValue` (src/core/dom.ts) used to feed the unwrapped value
 * straight into `isTagLike`, which dereferences its argument — so a nullish
 * const binding threw a TypeError during render on BOTH element-build paths:
 *   - the regular `_DOM`/$_tag path ($attr/$prop on a freshly built element);
 *   - the static-block fast path (cloned-row slot bindings reuse the exact
 *     same $attr/$prop helpers).
 * The guarded check resolves nullish as empty, matching the lazy-getter
 * (formula) path: $attr/$prop see isEmpty and skip the write, so the
 * attribute is simply absent.
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
import { cellFor } from './reactive';
import { template, compileTemplate } from '../../plugins/runtime-compiler';

const PLAIN_TEMPLATE = `<div data-x={{undefined}} data-y={{null}}>hello</div>`;

class PlainRoot extends Component {
  [$template] = template(PLAIN_TEMPLATE);
}

const EACH_TEMPLATE = `
  <ul>
    {{#each this.items key="id" as |item|}}
      <li data-x={{undefined}} data-y={{null}}>{{item.label}}</li>
    {{/each}}
  </ul>
`;

class EachRoot extends Component {
  _items: HarnessItem[] = [];
  constructor(args: any) {
    super(args);
    cellFor(this as any, '_items');
  }
  get items() {
    return this._items;
  }
  [$template] = template(EACH_TEMPLATE);
}

describe('nullish const bindings ({{undefined}} / {{null}})', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('normal _DOM path: renders without throwing, attributes absent', async () => {
    mountRoot(fixture, PlainRoot);
    await settle();

    const div = fixture.container.querySelector('div')!;
    expect(div).not.toBeNull();
    expect(div.textContent).toBe('hello');
    expect(div.hasAttribute('data-x')).toBe(false);
    expect(div.hasAttribute('data-y')).toBe(false);
  });

  test('each-body with nullish attr slots still qualifies for the static block', () => {
    const { code, errors } = compileTemplate(EACH_TEMPLATE, {});
    expect(errors).toHaveLength(0);
    // the nullish attrs become SLOTS (not baked, not a bail) — the body
    // must still compile to a static block so the fast path is exercised
    expect(code).toContain('$_blk(');
  });

  test('static-block fast path: rows render without throwing, attributes absent', async () => {
    // Instrument $_tag (compiled templates resolve it from globalThis at
    // render time) to prove rows ride the cloneNode fast path rather than
    // silently falling back to per-element builds.
    const g = globalThis as any;
    const realTag = g.$_tag;
    let tagCalls = 0;
    g.$_tag = (...args: unknown[]) => {
      tagCalls++;
      return (realTag as Function)(...args);
    };
    try {
      const root = mountRoot(fixture, EachRoot);
      await settle();
      const tagCallsAfterMount = tagCalls;

      (root as any)._items = buildItems(2, (i) => `row ${i}`);
      await settle();

      const rows = Array.from(fixture.container.querySelectorAll('li'));
      expect(rows.map((li) => li.textContent)).toEqual(['row 0', 'row 1']);
      for (const li of rows) {
        expect(li.hasAttribute('data-x')).toBe(false);
        expect(li.hasAttribute('data-y')).toBe(false);
      }
      // rows were built by cloneNode + slot binding — zero per-row $_tag calls
      expect(tagCalls).toBe(tagCallsAfterMount);
    } finally {
      g.$_tag = realTag;
    }
  });
});
