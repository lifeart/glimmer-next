/**
 * @vitest-environment happy-dom
 *
 * An empty keyed list that receives another empty array keeps its inverse
 * (`{{else}}`) content.
 *
 * The update took the empty-list `fastCleanup`, whose bulk `clearChildren`
 * removed the inverse DOM while `inverseContent` stayed set, so the
 * following `renderInverse` did nothing: `items = []` twice in a row left
 * the list blank. Every non-frame path (sync and async, compiled body and
 * static block) lost it; frame mode kept it. Found by the differential
 * tests (src/core/__fuzz__, seeds 16/27/43/49/55).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { $template } from '../shared';
import { cellFor } from '../reactive';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from '../__test-utils__/list-harness';
import { template } from '../../../plugins/runtime-compiler';

const BODIES = {
  // compiled body with nested control flow: the generic path
  'compiled body': '<li>{{#if item.id}}{{item.label}}{{/if}}</li>',
  // static block with an event slot: v1 `$_blk`
  'static block': '<li {{on "click" this.noop}}>{{item.label}}</li>',
  // frame mode (was already correct)
  frames: '<li>{{item.label}}</li>',
};

describe.each(['', ' sync=true'])('{{#each%s}}: empty -> empty keeps {{else}}', (sync) => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  for (const [name, body] of Object.entries(BODIES)) {
    test(name, async () => {
      class Root extends Component {
        _items: HarnessItem[] = [];
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_items');
        }
        get items() {
          return this._items;
        }
        noop = () => {};
        [$template] = template(
          `<ul>{{#each this.items key="id"${sync} as |item|}}${body}{{else}}<p>none</p>{{/each}}</ul>`,
        );
      }
      const root = mountRoot(fixture, Root as any) as unknown as Root;
      await settle();
      const ul = () => fixture.container.querySelector('ul')!;
      expect(ul().querySelectorAll('p')).toHaveLength(1);

      root._items = [];
      await settle();
      expect(ul().querySelectorAll('p')).toHaveLength(1);

      root._items = buildItems(2);
      await settle();
      expect(ul().querySelectorAll('li')).toHaveLength(2);
      expect(ul().querySelectorAll('p')).toHaveLength(0);

      root._items = [];
      await settle();
      root._items = [];
      await settle();
      expect(ul().querySelectorAll('li')).toHaveLength(0);
      expect(ul().querySelectorAll('p')).toHaveLength(1);
    });
  }
});
