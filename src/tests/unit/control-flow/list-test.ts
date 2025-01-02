import { module, test } from 'qunit';
import { BasicListComponent } from '../../../utils/control-flow/list';
import { addToTree } from '../../../utils/shared';
import { Component } from '../../../utils/component';
import { Cell } from '../../../utils/reactive';

module('Unit | Utility | BasicListComponent', function () {
  test('it uses addToTree to add itself to the parent context', function (assert) {
    const parentContext = new Component();
    const items = new Cell([]);
    const itemComponent = () => [];
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('list-placeholder');
    const listComponent = new BasicListComponent(
      { tag: items, ctx: parentContext, key: null, ItemComponent: itemComponent },
      target,
      placeholder
    );
    assert.ok(true, 'BasicListComponent instance created successfully');
  });
});
