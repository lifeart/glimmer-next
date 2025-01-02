import { module, test } from 'qunit';
import { api, setDocument, getDocument } from '@/utils/dom-api';

module('Integration | DOM API', function () {
  test('api.addEventListener', function (assert) {
    const element = document.createElement('div');
    let called = false;
    const listener = () => {
      called = true;
    };

    const removeListener = api.addEventListener(element, 'click', listener);
    element.click();
    assert.true(called, 'Event listener was called');

    called = false;
    removeListener();
    element.click();
    assert.false(called, 'Event listener was removed');
  });

  test('api.attr', function (assert) {
    const element = document.createElement('div');
    api.attr(element, 'data-test', 'value');
    assert.strictEqual(element.getAttribute('data-test'), 'value', 'Attribute was set');
  });

  test('api.prop', function (assert) {
    const element = document.createElement('input');
    api.prop(element, 'value', 'test');
    assert.strictEqual(element.value, 'test', 'Property was set');
  });

  test('api.comment', function (assert) {
    const comment = api.comment('test');
    assert.strictEqual(comment.nodeType, Node.COMMENT_NODE, 'Comment node was created');
    assert.strictEqual(comment.textContent, 'test', 'Comment text was set');
  });

  test('api.text', function (assert) {
    const textNode = api.text('test');
    assert.strictEqual(textNode.nodeType, Node.TEXT_NODE, 'Text node was created');
    assert.strictEqual(textNode.textContent, 'test', 'Text content was set');
  });

  test('api.textContent', function (assert) {
    const element = document.createElement('div');
    api.textContent(element, 'test');
    assert.strictEqual(element.textContent, 'test', 'Text content was set');
  });

  test('api.fragment', function (assert) {
    const fragment = api.fragment();
    assert.strictEqual(fragment.nodeType, Node.DOCUMENT_FRAGMENT_NODE, 'Document fragment was created');
  });

  test('api.element', function (assert) {
    const element = api.element('div');
    assert.strictEqual(element.nodeType, Node.ELEMENT_NODE, 'Element was created');
    assert.strictEqual(element.tagName, 'DIV', 'Element tag name was set');
  });

  test('api.append', function (assert) {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    api.append(parent, child);
    assert.strictEqual(parent.firstChild, child, 'Child was appended');
  });

  test('api.insert', function (assert) {
    const parent = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('span');
    api.append(parent, child1);
    api.insert(parent, child2, child1);
    assert.strictEqual(parent.firstChild, child2, 'Child was inserted before another child');
  });

  test('setDocument and getDocument', function (assert) {
    const originalDocument = getDocument();
    const newDocument = document.implementation.createHTMLDocument('New Document');
    setDocument(newDocument);
    assert.strictEqual(getDocument(), newDocument, 'Document was set');
    setDocument(originalDocument);
    assert.strictEqual(getDocument(), originalDocument, 'Document was restored');
  });
});
