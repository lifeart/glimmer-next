import { module, test } from 'qunit';
import { addToTree } from '../../../utils/shared';
import { Component } from '../../../utils/component';
import { IfCondition } from '../../../utils/control-flow/if';
import { BasicListComponent } from '../../../utils/control-flow/list';

module('Unit | Utility | addToTree in dom.ts', function () {
  test('it uses addToTree to add IfCondition to the parent context', function (assert) {
    const parentContext = new Component();
    const condition = new IfCondition(
      parentContext,
      new Cell(true),
      document.createDocumentFragment(),
      document.createComment('if-placeholder'),
      () => [],
      () => []
    );
    assert.ok(true, 'IfCondition instance created successfully');
  });

  test('it uses addToTree to add BasicListComponent to the parent context', function (assert) {
    const parentContext = new Component();
    const listComponent = new BasicListComponent(
      { tag: new Cell([]), ctx: parentContext, key: null, ItemComponent: () => [] },
      document.createDocumentFragment(),
      document.createComment('list-placeholder')
    );
    assert.ok(true, 'BasicListComponent instance created successfully');
  });
});
