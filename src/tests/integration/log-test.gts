import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Helper | log', function () {
  test('{{log}} calls console.log and renders empty string', async function (assert) {
    const originalLog = console.log;
    const logged: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      await render(
        <template>
          <div data-test-el>{{log "hello" "world"}}</div>
        </template>,
      );
      assert.equal(logged.length, 1, 'console.log called once');
      assert.deepEqual(logged[0], ['hello', 'world'], 'correct arguments logged');
      assert.dom('[data-test-el]').hasText('', 'log renders empty string');
    } finally {
      console.log = originalLog;
    }
  });

  test('{{log}} with single primitive value', async function (assert) {
    const originalLog = console.log;
    const logged: unknown[][] = [];
    console.log = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      await render(<template>{{log 42}}</template>);
      assert.equal(logged.length, 1, 'console.log called once');
      assert.deepEqual(logged[0], [42], 'number logged correctly');
    } finally {
      console.log = originalLog;
    }
  });
});
