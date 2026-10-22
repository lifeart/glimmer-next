/**
 * @vitest-environment happy-dom
 *
 * A nested `{{#if}}` belongs to the outer branch it renders in.
 *
 * The compiler passes the component (`this`) as the `ctx` of a nested
 * `$_if`, also inside an outer branch's `$_ucw`, and standalone gxt used it
 * as the inner if's tree parent. The inner if outlived every swap of the
 * outer branch:
 *   - its condition opcode stayed subscribed, so TREE and opcode entries
 *     grew by one inner if per outer toggle until the component died;
 *   - it kept reacting: with an async teardown in the outer branch (any
 *     `{{#each}}`), a change that closed the outer branch also flipped the
 *     inner if, whose new branch rendered after the outer cleanup and stayed
 *     in the DOM.
 * Under Ember integration the active parent context was already preferred;
 * standalone now does the same when that context is a descendant of the
 * component (a block wrapper inside it). Found by the differential tests
 * (src/core/__fuzz__, seeds 1361 and 1576).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { $template, TREE } from '../shared';
import { cellFor, opsForTag, relatedTags } from '../reactive';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
} from '../__test-utils__/list-harness';
import { template } from '../../../plugins/runtime-compiler';

describe('nested {{#if}} teardown with its outer branch', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  function mount(source: string) {
    class Root extends Component {
      b = 0;
      c = true;
      _items: unknown[] = [];
      constructor(args: any) {
        super(args);
        cellFor(this as any, 'b');
        cellFor(this as any, 'c');
        cellFor(this as any, '_items');
      }
      get items() {
        return this._items;
      }
      [$template] = template(source);
    }
    return mountRoot(fixture, Root as any) as unknown as Root;
  }
  const html = () => fixture.container.innerHTML.replace(/<!--.*?-->/g, '');

  test('toggling the outer if does not accumulate inner ifs', async () => {
    const root = mount(
      '<div id="r">{{#if (eq this.b 2)}}{{#if this.c}}<em>A</em>{{else}}<em>B</em>{{/if}}{{/if}}</div>',
    );
    await settle();
    root.b = 2;
    await settle();
    root.b = 0;
    await settle();
    const sizes = () => [TREE.size, opsForTag.size, relatedTags.size];
    const after1 = sizes();
    for (let i = 0; i < 5; i++) {
      root.b = 2;
      await settle();
      root.b = 0;
      await settle();
      root.c = !root.c;
      await settle();
    }
    expect(sizes()).toEqual(after1);
    expect(html()).toBe('<div id="r"></div>');
  });

  test('closing the outer branch does not leave the inner {{else}} behind', async () => {
    const root = mount(
      '<div id="r">{{#if (eq this.b 2)}}{{#if (eq this.b 2)}}<em>A</em>{{else}}<em>B</em>{{/if}}<ul>{{#each this.items key="id" as |item|}}<li></li>{{/each}}</ul>{{/if}}</div>',
    );
    await settle();
    root._items = buildItems(1);
    await settle();
    root.b = 2;
    await settle();
    expect(html()).toBe('<div id="r"><em>A</em><ul><li></li></ul></div>');
    root.b = 0;
    await settle();
    await settle();
    expect(html()).toBe('<div id="r"></div>');
  });
});
