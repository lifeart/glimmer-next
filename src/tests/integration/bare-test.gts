import { module, test } from 'qunit';
import { render } from '@/tests/utils';

module('Integration | bare values rendering', function () {
  test('renders string ', async function (assert) {
    const value = 'world';
    await render(<template>{{value}}</template>);
    assert.dom().hasText(value);
  });
  test('renders number ', async function (assert) {
    const value = 42;
    await render(<template>{{value}}</template>);
    assert.dom().hasText(String(value));
  });
  test('renders boolean', async function (assert) {
    const value = true;
    await render(<template>{{value}}</template>);
    assert.dom().hasText('');
  });
  test('renders null', async function (assert) {
    const value = null;
    await render(<template>{{value}}</template>);
    assert.dom().hasText('');
  });
  test('renders undefined', async function (assert) {
    const value = undefined;
    await render(<template>{{value}}</template>);
    assert.dom().hasText('');
  });
});
