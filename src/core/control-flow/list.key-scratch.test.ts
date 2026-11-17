/**
 * @vitest-environment happy-dom
 *
 * An emptied list holds none of its last rows' keys.
 *
 * The key scratch (duplicate detection, removal / move sets, the frame sync's
 * module-level key set) is reused across syncs to avoid per-sync allocation.
 * After a big list was cleared it kept the keys — and the grown tables — until
 * the next non-empty sync: ~0.3 MB after clearing 10k frame rows in
 * bench/budgets.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { $template, TREE } from '../shared';
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
import { SyncListComponent, AsyncListComponent } from './list';

const BODIES = {
  frames: '<li>{{item.label}}</li>',
  'v1 (index-reading block)': '<li>{{index}} {{item.label}}</li>',
};

describe.each(['', ' sync=true'])('{{#each%s}}: an emptied list keeps no key scratch', (sync) => {
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
        [$template] = template(
          `<ul>{{#each this.items key="id"${sync} as |item index|}}${body}{{/each}}</ul>`,
        );
      }
      const root = mountRoot(fixture, Root as any) as unknown as Root;
      await settle();
      const list = [...TREE.values()].find(
        (c) => c instanceof SyncListComponent || c instanceof AsyncListComponent,
      ) as any;
      root._items = buildItems(50);
      await settle();
      // a reorder so the move / LIS scratch is used too
      root._items = root._items.slice().reverse();
      await settle();
      root._items = [];
      await settle();
      for (const key of [
        '_dupDetectSet',
        '_dupFirstIdxMap',
        '_updatingKeys',
        '_moveSet',
        '_freshMoveKeys',
        '_processedKeys',
      ]) {
        expect(list[key].size, key).toBe(0);
      }
      for (const key of ['_existKeys', '_existNewIdx', '_existOldIdx', '_itemKeys']) {
        expect(list[key].length, key).toBe(0);
      }
    });
  }
});
