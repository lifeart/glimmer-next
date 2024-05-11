import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | rendering | boolean attributes', function () {
  test('autofocus attribute', async function (assert) {
    await render(<template><input type='number' autofocus /></template>);
    assert.dom('input').isFocused();
  });
  test('checked attribute', async function (assert) {
    await render(<template><input type='checkbox' checked /></template>);
    assert.dom('input').isChecked();
  });
  test('disabled attribute', async function (assert) {
    await render(<template><input disabled /></template>);
    assert.dom('input').isDisabled();
  });
  test('multiple attribute', async function (assert) {
    await render(<template><input multiple /></template>);
    assert.dom('input').hasAttribute('multiple');
  });
  test('readonly attribute', async function (assert) {
    await render(<template><input readonly /></template>);
    assert.dom('input').hasProperty('readonly', true);
  });
  test('required attribute', async function (assert) {
    await render(<template><input required /></template>);
    assert.dom('input').hasProperty('required', true);
  });
  test('selected attribute', async function (assert) {
    await render(<template><option selected /></template>);
    assert.dom('option').hasProperty('selected', true);
  });
  test('hidden attribute', async function (assert) {
    await render(<template><div hidden /></template>);
    assert.dom('div').hasAttribute('hidden');
  });
  test('indeterminate attribute', async function (assert) {
    await render(<template><input type='checkbox' indeterminate /></template>);
    assert.dom('input').hasAttribute('indeterminate');
  });
  test('novalidate attribute', async function (assert) {
    await render(<template><form novalidate /></template>);
    assert.dom('form').hasProperty('novalidate', true);
  });
  test('formnovalidate attribute', async function (assert) {
    await render(<template><button formnovalidate /></template>);
    assert.dom('button').hasProperty('formnovalidate', true);
  });
  test('open attribute', async function (assert) {
    await render(<template><details open /></template>);
    assert.dom('details').hasAttribute('open');
  });
  test('ismap attribute', async function (assert) {
    await render(<template><img ismap /></template>);
    assert.dom('img').hasProperty('ismap', true);
  });
  test('download attribute', async function (assert) {
    await render(<template><a download /></template>);
    assert.dom('a').hasAttribute('download');
  });
  test('draggable attribute', async function (assert) {
    await render(<template><img draggable /></template>);
    assert.dom('img').hasAttribute('draggable');
  });
  test('spellcheck attribute', async function (assert) {
    await render(<template><input spellcheck /></template>);
    assert.dom('input').hasAttribute('spellcheck');
  });
  test('translate attribute', async function (assert) {
    await render(<template><div translate /></template>);
    assert.dom('div').hasAttribute('translate');
  });
  test('contenteditable attribute', async function (assert) {
    await render(<template><div contenteditable /></template>);
    assert.dom('div').hasAttribute('contenteditable');
  });
  test('async attribute', async function (assert) {
    await render(
      <template>
        <script async></script>
      </template>,
    );
    assert.dom('script').hasAttribute('async');
  });

  test('defer attribute', async function (assert) {
    await render(
      <template>
        <script defer></script>
      </template>,
    );
    assert.dom('script').hasAttribute('defer');
  });

  test('nomodule attribute', async function (assert) {
    await render(
      <template>
        <script nomodule></script>
      </template>,
    );
    assert.dom('script').hasProperty('nomodule', true);
  });

  test('allowfullscreen attribute', async function (assert) {
    await render(
      <template>
        <iframe allowfullscreen></iframe>
      </template>,
    );
    assert.dom('iframe').hasProperty('allowfullscreen', true);
  });

  test('autoplay attribute', async function (assert) {
    await render(
      <template>
        <video autoplay></video>
      </template>,
    );
    assert.dom('video').hasAttribute('autoplay');
  });

  test('controls attribute', async function (assert) {
    await render(
      <template>
        <video controls></video>
      </template>,
    );
    assert.dom('video').hasAttribute('controls');
  });

  test('default attribute', async function (assert) {
    await render(<template><track default /></template>);
    assert.dom('track').hasAttribute('default');
  });

  test('inert attribute', async function (assert) {
    await render(
      <template>
        <div inert></div>
      </template>,
    );
    assert.dom('div').hasAttribute('inert');
  });

  test('itemscope attribute', async function (assert) {
    await render(
      <template>
        <div itemscope></div>
      </template>,
    );
    assert.dom('div').hasProperty('itemscope', true);
  });

  test('loop attribute', async function (assert) {
    await render(
      <template>
        <video loop></video>
      </template>,
    );
    assert.dom('video').hasAttribute('loop');
  });

  test('muted attribute', async function (assert) {
    await render(
      <template>
        <video muted></video>
      </template>,
    );
    assert.dom('video').hasProperty('muted', true);
  });

  test('playsinline attribute', async function (assert) {
    await render(
      <template>
        <video playsinline></video>
      </template>,
    );
    assert.dom('video').hasProperty('playsinline', true);
  });

  test('reversed attribute', async function (assert) {
    await render(
      <template>
        <ol reversed></ol>
      </template>,
    );
    assert.dom('ol').hasAttribute('reversed');
  });
});
