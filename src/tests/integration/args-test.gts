import { module, test } from 'qunit';
import { render } from '@lifeart/gxt/test-utils';

module('Integration | Interal | @arguments', function () {
  test('works as element attributes', async function (assert) {
    const Link = <template>
      <a href={{@href}}>Click Me</a>
    </template>;
    await render(
      <template><Link @href='https://g-next.netlify.app/' /></template>,
    );
    assert.dom('a').hasAttribute('href', 'https://g-next.netlify.app/');
  });
  test('support attr-like args', async function (assert) {
    const Sample = <template>
      <div aria-label={{@aria-label}}>{{or @aria-label 'default'}}</div>
    </template>;
    await render(<template><Sample @aria-label='foo' /></template>);
    assert.dom('div').hasAttribute('aria-label', 'foo');
    assert.dom('div').containsText('foo');
  });
  test('support args in subExpression control', async function (assert) {
    const and = (a: any, b: any) => {
      return a && b;
    };
    const Maybe = <template>
      {{#if (@and @textAlign @color)}}
        YES
      {{else}}
        NO
      {{/if}}
    </template>;
    await render(
      <template>
        <Maybe @and={{and}} @textAlign='center' @color='red' />
      </template>,
    );
    assert.dom().hasText('YES');
  });
  test('support args in control expressions', async function (assert) {
    const and = (a: any, b: any) => {
      return a && b;
    };
    const Maybe = <template>
      {{#if (and @textAlign @color)}}
        YES
      {{else}}
        NO
      {{/if}}
    </template>;
    await render(
      <template><Maybe @textAlign='center' @color='red' /></template>,
    );
    assert.dom().hasText('YES');
  });
  test('support strings as arguments for textContent', async function (assert) {
    const Button = <template>
      <button>{{@name}}</button>
    </template>;
    await render(<template><Button @name='tom' /></template>);
    assert.dom('button').hasText('tom');
  });
  test('support strings as arguments for attributes', async function (assert) {
    const Button = <template>
      <button type={{@type}}></button>
    </template>;
    await render(<template><Button @type='button' /></template>);
    assert.dom('button').hasAttribute('type', 'button');
  });
  test('support modifiers as arguments', async function (assert) {
    assert.expect(1);
    const onCreated = () => {
      assert.ok('created');
    };
    const Button = <template>
      <button {{@onCreated}}></button>
    </template>;
    await render(<template><Button @onCreated={{onCreated}} /></template>);
  });
  test('support helpers as arguments', async function (assert) {
    assert.expect(1);
    const helloWorld = () => {
      assert.ok('helper executed');
    };
    const Button = <template>
      <button>{{@helloWorld}}</button>
    </template>;
    await render(<template><Button @helloWorld={{helloWorld}} /></template>);
  });
  test('support helpers componsition as arguments in textContent', async function (assert) {
    const helloWorld = (value: number) => {
      return `Hello, ${value}`;
    };
    const number = (value: number) => {
      return value;
    };
    const Button = <template>
      <button>{{@helloWorld (@number 42)}}</button>
    </template>;
    await render(
      <template>
        <Button @helloWorld={{helloWorld}} @number={{number}} />
      </template>,
    );
    assert.dom('button').hasText('Hello, 42');
  });
  test('support helpers componsition as arguments in attributes', async function (assert) {
    const helloWorld = (value: number) => {
      return `Hello, ${value}`;
    };
    const number = (value: number) => {
      return value;
    };
    const Button = <template>
      <button aria-label={{@helloWorld (@number 42)}}></button>
    </template>;
    await render(
      <template>
        <Button @helloWorld={{helloWorld}} @number={{number}} />
      </template>,
    );
    assert.dom('button').hasAttribute('aria-label', 'Hello, 42');
  });
  test('support helpers componsition as sub-expression arguments in attributes', async function (assert) {
    const hello_World = (value: number) => {
      return `Hello, ${value}`;
    };
    const n_umber = (value: number) => {
      return value;
    };
    const Button = <template>
      <button aria-label={{or (@helloWorld (@number 42)) 1}}></button>
    </template>;
    await render(
      <template>
        <Button @helloWorld={{hello_World}} @number={{n_umber}} />
      </template>,
    );
    assert.dom('button').hasAttribute('aria-label', 'Hello, 42');
  });
});
