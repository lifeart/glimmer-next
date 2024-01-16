import { module, test } from 'qunit';
import { render, allSettled } from '@lfieart/gxt/test-utils';
import { cell } from '@lifeart/gxt';

module('Integration | InternalComponent | slots', function () {
  test('default yield is supported for tagless components', async function (assert) {
    const Sloted = <template>{{yield}}</template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test]').exists();
  });
  test('default yield is supported for tagged components', async function (assert) {
    const Sloted = <template>
      <h1>{{yield}}</h1>
    </template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('h1 > [data-test]').exists();
  });
  test('yield to="default" is supported for tagless components', async function (assert) {
    const Sloted = <template>{{yield to='default'}}</template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test]').exists();
  });
  test('yield to="default" is supported for tagged components', async function (assert) {
    const Sloted = <template>
      <h1>{{yield to='default'}}</h1>
    </template>;
    await render(
      <template>
        <Sloted>
          <span data-test></span>
        </Sloted>
      </template>,
    );
    assert.dom('h1 > [data-test]').exists();
  });
  test('custom slot names is supported', async function (assert) {
    const Sloted = <template>
      <h1>{{yield to='header'}}</h1>
      <div>{{yield to='body'}}</div>
    </template>;
    await render(
      <template>
        <Sloted>
          <:header>
            <span data-test-slot='header'></span>
          </:header>
          <:body>
            <span data-test-slot='body'></span>
          </:body>
        </Sloted>
      </template>,
    );
    assert.dom('h1 > [data-test-slot="header"]').exists();
    assert.dom('div > [data-test-slot="body"]').exists();
  });
  test('if slot does not exists its not rendered', async function (assert) {
    const Sloted = <template>
      <div>{{yield to='body'}}</div>
    </template>;
    await render(
      <template>
        <Sloted>
          <:header>
            <span data-test-slot='header'></span>
          </:header>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test-slot="header"]').doesNotExist();
  });
  test('arguments from slots works', async function (assert) {
    const Sloted = <template>
      <div>{{yield 1 '2' to='body'}}</div>
    </template>;
    await render(
      <template>
        <Sloted>
          <:body as |t1 t2|>
            <span data-test-slot='body'>{{t1}}{{t2}}</span>
          </:body>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test-slot="body"]').hasText('12');
  });
  test('content inside slot remains reactive', async function (assert) {
    const Sloted = <template>
      <div>{{yield to='body'}}</div>
    </template>;
    const value = cell(1);
    await render(
      <template>
        <Sloted>
          <:body>
            <span data-test-slot='body'>{{value}}</span>
          </:body>
        </Sloted>
      </template>,
    );
    assert.dom('[data-test-slot="body"]').hasText('1');
    value.update(2);
    await allSettled();
    assert.dom('[data-test-slot="body"]').hasText('2');
  });
});
