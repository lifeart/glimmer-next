import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell, type Cell, Component, tracked, cellFor } from '@lifeart/gxt';
import { BasicListComponent, SyncListComponent, AsyncListComponent } from '@/utils/control-flow/list';

module('Integration | Control Flow | List', function () {
  test('BasicListComponent renders items', async function (assert) {
    const items = cell([{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]);
    const ItemComponent = (item: { id: number; name: string }) => {
      return {
        nodes: [document.createTextNode(item.name)],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('list-placeholder');
    target.appendChild(placeholder);

    new BasicListComponent({ tag: items, ctx: null, key: 'id', ItemComponent }, target, placeholder);

    assert.strictEqual(target.textContent, 'Item 1Item 2');
  });

  test('SyncListComponent renders and updates items', async function (assert) {
    const items = cell([{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]);
    const ItemComponent = (item: { id: number; name: string }) => {
      return {
        nodes: [document.createTextNode(item.name)],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('list-placeholder');
    target.appendChild(placeholder);

    const listComponent = new SyncListComponent({ tag: items, ctx: null, key: 'id', ItemComponent }, target, placeholder);

    assert.strictEqual(target.textContent, 'Item 1Item 2');

    items.update([{ id: 1, name: 'Updated Item 1' }, { id: 3, name: 'Item 3' }]);
    await rerender();

    assert.strictEqual(target.textContent, 'Updated Item 1Item 3');
  });

  test('AsyncListComponent renders and updates items', async function (assert) {
    const items = cell([{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }]);
    const ItemComponent = (item: { id: number; name: string }) => {
      return {
        nodes: [document.createTextNode(item.name)],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('list-placeholder');
    target.appendChild(placeholder);

    const listComponent = new AsyncListComponent({ tag: items, ctx: null, key: 'id', ItemComponent }, target, placeholder);

    assert.strictEqual(target.textContent, 'Item 1Item 2');

    items.update([{ id: 1, name: 'Updated Item 1' }, { id: 3, name: 'Item 3' }]);
    await rerender();

    assert.strictEqual(target.textContent, 'Updated Item 1Item 3');
  });
});
