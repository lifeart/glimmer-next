import 'decorator-transforms/globals';
import { module, test } from 'qunit';
import { render, click, rerender, getRoot } from '@lifeart/gxt/test-utils';
import { Component, tracked } from '@lifeart/gxt';
import { provideContext, context, getContext } from '@/core/context';

const ThemeContext = Symbol('ThemeContext');
const INTL = Symbol('INTL');

class ThemeProvider extends Component {
  <template>{{yield}}</template>
  constructor(args: any) {
    super(args);
    provideContext(this, ThemeContext, () => this.args.theme);
  }
}

class IntlProvider extends Component {
  <template>{{yield}}</template>
  constructor(args: any) {
    super(args);
    provideContext(getRoot()!, INTL, () => this.args.intl);
  }
}

class StyledDiv extends Component {
  <template>
    <div class={{this.theme.buttonClass}} ...attributes>
      {{yield}}
    </div>
  </template>
  @context(ThemeContext) theme = {
    buttonClass: '',
  };
}
class ThemedButton extends Component {
  <template>
    <button class={{this.theme.buttonClass}} ...attributes>
      {{yield this.intl}}
    </button>
  </template>

  @context(INTL) intl = {
    name: 'Default',
  };

  @context(ThemeContext) theme = {
    buttonClass: '',
  };
}

module('Integration | Context API', function () {
  test('context is still available inside nested component', async function (assert) {
    class Boo extends Component {
      <template>
        <ThemedButton data-test-button as |intl|>{{intl.name}}</ThemedButton>
      </template>
    }
    await render(
      <template>
        <ThemeProvider @theme={{hash buttonClass='bg-blue-500'}}>
          <IntlProvider @intl={{hash name='Fake'}}>
            <Boo />
          </IntlProvider>
        </ThemeProvider>
      </template>,
    );
    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('context is still available in yield', async function (assert) {
    class Boo extends Component {
      <template>{{yield}}</template>
    }
    await render(
      <template>
        <IntlProvider @intl={{hash name='Fake'}}>
          <Boo><ThemedButton
              data-test-button
              as |intl|
            >{{intl.name}}</ThemedButton></Boo>
        </IntlProvider>
      </template>,
    );
    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('context is still available in in-element', async function (assert) {
    let _node: HTMLDivElement;
    function setNode(e: HTMLDivElement) {
      _node = e;
    }
    function node() {
      return _node;
    }
    await render(
      <template>
        <div id='foo' {{setNode}}></div>
        <IntlProvider @intl={{hash name='Fake'}}>
          {{#in-element node}}
            <ThemedButton
              data-test-button
              as |intl|
            >{{intl.name}}</ThemedButton>
          {{/in-element}}
        </IntlProvider>
      </template>,
    );
    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('context is still available in each', async function (assert) {
    await render(
      <template>
        <IntlProvider @intl={{hash name='Fake'}}>
          {{#each (array 1) as |item|}}
            <ThemedButton
              data-test-button
              as |intl|
            >{{intl.name}}</ThemedButton>{{item}}
          {{/each}}
        </IntlProvider>
      </template>,
    );
    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('context is still available inside if [false branch]', async function (assert) {
    await render(
      <template>
        <IntlProvider @intl={{hash name='Fake'}}>
          {{#if true}}
            <ThemedButton
              data-test-button
              as |intl|
            >{{intl.name}}</ThemedButton>
          {{/if}}
        </IntlProvider>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('context is still available inside if [true branch]', async function (assert) {
    await render(
      <template>
        <IntlProvider @intl={{hash name='Fake'}}>
          {{#if true}}
            <ThemedButton
              data-test-button
              as |intl|
            >{{intl.name}}</ThemedButton>
          {{/if}}
        </IntlProvider>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('context decorator falling back to root context', async function (assert) {
    await render(
      <template>
        <IntlProvider @intl={{hash name='Fake'}}>
          <ThemedButton data-test-button as |intl|>{{intl.name}}</ThemedButton>
        </IntlProvider>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .hasText('Fake', 'Button receives intl from root context');
  });
  test('root context usage', async function (assert) {
    const t = (key: string) => {
      // @ts-expect-error null
      return getContext(getRoot()!, INTL)[key];
    };
    await render(
      <template>
        <IntlProvider @intl={{hash name='Fake'}}>
          <div data-test-intl>{{t 'name'}}</div>
        </IntlProvider>
      </template>,
    );
    assert.dom('[data-test-intl]').hasText('Fake');
  });
  test('provides and consumes context', async function (assert) {
    await render(
      <template>
        <ThemeProvider @theme={{hash buttonClass='bg-blue-500'}}>
          <ThemedButton data-test-button>Click me</ThemedButton>
        </ThemeProvider>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .hasClass('bg-blue-500', 'Button receives theme from context');
  });
  test('support nested contexts with same key', async function (assert) {
    await render(
      <template>
        <ThemeProvider @theme={{hash buttonClass='bg-blue-500'}}>
          <StyledDiv data-test-context-level-1>
            <ThemeProvider @theme={{hash buttonClass='bg-red-500'}}>
              <StyledDiv data-test-context-level-2>
                <ThemeProvider @theme={{hash buttonClass='bg-green-500'}}>
                  <StyledDiv data-test-context-level-3>
                    HALO
                  </StyledDiv>
                </ThemeProvider>
              </StyledDiv>
            </ThemeProvider>
          </StyledDiv>
        </ThemeProvider>
      </template>,
    );
    assert.dom('[data-test-context-level-1]').hasClass('bg-blue-500');
    assert.dom('[data-test-context-level-2]').hasClass('bg-red-500');
    assert.dom('[data-test-context-level-3]').hasClass('bg-green-500');
  });
  test('context is not available outside the provider', async function (assert) {
    await render(
      <template>
        <ThemeProvider @theme={{hash buttonClass='bg-blue-500'}} />
        <ThemedButton data-test-button>Click me</ThemedButton>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .doesNotHaveClass(
        'bg-blue-500',
        'Button does not receive theme outside the provider',
      );
  });

  test('context lookup traverses the component tree', async function (assert) {
    class Layout extends Component {
      <template>{{yield}}</template>
    }

    await render(
      <template>
        <ThemeProvider @theme={{hash buttonClass='bg-blue-500'}}>
          <Layout>
            <ThemedButton data-test-button>Click me</ThemedButton>
          </Layout>
        </ThemeProvider>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .hasClass(
        'bg-blue-500',
        'Button receives theme from context through nested components',
      );
  });

  test('context api support reactive values', async function (assert) {
    class ThemeSwitcher extends Component {
      <template>
        <button {{on 'click' this.toggleTheme}}>Toggle theme</button>
        <ThemeProvider @theme={{this.theme}}>
          {{yield}}
        </ThemeProvider>
      </template>

      @tracked
      theme = { buttonClass: 'bg-blue-500' };

      toggleTheme = () => {
        this.theme = { buttonClass: 'bg-red-500' };
      };
    }

    await render(
      <template>
        <ThemeSwitcher>
          <ThemedButton data-test-button>Click me</ThemedButton>
        </ThemeSwitcher>
      </template>,
    );

    assert
      .dom('[data-test-button]')
      .hasClass('bg-blue-500', 'Button receives initial theme');

    await click('button');
    await rerender();

    assert
      .dom('[data-test-button]')
      .hasClass('bg-red-500', 'Button receives updated theme');
  });
});
