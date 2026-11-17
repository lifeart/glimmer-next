/**
 * The item reference a positional / each-in row is built with is released
 * with the row. A development build keeps every cell in `DEBUG_CELLS` (a
 * strong set), so an unreleased reference kept the last item of every row
 * ever built alive — and each-in builds a new row for every changed value.
 *
 * `DEBUG_CELLS` is filled only in development builds (`IS_DEV_MODE`, inlined
 * by the compiler: `vitest --mode development`), so these tests run there,
 * like the other `DEBUG_CELLS` tests (redux-devtools.test.ts).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { settle, mountRoot, setupRuntimeTemplateGlobals } from './__test-utils__/list-harness';
import { Component } from './component';
import { $template } from './shared';
import { cellFor, getCells } from './reactive';
import { isItemReference } from './control-flow/list';
import { template } from '../../plugins/runtime-compiler';

const devTest = IS_DEV_MODE ? test : test.skip;

describe('item references are released with their rows', () => {
  let fixture: DOMFixture;
  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  devTest('a positional row that is destroyed, or a cleared list, releases its references', async () => {
    class Root extends Component {
      _items: unknown[] = [];
      constructor(args: any) {
        super(args);
        cellFor(this as any, '_items');
      }
      get items() {
        return this._items;
      }
      [$template] = template(
        '<ul>{{#each this.items key="@index" as |item|}}<li>{{item.name}}</li>{{/each}}</ul>',
      );
    }
    const references = () => getCells().filter(isItemReference).length;
    const before = references();
    const root = mountRoot(fixture, Root as unknown as new (args: any) => Root);
    root._items = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    await settle();
    expect(references() - before).toBe(3);

    root._items = [{ name: 'd' }];
    await settle();
    expect(references() - before).toBe(1);

    root._items = [];
    await settle();
    expect(references() - before).toBe(0);
  });
});
