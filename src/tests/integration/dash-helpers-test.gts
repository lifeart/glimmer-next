import { module, test } from 'qunit';
import { Component } from '@lifeart/gxt';
import { render } from '@lifeart/gxt/test-utils';
import { CONSTANTS } from '../../../plugins/symbols';
module('Integration | DashHelpers | x-bar', function () {
  test('we able to resolve helper from scope by default', async function (assert) {
    function borf(value: string) {
      return value;
    }
    class Basic extends Component {
      <template>{{borf 'YES'}}</template>
    }
    await render(<template><Basic /></template>);
    assert.dom().hasText('YES');
  });
  test('dashed hlpers wrapped with helper manager', async function (assert) {
    const scope = {
      'x-borf': function (value: string) {
        return value;
      },
    };
    class Basic extends Component {
      constructor() {
        super(...arguments);
        this.args[CONSTANTS.SCOPE_KEY] = () => [scope];
      }
      <template>{{x-borf 'YES'}}</template>
    }
    await render(<template><Basic /></template>);
    assert.dom().hasText('YES');
  });
  test('dashed hlpers without args wrapped with helper manager', async function (assert) {
    const scope = {
      'x-borf': function () {
        return 'YES';
      },
    };
    class Basic extends Component {
      constructor() {
        super(...arguments);
        this.args[CONSTANTS.SCOPE_KEY] = () => [scope];
      }
      <template>{{x-borf}}</template>
    }
    await render(<template><Basic /></template>);
    assert.dom().hasText('YES');
  });
});
