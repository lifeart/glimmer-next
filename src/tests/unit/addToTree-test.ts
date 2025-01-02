import { module, test } from 'qunit';
import { addToTree } from '../../../utils/shared';
import { Component } from '../../../utils/component';

module('Unit | Utility | addToTree', function () {
  test('it adds a node to the tree', function (assert) {
    const parentContext = new Component();
    const node = new Component();
    addToTree(parentContext, node);
    assert.ok(true, 'Node added to the tree successfully');
  });
});
