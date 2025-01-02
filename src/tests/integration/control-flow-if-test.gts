import { module, test } from 'qunit';
import { render, rerender } from '@lifeart/gxt/test-utils';
import { cell, type Cell, Component, tracked, cellFor } from '@lifeart/gxt';
import { IfCondition } from '@/utils/control-flow/if';

module('Integration | Control Flow | IfCondition', function () {
  test('it renders true branch when condition is true', async function (assert) {
    const condition = cell(true);
    const trueBranch = () => {
      return {
        nodes: [document.createTextNode('True branch')],
        ctx: null,
      };
    };
    const falseBranch = () => {
      return {
        nodes: [document.createTextNode('False branch')],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('if-placeholder');
    target.appendChild(placeholder);

    new IfCondition(null, condition, target, placeholder, trueBranch, falseBranch);

    assert.strictEqual(target.textContent, 'True branch');
  });

  test('it renders false branch when condition is false', async function (assert) {
    const condition = cell(false);
    const trueBranch = () => {
      return {
        nodes: [document.createTextNode('True branch')],
        ctx: null,
      };
    };
    const falseBranch = () => {
      return {
        nodes: [document.createTextNode('False branch')],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('if-placeholder');
    target.appendChild(placeholder);

    new IfCondition(null, condition, target, placeholder, trueBranch, falseBranch);

    assert.strictEqual(target.textContent, 'False branch');
  });

  test('it updates to true branch when condition changes to true', async function (assert) {
    const condition = cell(false);
    const trueBranch = () => {
      return {
        nodes: [document.createTextNode('True branch')],
        ctx: null,
      };
    };
    const falseBranch = () => {
      return {
        nodes: [document.createTextNode('False branch')],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('if-placeholder');
    target.appendChild(placeholder);

    const ifCondition = new IfCondition(null, condition, target, placeholder, trueBranch, falseBranch);

    assert.strictEqual(target.textContent, 'False branch');

    condition.update(true);
    await rerender();

    assert.strictEqual(target.textContent, 'True branch');
  });

  test('it updates to false branch when condition changes to false', async function (assert) {
    const condition = cell(true);
    const trueBranch = () => {
      return {
        nodes: [document.createTextNode('True branch')],
        ctx: null,
      };
    };
    const falseBranch = () => {
      return {
        nodes: [document.createTextNode('False branch')],
        ctx: null,
      };
    };
    const target = document.createDocumentFragment();
    const placeholder = document.createComment('if-placeholder');
    target.appendChild(placeholder);

    const ifCondition = new IfCondition(null, condition, target, placeholder, trueBranch, falseBranch);

    assert.strictEqual(target.textContent, 'True branch');

    condition.update(false);
    await rerender();

    assert.strictEqual(target.textContent, 'False branch');
  });
});
