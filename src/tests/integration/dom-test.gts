import { module, test } from 'qunit';
import { addChild, renderElement } from '@/utils/dom';
import { api } from '@/utils/dom-api';

module('Integration | DOM', function () {
  test('addChild', function (assert) {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    addChild(parent, child);
    assert.strictEqual(parent.firstChild, child, 'Child was added');
  });

  test('renderElement', function (assert) {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    const placeholder = api.comment();
    parent.appendChild(placeholder);
    renderElement(parent, child, placeholder);
    assert.strictEqual(parent.firstChild, child, 'Element was rendered');
  });
});
