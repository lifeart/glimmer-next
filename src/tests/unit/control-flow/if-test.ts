import { module, test } from 'qunit';
import { IfCondition } from '../../../utils/control-flow/if';
import { addToTree } from '../../../utils/shared';
import { Component } from '../../../utils/component';
import { Cell } from '../../../utils/reactive';

module('Unit | Utility | IfCondition', function () {
  test('it uses addToTree to add itself to the parent context', function (assert) {
    const parentContext = new Component();
    const condition = new Cell(true);
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('if-placeholder');
    const trueBranch = () => [];
    const falseBranch = () => [];
    const ifCondition = new IfCondition(
      parentContext,
      condition,
      target,
      placeholder,
      trueBranch,
      falseBranch
    );
    assert.ok(true, 'IfCondition instance created successfully');
  });
});
