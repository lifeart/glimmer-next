/**
 * The rows of a list keyed by position (or of a native `{{#each-in}}`) are
 * built with references to their items, which the item reference runtime
 * (`@lifeart/gxt/item-references`) makes: the core runtime does not carry
 * them. A template that keys a list by position imports the runtime (the
 * compiler's `$_itemRefKey`), an Ember host installs it; a list keyed by
 * position without it throws, naming what to install, instead of rendering
 * rows that cannot follow their items.
 */
import { expect, test, describe, beforeEach, afterEach } from 'vitest';
import { Window } from 'happy-dom';
import { HTMLBrowserDOMApi } from '../dom-api';
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, PARENT, TREE, CHILD } from '../shared';
import { cleanupFastContext, provideContext, RENDERING_CONTEXT } from '../context';
import { Root } from '../dom';
import { SyncListComponent } from './list';
import { cell } from '../reactive';
import { itemReferenceRuntime } from '../item-reference-runtime';

describe('a list keyed by position needs the item reference runtime', () => {
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

  function build(key: string) {
    const api = new HTMLBrowserDOMApi(document);
    const root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parent);
    return new SyncListComponent<{ id: number; name: string }>(
      {
        tag: cell([{ id: 1, name: 'a' }]),
        key,
        ctx: parent,
        ItemComponent: () => document.createElement('div'),
      },
      container,
      document.createComment('list top'),
    );
  }

  test('without it, a positional list throws and names what to install; another list renders', () => {
    expect(itemReferenceRuntime()).toBe(null);
    expect(() => build('@index')).toThrow(/registerItemReferenceRuntime/);
    expect(() => build('@identity')).not.toThrow();
    expect(container.querySelectorAll('div').length).toBe(1);
  });

  test('without it, the throw leaves nothing of the list in the component tree', () => {
    const api = new HTMLBrowserDOMApi(document);
    const root = new Root(document);
    provideContext(root, RENDERING_CONTEXT, api);
    const parent = new Component({});
    parent[RENDERED_NODES_PROPERTY] = [];
    addToTree(root, parent);
    const before = [TREE.size, PARENT.size, CHILD.size];
    expect(
      () =>
        new SyncListComponent<{ id: number; name: string }>(
          {
            tag: cell([{ id: 1, name: 'a' }]),
            key: '@index',
            ctx: parent,
            ItemComponent: () => document.createElement('div'),
          },
          container,
          document.createComment('list top'),
        ),
    ).toThrow(/registerItemReferenceRuntime/);
    expect([TREE.size, PARENT.size, CHILD.size]).toEqual(before);
  });

  test('with it, a positional list builds its rows with references', async () => {
    const { registerItemReferenceRuntime } = await import('../item-references');
    registerItemReferenceRuntime();
    const list = build('@index');
    expect(list.itemRefs).not.toBe(null);
    expect(container.querySelectorAll('div').length).toBe(1);
  });
});
