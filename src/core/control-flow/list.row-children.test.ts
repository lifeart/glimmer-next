/**
 * @vitest-environment happy-dom
 *
 * Components nested in an inline-element {{#each}} body are destroyed when
 * the list is cleared in bulk.
 *
 * Such a body (`<li><Badge @v={{item.label}} /></li>`) renders with the
 * row's destructor-owner ctx as its ctx, so `Badge` is a tree child of that
 * ctx. The bulk clear (`fastCleanup`: every row removed at once, and the
 * sync list's own teardown) ran only the row ctx's OWN destructors; outside
 * EMBER_NATIVE its children were never reached. Each cleared row left its
 * components in TREE/PARENT/CHILD, their destructors unrun and their
 * bindings subscribed to the removed item's cells. Found by the
 * differential tests (src/core/__fuzz__).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from '../component';
import { $template, TREE, CHILD, PARENT } from '../shared';
import { cellFor, opsForTag, relatedTags } from '../reactive';
import { registerDestructor } from '../glimmer/destroyable';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import {
  buildItems,
  settle,
  mountRoot,
  setupRuntimeTemplateGlobals,
  type HarnessItem,
} from '../__test-utils__/list-harness';
import { template } from '../../../plugins/runtime-compiler';

let destroyed = 0;

class Badge extends Component {
  constructor(args: any) {
    super(args);
    registerDestructor(this, () => {
      destroyed++;
    });
  }
  [$template] = template('<span class="badge">{{@v}}</span>');
}

describe.each(['', ' sync=true'])('{{#each%s}} with a component in the row element', (sync) => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
    destroyed = 0;
  });

  afterEach(() => {
    fixture.cleanup();
  });

  test('clearing the list destroys the nested components and their bindings', async () => {
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
        `<ul>{{#each this.items key="id"${sync} as |item|}}<li><Badge @v={{item.label}} /></li>{{/each}}</ul>`,
        { scope: { Badge } },
      );
    }
    const root = mountRoot(fixture, Root as any) as unknown as Root;
    await settle();
    const before = {
      TREE: TREE.size,
      CHILD: CHILD.size,
      PARENT: PARENT.size,
      opsForTag: opsForTag.size,
      relatedTags: relatedTags.size,
    };

    const items = buildItems(4);
    root._items = items;
    await settle();
    expect(fixture.container.querySelectorAll('span.badge')).toHaveLength(4);
    expect(TREE.size).toBeGreaterThan(before.TREE);

    root._items = [];
    await settle();
    expect(fixture.container.querySelectorAll('span.badge')).toHaveLength(0);
    expect(destroyed).toBe(4);
    expect({
      TREE: TREE.size,
      CHILD: CHILD.size,
      PARENT: PARENT.size,
      opsForTag: opsForTag.size,
      relatedTags: relatedTags.size,
    }).toEqual(before);

    // a removed item's cell no longer reaches its old binding
    items[0].label = 'after clear';
    await settle();
    expect(opsForTag.size).toBe(before.opsForTag);
  });
});
