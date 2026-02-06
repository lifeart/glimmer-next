import { module, test } from 'qunit';
import { render, rerender, find } from '@lifeart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | Internal | Cell', function () {
  test('could render cell as text primitive', async function (assert) {
    const value = cell('foo');
    await render(<template>{{value}}</template>);

    assert.dom().hasText('foo', 'cell value is rendered');
    value.update('bar');
    await rerender();
    assert.dom().hasText('bar', 'cell value is updated');
  });
  test('could render cell as attr primitive', async function (assert) {
    const value = cell('foo');
    await render(
      <template>
        <div id={{value}}>123</div>
      </template>,
    );

    assert.dom('#foo').hasText('123', 'cell value is rendered');
    value.update('bar');
    await rerender();
    assert.dom('#bar').hasText('123', 'cell value is updated');
    assert.dom('#foo').doesNotExist('old cell value is removed');
  });
  test('could render cell as prop primitive', async function (assert) {
    const value = cell(true);
    await render(<template><input checked={{value}} /></template>);

    assert.dom('input').isChecked('cell value is rendered');
    value.update(false);
    await rerender();
    assert.dom('input').isNotChecked('cell value is updated');
  });
  test('cell with null initial value renders empty', async function (assert) {
    const value = cell<string | null>(null);
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('', 'null cell renders empty');
  });

  test('cell updating from value to null clears text', async function (assert) {
    const value = cell<string | null>('visible');
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('visible');

    value.update(null);
    await rerender();
    assert.dom('[data-test-el]').hasText('', 'text cleared after null update');
  });

  test('cell updating from null to value shows text', async function (assert) {
    const value = cell<string | null>(null);
    await render(
      <template>
        <div data-test-el>{{value}}</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasText('');

    value.update('now visible');
    await rerender();
    assert.dom('[data-test-el]').hasText('now visible', 'text shown after update from null');
  });

  test('multiple cells updating in same rerender cycle', async function (assert) {
    const first = cell('a');
    const second = cell('b');
    const third = cell('c');
    await render(
      <template>
        <span data-test-first>{{first}}</span>
        <span data-test-second>{{second}}</span>
        <span data-test-third>{{third}}</span>
      </template>,
    );
    assert.dom('[data-test-first]').hasText('a');
    assert.dom('[data-test-second]').hasText('b');
    assert.dom('[data-test-third]').hasText('c');

    first.update('x');
    second.update('y');
    third.update('z');
    await rerender();

    assert.dom('[data-test-first]').hasText('x');
    assert.dom('[data-test-second]').hasText('y');
    assert.dom('[data-test-third]').hasText('z');
  });

  test('class attribute set to null becomes empty string', async function (assert) {
    const cls = cell<string | null>('active');
    await render(
      <template>
        <div data-test-el class={{cls}}>content</div>
      </template>,
    );
    assert.dom('[data-test-el]').hasClass('active');

    cls.update(null);
    await rerender();
    const el = find('[data-test-el]');
    assert.equal(
      el.getAttribute('class'),
      '',
      'class attribute set to empty string when null (not removed)',
    );
  });

  test('data attribute set to null becomes empty string', async function (assert) {
    const val = cell<string | null>('value');
    await render(
      <template>
        <div data-test-el data-info={{val}}>content</div>
      </template>,
    );
    assert.equal(
      find('[data-test-el]').getAttribute('data-info'),
      'value',
    );

    val.update(null);
    await rerender();
    assert.equal(
      find('[data-test-el]').getAttribute('data-info'),
      '',
      'data attribute set to empty string when null (not removed)',
    );
  });

  test('it works for reactive className property', async function (assert) {
    const value = cell('foo');
    await render(
      <template>
        <div class={{value}}>123</div>
      </template>,
    );

    assert.dom('div').hasClass('foo', 'cell value is rendered');
    value.update('bar');
    await rerender();
    assert.dom('div').hasClass('bar', 'cell value is updated');
    assert.dom('div').doesNotHaveClass('foo', 'old cell value is removed');
  });
});
