/**
 * Integration tests for build-time and runtime compiled components working together.
 * Tests args passing, slots, blocks, and reactivity.
 *
 * Note: These tests use the actual template compilation infrastructure.
 * - Runtime templates use compileTemplate() which returns executable functions
 * - The tests verify that the runtime compiler produces working templates
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Component } from './component';
import {
  RENDERED_NODES_PROPERTY,
  addToTree,
  $template,
} from './shared';
import {
  $_c,
  $_args,
  $_edp,
} from './dom';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import { cell } from './reactive';
import { renderElement } from './render-core';
import {
  compileTemplate,
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
  type TemplateOptions,
} from '../../plugins/runtime-compiler';

// Note: setupGlobalScope() is now called explicitly in beforeEach
// instead of relying on auto-setup on module import.

describe('Runtime Compiler Integration', () => {
  let fixture: DOMFixture;

  /**
   * Helper to render any component (class-based, template-only, or inline template string)
   *
   * @example
   * // Render a class
   * render(MyComponent);
   *
   * // Render a template-only component
   * render(MyTemplateOnly, { name: 'World' });
   *
   * // Render an inline template string
   * render('<div>{{@name}}</div>', { name: 'World' });
   *
   * // Render with scope
   * render('<Child @value={{@x}} />', { x: 1 }, { scope: { Child } });
   */
  function render<T = any>(
    componentOrTemplate: T | string,
    componentArgs: Record<string, unknown> = {},
    options?: TemplateOptions
  ) {
    const component = typeof componentOrTemplate === 'string'
      ? template(componentOrTemplate, options)
      : componentOrTemplate;

    const parentComponent = new Component({});
    parentComponent[RENDERED_NODES_PROPERTY] = [];
    addToTree(fixture.root, parentComponent);

    const args = $_args(componentArgs, false, $_edp as any);
    const instance = $_c(component as any, args, parentComponent);
    renderElement(fixture.api, parentComponent, fixture.container, instance);

    return instance;
  }

  beforeEach(() => {
    fixture = createDOMFixture();

    // Explicitly setup global scope for runtime-compiled templates
    // This was previously auto-setup on module import, but is now lazy/explicit
    setupGlobalScope();

    // Make GXT symbols available globally for runtime templates
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  describe('compileTemplate API', () => {
    test('compiles simple template and returns templateFn', () => {
      const result = compileTemplate('<div>Hello World</div>');

      expect(result.errors).toHaveLength(0);
      expect(typeof result.templateFn).toBe('function');
      expect(result.code).toContain('$_tag');
    });

    test('compiles template with mustache expression', () => {
      const result = compileTemplate('<div>{{this.name}}</div>');

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('this.name');
    });

    test('compiles template with @arg syntax', () => {
      const result = compileTemplate('<span>{{@value}}</span>', {
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(result.errors).toHaveLength(0);
      // The code should reference args via alias
      expect(result.code).toContain('$a.');
    });
  });

  describe('Runtime Component Rendering', () => {
    test('runtime-compiled static template renders correctly', () => {
      class StaticComponent extends Component {
        [$template] = template('<div data-testid="static">Static Content</div>');
      }

      render(StaticComponent);

      expect(fixture.container.textContent).toContain('Static Content');
    });

    test('runtime-compiled component with this.property works', () => {
      class PropertyComponent extends Component {
        myName = 'TestUser';
        [$template] = template('<div>Name: {{this.myName}}</div>');
      }

      render(PropertyComponent);

      expect(fixture.container.textContent).toContain('Name: TestUser');
    });

    test('runtime-compiled component with reactive cell property', async () => {
      class ReactivePropertyComponent extends Component {
        countCell = cell(0);
        get countValue() {
          return this.countCell.value;
        }
        [$template] = template('<div>Count: {{this.countValue}}</div>');
      }

      const instance = render(ReactivePropertyComponent);

      expect(fixture.container.textContent).toContain('Count: 0');

      // Update the cell
      instance.countCell.update(42);

      // Wait for reactivity to propagate
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(fixture.container.textContent).toContain('Count: 42');
    });
  });

  describe('Template Compilation Flags', () => {
    test('IS_GLIMMER_COMPAT_MODE flag affects @arg compilation', () => {
      const compatResult = compileTemplate('<div>{{@name}}</div>', {
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      expect(compatResult.errors).toHaveLength(0);
      // In compat mode, @name should be compiled with args alias
      expect(compatResult.code).toContain('$a.');
    });

    test('WITH_MODIFIER_MANAGER flag enables modifier support', () => {
      const result = compileTemplate('<div {{myModifier}}></div>', {
        bindings: new Set(['myModifier']),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_maybeModifier');
    });
  });

  describe('Error Handling', () => {
    test('malformed template reports errors gracefully', () => {
      const result = compileTemplate('<div><span></div>');

      // Should have errors for mismatched tags
      expect(result.errors.length).toBeGreaterThan(0);

      // Should still return a function (graceful degradation)
      expect(typeof result.templateFn).toBe('function');
    });

    test('template with unknown binding compiles with $_maybeHelper', () => {
      const result = compileTemplate('<div>{{unknownThing}}</div>');

      expect(result.errors).toHaveLength(0);
      // Unknown bindings should use $_maybeHelper for runtime resolution
      expect(result.code).toContain('$_maybeHelper');
    });
  });

  describe('Template Code Generation', () => {
    test('generates correct structure for nested elements', () => {
      const result = compileTemplate(`
        <div class="outer">
          <span class="inner">
            Content
          </span>
        </div>
      `);

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_tag');
      expect(result.code).toContain('outer');
      expect(result.code).toContain('inner');
    });

    test('generates correct structure for conditional', () => {
      const result = compileTemplate(`
        {{#if this.show}}
          <div>Visible</div>
        {{/if}}
      `);

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_if');
    });

    test('generates correct structure for each loop', () => {
      const result = compileTemplate(`
        {{#each this.items as |item|}}
          <li>{{item}}</li>
        {{/each}}
      `);

      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain('$_each');
    });
  });

  describe('Actual DOM Rendering', () => {
    test('renders nested elements with correct structure', () => {
      class NestedComponent extends Component {
        [$template] = template(`
          <div class="outer">
            <span class="inner">Content</span>
          </div>
        `);
      }

      render(NestedComponent);

      const outer = fixture.container.querySelector('.outer');
      expect(outer).not.toBeNull();
      expect(outer?.tagName.toLowerCase()).toBe('div');

      const inner = fixture.container.querySelector('.inner');
      expect(inner).not.toBeNull();
      expect(inner?.tagName.toLowerCase()).toBe('span');
      expect(inner?.textContent).toBe('Content');
    });

    test('renders element with multiple attributes', () => {
      class InputComponent extends Component {
        [$template] = template(`
          <input type="text" placeholder="Enter name" data-testid="input" />
        `);
      }

      render(InputComponent);

      const input = fixture.container.querySelector('input') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.type).toBe('text');
      expect(input.placeholder).toBe('Enter name');
      expect(input.getAttribute('data-testid')).toBe('input');
    });

    test('renders dynamic text content from this.property', () => {
      class ContentComponent extends Component {
        title = 'Hello World';
        description = 'This is a test description';
        [$template] = template(`
          <div>
            <h1>{{this.title}}</h1>
            <p>{{this.description}}</p>
          </div>
        `);
      }

      render(ContentComponent);

      const h1 = fixture.container.querySelector('h1');
      expect(h1?.textContent).toBe('Hello World');

      const p = fixture.container.querySelector('p');
      expect(p?.textContent).toBe('This is a test description');
    });

    test('renders conditional content with {{#if}}', () => {
      class ConditionalComponent extends Component {
        showContent = true;
        [$template] = template(`
          {{#if this.showContent}}
            <div class="visible">Visible Content</div>
          {{/if}}
        `);
      }

      render(ConditionalComponent);

      const visible = fixture.container.querySelector('.visible');
      expect(visible).not.toBeNull();
      expect(visible?.textContent).toBe('Visible Content');
    });

    test('renders conditional with else branch', () => {
      class AuthComponent extends Component {
        isLoggedIn = false;
        [$template] = template(`
          {{#if this.isLoggedIn}}
            <span class="logged-in">Welcome!</span>
          {{else}}
            <span class="logged-out">Please log in</span>
          {{/if}}
        `);
      }

      render(AuthComponent);

      // Should show else branch since isLoggedIn is false
      expect(fixture.container.querySelector('.logged-in')).toBeNull();
      expect(fixture.container.querySelector('.logged-out')?.textContent).toBe('Please log in');
    });

    test('renders list with {{#each}}', () => {
      class ListComponent extends Component {
        items = ['Apple', 'Banana', 'Cherry'];
        [$template] = template(`
          <ul>
            {{#each this.items as |item|}}
              <li>{{item}}</li>
            {{/each}}
          </ul>
        `);
      }

      render(ListComponent);

      const listItems = fixture.container.querySelectorAll('li');
      expect(listItems.length).toBe(3);
      expect(listItems[0].textContent).toBe('Apple');
      expect(listItems[1].textContent).toBe('Banana');
      expect(listItems[2].textContent).toBe('Cherry');
    });

    test('renders list with object items containing id', () => {
      class IndexedListComponent extends Component {
        items = [
          { id: 0, name: 'First' },
          { id: 1, name: 'Second' },
          { id: 2, name: 'Third' },
        ];
        [$template] = template(`
          <ol>
            {{#each this.items key="id" as |item|}}
              <li>{{item.id}}: {{item.name}}</li>
            {{/each}}
          </ol>
        `);
      }

      render(IndexedListComponent);

      const listItems = fixture.container.querySelectorAll('li');
      expect(listItems.length).toBe(3);
      expect(listItems[0].textContent).toContain('0: First');
      expect(listItems[1].textContent).toContain('1: Second');
      expect(listItems[2].textContent).toContain('2: Third');
    });

    test('renders with built-in eq helper', () => {
      class StatusComponent extends Component {
        status = 'active';
        [$template] = template(`
          {{#if (eq this.status "active")}}
            <span class="active">Active</span>
          {{else}}
            <span class="inactive">Inactive</span>
          {{/if}}
        `);
      }

      render(StatusComponent);

      expect(fixture.container.querySelector('.active')?.textContent).toBe('Active');
      expect(fixture.container.querySelector('.inactive')).toBeNull();
    });

    test('renders with built-in not helper', () => {
      class ButtonComponent extends Component {
        isDisabled = false;
        [$template] = template(`
          {{#if (not this.isDisabled)}}
            <button>Click me</button>
          {{/if}}
        `);
      }

      render(ButtonComponent);

      const button = fixture.container.querySelector('button');
      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Click me');
    });

    test('renders multiple root elements', () => {
      class MultiRootComponent extends Component {
        [$template] = template(`
          <header>Header</header>
          <main>Main Content</main>
          <footer>Footer</footer>
        `);
      }

      render(MultiRootComponent);

      expect(fixture.container.querySelector('header')?.textContent).toBe('Header');
      expect(fixture.container.querySelector('main')?.textContent).toBe('Main Content');
      expect(fixture.container.querySelector('footer')?.textContent).toBe('Footer');
    });

    test('renders dynamic class binding', () => {
      class DynamicClassComponent extends Component {
        dynamicClass = 'highlight active';
        [$template] = template(`
          <div class="{{this.dynamicClass}}">Dynamic Class</div>
        `);
      }

      render(DynamicClassComponent);

      const div = fixture.container.querySelector('div');
      expect(div?.className).toBe('highlight active');
    });

    test('renders empty list gracefully', () => {
      class EmptyListComponent extends Component {
        items: string[] = [];
        [$template] = template(`
          <ul>
            {{#each this.items as |item|}}
              <li>{{item}}</li>
            {{/each}}
          </ul>
        `);
      }

      render(EmptyListComponent);

      const ul = fixture.container.querySelector('ul');
      expect(ul).not.toBeNull();
      expect(fixture.container.querySelectorAll('li').length).toBe(0);
    });

    test('renders objects in list with property access', () => {
      class UserListComponent extends Component {
        users = [
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
        ];
        [$template] = template(`
          <ul>
            {{#each this.users as |user|}}
              <li class="user">
                <span class="name">{{user.name}}</span>
                <span class="email">{{user.email}}</span>
              </li>
            {{/each}}
          </ul>
        `);
      }

      render(UserListComponent);

      const userItems = fixture.container.querySelectorAll('.user');
      expect(userItems.length).toBe(2);

      const names = fixture.container.querySelectorAll('.name');
      expect(names[0].textContent).toBe('Alice');
      expect(names[1].textContent).toBe('Bob');

      const emails = fixture.container.querySelectorAll('.email');
      expect(emails[0].textContent).toBe('alice@example.com');
      expect(emails[1].textContent).toBe('bob@example.com');
    });
  });

  describe('Template-Only Components', () => {
    test('template() creates a component without a class', () => {
      const Greeting = template('<div class="greeting">Hello!</div>');

      expect(typeof Greeting).toBe('function');
      expect((Greeting as any).__templateOnly).toBe(true);
    });

    test('template-only component renders static content', () => {
      const StaticGreeting = template('<div class="static">Static Template-Only</div>');

      render(StaticGreeting);

      const div = fixture.container.querySelector('.static');
      expect(div).not.toBeNull();
      expect(div?.textContent).toBe('Static Template-Only');
    });

    test('template-only component receives @args', () => {
      const NameGreeting = template('<span class="name">Hello {{@name}}!</span>');

      render(NameGreeting, { name: 'World' });

      const span = fixture.container.querySelector('.name');
      expect(span).not.toBeNull();
      expect(span?.textContent).toBe('Hello World!');
    });

    test('template-only component with multiple @args', () => {
      const UserCard = template(`
        <div class="user-card">
          <h2>{{@firstName}} {{@lastName}}</h2>
          <p>{{@email}}</p>
        </div>
      `);

      render(UserCard, {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
      });

      const h2 = fixture.container.querySelector('.user-card h2');
      expect(h2?.textContent).toBe('John Doe');

      const p = fixture.container.querySelector('.user-card p');
      expect(p?.textContent).toBe('john@example.com');
    });

    test('template-only component with conditional rendering', () => {
      const ConditionalMessage = template(`
        {{#if @show}}
          <div class="visible">Visible!</div>
        {{else}}
          <div class="hidden">Hidden!</div>
        {{/if}}
      `);

      // Test with show=true
      render(ConditionalMessage, { show: true });
      expect(fixture.container.querySelector('.visible')).not.toBeNull();
      expect(fixture.container.querySelector('.hidden')).toBeNull();
    });

    test('template-only component with conditional else branch', () => {
      const ConditionalMessage = template(`
        {{#if @show}}
          <div class="visible">Visible!</div>
        {{else}}
          <div class="hidden">Hidden!</div>
        {{/if}}
      `);

      render(ConditionalMessage, { show: false });
      expect(fixture.container.querySelector('.visible')).toBeNull();
      expect(fixture.container.querySelector('.hidden')).not.toBeNull();
    });

    test('template-only component with each loop over @args', () => {
      const ItemList = template(`
        <ul class="items">
          {{#each @items as |item|}}
            <li>{{item}}</li>
          {{/each}}
        </ul>
      `);

      render(ItemList, { items: ['One', 'Two', 'Three'] });

      const listItems = fixture.container.querySelectorAll('.items li');
      expect(listItems.length).toBe(3);
      expect(listItems[0].textContent).toBe('One');
      expect(listItems[1].textContent).toBe('Two');
      expect(listItems[2].textContent).toBe('Three');
    });

    test('template-only component with nested object @args', () => {
      const ProfileCard = template(`
        <div class="profile">
          <span class="user-name">{{@user.name}}</span>
          <span class="user-age">{{@user.age}}</span>
        </div>
      `);

      render(ProfileCard, {
        user: { name: 'Alice', age: 30 },
      });

      expect(fixture.container.querySelector('.user-name')?.textContent).toBe('Alice');
      expect(fixture.container.querySelector('.user-age')?.textContent).toBe('30');
    });

    test('template-only component with helper in @args context', () => {
      const StatusBadge = template(`
        {{#if (eq @status "active")}}
          <span class="badge active">Active</span>
        {{else}}
          <span class="badge inactive">Inactive</span>
        {{/if}}
      `);

      render(StatusBadge, { status: 'active' });
      expect(fixture.container.querySelector('.badge.active')?.textContent).toBe('Active');
    });

    test('template-only component with multiple root elements', () => {
      const MultiRoot = template(`
        <span class="first">{{@first}}</span>
        <span class="second">{{@second}}</span>
      `);

      render(MultiRoot, { first: 'A', second: 'B' });

      expect(fixture.container.querySelector('.first')?.textContent).toBe('A');
      expect(fixture.container.querySelector('.second')?.textContent).toBe('B');
    });
  });

  describe('Inline Template Rendering', () => {
    test('render accepts a template string directly', () => {
      render('<div class="inline">Inline Template</div>');

      expect(fixture.container.querySelector('.inline')?.textContent).toBe('Inline Template');
    });

    test('render accepts a template string with @args', () => {
      render('<span class="greeting">Hello {{@name}}!</span>', { name: 'World' });

      expect(fixture.container.querySelector('.greeting')?.textContent).toBe('Hello World!');
    });

    test('render accepts a template string with multiple @args', () => {
      render(
        '<div class="user">{{@firstName}} {{@lastName}}</div>',
        { firstName: 'John', lastName: 'Doe' }
      );

      expect(fixture.container.querySelector('.user')?.textContent).toBe('John Doe');
    });

    test('render accepts a template string with scope for child components', () => {
      const Badge = template('<span class="badge">{{@label}}</span>');

      render(
        '<div class="card"><Badge @label={{@title}} /></div>',
        { title: 'Hello' },
        { scope: { Badge } }
      );

      expect(fixture.container.querySelector('.badge')?.textContent).toBe('Hello');
    });

    test('render accepts a template string with class-based child in scope', () => {
      class Button extends Component {
        [$template] = template('<button class="btn">{{@text}}</button>');
      }

      render(
        '<div class="container"><Button @text={{@label}} /></div>',
        { label: 'Click Me' },
        { scope: { Button } }
      );

      expect(fixture.container.querySelector('.btn')?.textContent).toBe('Click Me');
    });

    test('render accepts a template string with conditional', () => {
      render(
        `{{#if @show}}<div class="visible">Shown</div>{{else}}<div class="hidden">Hidden</div>{{/if}}`,
        { show: true }
      );

      expect(fixture.container.querySelector('.visible')?.textContent).toBe('Shown');
      expect(fixture.container.querySelector('.hidden')).toBeNull();
    });

    test('render accepts a template string with each loop', () => {
      render(
        '<ul>{{#each @items as |item|}}<li>{{item}}</li>{{/each}}</ul>',
        { items: ['A', 'B', 'C'] }
      );

      const items = fixture.container.querySelectorAll('li');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('A');
    });

    test('render accepts a template string with nested scoped components', () => {
      const Inner = template('<span class="inner">{{@value}}</span>');
      const Outer = template('<div class="outer"><Inner @value={{@data}} /></div>', {
        scope: { Inner }
      });

      render(
        '<section><Outer @data={{@input}} /></section>',
        { input: 'Nested!' },
        { scope: { Outer } }
      );

      expect(fixture.container.querySelector('.inner')?.textContent).toBe('Nested!');
    });
  });

  describe('Dynamic Eval Option', () => {
    test('eval resolves simple binding from outer scope', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const greeting = 'Hello from eval!';

      render('<div class="eval-test">{{greeting}}</div>', {}, {
        eval() {
          return eval(arguments[0]);
        }
      });

      expect(fixture.container.querySelector('.eval-test')?.textContent).toBe('Hello from eval!');
    });

    test('eval resolves multiple bindings from outer scope', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const firstName = 'John';
      // @ts-ignore TS6133 - variable captured by eval()
      const lastName = 'Doe';

      render('<div class="name">{{firstName}} {{lastName}}</div>', {}, {
        eval() {
          return eval(arguments[0]);
        }
      });

      expect(fixture.container.querySelector('.name')?.textContent).toBe('John Doe');
    });

    test('eval works with template-only components', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const message = 'Dynamic message';

      const DynamicGreeting = template('<span class="dynamic">{{message}}</span>', {
        eval() {
          return eval(arguments[0]);
        }
      });

      render(DynamicGreeting);

      expect(fixture.container.querySelector('.dynamic')?.textContent).toBe('Dynamic message');
    });

    test('eval works with class-based components', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const externalValue = 'External';

      class EvalComponent extends Component {
        [$template] = template('<div class="eval-class">{{externalValue}} - {{this.internalValue}}</div>', {
          eval() {
            return eval(arguments[0]);
          }
        });
        internalValue = 'Internal';
      }

      render(EvalComponent);

      expect(fixture.container.querySelector('.eval-class')?.textContent).toBe('External - Internal');
    });

    test('scope takes precedence over eval', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const name = 'from eval';

      render('<div class="precedence">{{name}}</div>', {}, {
        scope: { name: 'from scope' },
        eval() {
          return eval(arguments[0]);
        }
      });

      // scope is checked via bindings, eval is for truly unknown bindings
      // When name is in scope, it's compiled differently (not as unknown binding)
      expect(fixture.container.querySelector('.precedence')?.textContent).toBe('from scope');
    });

    test('@args take precedence over eval', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const name = 'from eval';

      render('<div class="args-precedence">{{@name}}</div>', { name: 'from args' }, {
        eval() {
          return eval(arguments[0]);
        }
      });

      expect(fixture.container.querySelector('.args-precedence')?.textContent).toBe('from args');
    });

    test('this.property takes precedence over eval', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const myProp = 'from eval';

      class PrecedenceComponent extends Component {
        myProp = 'from this';
        [$template] = template('<div class="this-precedence">{{this.myProp}}</div>', {
          eval() {
            return eval(arguments[0]);
          }
        });
      }

      render(PrecedenceComponent);

      expect(fixture.container.querySelector('.this-precedence')?.textContent).toBe('from this');
    });

    test('eval falls back gracefully when variable undefined', () => {
      render('<div class="fallback">{{undefinedVar}}</div>', {}, {
        eval() {
          try {
            return eval(arguments[0]);
          } catch {
            return undefined;
          }
        }
      });

      // Should render empty or the literal string, not crash
      const element = fixture.container.querySelector('.fallback');
      expect(element).not.toBeNull();
      // Undefined eval result should render as empty text
      expect(fixture.container.querySelector('.fallback')?.textContent).toBe('');
    });

    test('eval works for text interpolation inside conditional', () => {
      // Note: {{#if @condition}} uses @args, but {{message}} inside uses eval
      // @ts-ignore TS6133 - variable captured by eval()
      const message = 'Conditional message';

      render(
        `{{#if @show}}<div class="shown">{{message}}</div>{{/if}}`,
        { show: true },
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const message = 'Conditional message';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      expect(fixture.container.querySelector('.shown')?.textContent).toBe('Conditional message');
    });

    test('eval works for text interpolation inside each loop', () => {
      // Note: {{#each @items}} uses @args, but {{prefix}} inside uses eval
      render(
        '<ul>{{#each @items as |item|}}<li>{{prefix}}: {{item}}</li>{{/each}}</ul>',
        { items: ['A', 'B', 'C'] },
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const prefix = 'Item';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      const listItems = fixture.container.querySelectorAll('li');
      expect(listItems.length).toBe(3);
      expect(listItems[0].textContent).toBe('Item: A');
    });

    test('eval with nested child components', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const parentValue = 'Parent';
      // @ts-ignore TS6133 - variable captured by eval()
      const childValue = 'Child';

      const ChildComponent = template('<span class="child">{{childValue}}</span>', {
        eval() {
          return eval(arguments[0]);
        }
      });

      render(
        '<div class="parent">{{parentValue}} - <ChildComponent /></div>',
        {},
        {
          scope: { ChildComponent },
          eval() {
            return eval(arguments[0]);
          }
        }
      );

      expect(fixture.container.querySelector('.parent')?.textContent).toContain('Parent');
      expect(fixture.container.querySelector('.child')?.textContent).toBe('Child');
    });

    test('eval function that throws is handled gracefully', () => {
      render('<div class="error-test">{{throwingVar}}</div>', {}, {
        eval() {
          throw new Error('Intentional error');
        }
      });

      // Should not crash, element should exist
      expect(fixture.container.querySelector('.error-test')).not.toBeNull();
      // Eval throwing returns undefined, which should render as empty text
      expect(fixture.container.querySelector('.error-test')?.textContent).toBe('');
    });

    test('child component can have different eval than parent', () => {
      const parentScope = 'Parent Scope';
      const childScope = 'Child Scope';

      const ChildWithOwnEval = template('<span class="child-eval">{{value}}</span>', {
        eval() {
          // @ts-ignore TS6133 - variable captured by eval()
          const value = childScope;
          return eval(arguments[0]);
        }
      });

      render(
        '<div class="parent-eval">{{value}} - <ChildWithOwnEval /></div>',
        {},
        {
          scope: { ChildWithOwnEval },
          eval() {
            // @ts-ignore TS6133 - variable captured by eval()
            const value = parentScope;
            return eval(arguments[0]);
          }
        }
      );

      expect(fixture.container.querySelector('.parent-eval')?.textContent).toContain('Parent Scope');
      expect(fixture.container.querySelector('.child-eval')?.textContent).toBe('Child Scope');
    });

    test('child component without eval does NOT inherit parent eval', () => {
      // @ts-ignore TS6133 - variable captured by eval()
      const parentValue = 'Parent Value';

      // Child has no eval - should NOT see parentValue
      const ChildWithoutEval = template('<span class="child-no-eval">{{unknownVar}}</span>');

      render(
        '<div class="parent-with-eval">{{parentValue}} - <ChildWithoutEval /></div>',
        {},
        {
          scope: { ChildWithoutEval },
          eval() {
            // @ts-ignore TS6133 - variable captured by eval()
            const parentValue = 'Parent Value';
            return eval(arguments[0]);
          }
        }
      );

      expect(fixture.container.querySelector('.parent-with-eval')?.textContent).toContain('Parent Value');
      // Child should NOT have access to parentValue via eval
      expect(fixture.container.querySelector('.child-no-eval')?.textContent).toBe('unknownVar');
    });

    test('eval returning a function calls it with args', () => {
      render('<div class="helper-eval">{{formatName "John" "Doe"}}</div>', {}, {
        eval: (() => {
          // @ts-ignore TS6133 - variable captured by eval()
          const formatName = (first: string, last: string) => `${last}, ${first}`;
          return function() { return eval(arguments[0]); };
        })()
      });

      expect(fixture.container.querySelector('.helper-eval')?.textContent).toBe('Doe, John');
    });

    test('eval returning null is used (not treated as undefined)', () => {
      render('<div class="null-eval">Value: {{nullValue}}</div>', {}, {
        eval: (() => {
          // @ts-ignore TS6133 - variable captured by eval()
          const nullValue = null;
          return function() { return eval(arguments[0]); };
        })()
      });

      expect(fixture.container.querySelector('.null-eval')?.textContent).toBe('Value: ');
    });

    test('eval returning false is used (not treated as undefined)', () => {
      render('<div class="false-eval">Value: {{falseValue}}</div>', {}, {
        eval: (() => {
          // @ts-ignore TS6133 - variable captured by eval()
          const falseValue = false;
          return function() { return eval(arguments[0]); };
        })()
      });

      expect(fixture.container.querySelector('.false-eval')?.textContent).toBe('Value: false');
    });

    test('eval returning 0 is used (not treated as undefined)', () => {
      render('<div class="zero-eval">Count: {{zeroValue}}</div>', {}, {
        eval: (() => {
          // @ts-ignore TS6133 - variable captured by eval()
          const zeroValue = 0;
          return function() { return eval(arguments[0]); };
        })()
      });

      expect(fixture.container.querySelector('.zero-eval')?.textContent).toBe('Count: 0');
    });

    test('eval returning empty string is used (not treated as undefined)', () => {
      render('<div class="empty-eval">Name: [{{emptyValue}}]</div>', {}, {
        eval: (() => {
          // @ts-ignore TS6133 - variable captured by eval()
          const emptyValue = '';
          return function() { return eval(arguments[0]); };
        })()
      });

      expect(fixture.container.querySelector('.empty-eval')?.textContent).toBe('Name: []');
    });

    test('eval returning an object is used', () => {
      render('<div class="object-eval">{{user.name}} ({{user.age}})</div>', {}, {
        eval: (() => {
          // @ts-ignore TS6133 - variable captured by eval()
          const user = { name: 'Alice', age: 30 };
          return function() { return eval(arguments[0]); };
        })()
      });

      expect(fixture.container.querySelector('.object-eval')?.textContent).toBe('Alice (30)');
    });

    test('eval is not called for known bindings in scope', () => {
      let evalCallCount = 0;
      const knownValue = 'from scope';

      render('<div class="known-binding">{{knownValue}}</div>', {}, {
        scope: { knownValue },
        eval() {
          evalCallCount++;
          return eval(arguments[0]);
        }
      });

      expect(fixture.container.querySelector('.known-binding')?.textContent).toBe('from scope');
      // eval should not be called because knownValue is in scope/bindings
      expect(evalCallCount).toBe(0);
    });

    test('eval is called on each access for reactivity', () => {
      let callCount = 0;
      let currentValue = 'initial';

      render('<div class="reactive-eval">{{dynamicValue}}</div>', {}, {
        eval: (() => {
          return function() {
            callCount++;
            // @ts-ignore TS6133 - variable captured by eval()
            const dynamicValue = currentValue;
            return eval(arguments[0]);
          };
        })()
      });

      expect(fixture.container.querySelector('.reactive-eval')?.textContent).toBe('initial');
      // eval should have been called at least once
      expect(callCount).toBeGreaterThanOrEqual(1);
    });

    test('eval with cell value updates reactively', async () => {
      const valueCell = cell('initial');

      render('<div class="cell-eval">{{cellValue}}</div>', {}, {
        eval: (() => {
          // Capture valueCell in closure
          // @ts-ignore TS6133 - variable captured by eval()
          const cellValue = valueCell;
          return function() {
            return eval(arguments[0]);
          };
        })()
      });

      expect(fixture.container.querySelector('.cell-eval')?.textContent).toBe('initial');

      // Update the cell
      valueCell.update('updated');

      // Wait for reactivity
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should reflect the new value
      expect(fixture.container.querySelector('.cell-eval')?.textContent).toBe('updated');
    });

    test('eval value used in {{#if}} condition (static true)', () => {
      render(
        '{{#if showIt}}<div class="if-true">Shown</div>{{else}}<div class="if-false">Hidden</div>{{/if}}',
        {},
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const showIt = true;
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      expect(fixture.container.querySelector('.if-true')?.textContent).toBe('Shown');
      expect(fixture.container.querySelector('.if-false')).toBeNull();
    });

    test('eval value used in {{#if}} condition (static false)', () => {
      render(
        '{{#if showIt}}<div class="if-true">Shown</div>{{else}}<div class="if-false">Hidden</div>{{/if}}',
        {},
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const showIt = false;
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      expect(fixture.container.querySelector('.if-true')).toBeNull();
      expect(fixture.container.querySelector('.if-false')?.textContent).toBe('Hidden');
    });

    test('eval value in {{#if}} updates reactively with cell', async () => {
      const showCell = cell(false);

      render(
        '{{#if showIt}}<div class="reactive-if">Now visible!</div>{{/if}}',
        {},
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const showIt = showCell;
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      // Initially hidden
      expect(fixture.container.querySelector('.reactive-if')).toBeNull();

      // Update cell to true
      showCell.update(true);

      // Wait for reactivity
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should now be visible
      expect(fixture.container.querySelector('.reactive-if')?.textContent).toBe('Now visible!');
    });

    test('eval value used in {{#each}} loop', () => {
      render(
        '<ul>{{#each myItems as |item|}}<li class="eval-item">{{item}}</li>{{/each}}</ul>',
        {},
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const myItems = ['X', 'Y', 'Z'];
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      const items = fixture.container.querySelectorAll('.eval-item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('X');
      expect(items[1].textContent).toBe('Y');
      expect(items[2].textContent).toBe('Z');
    });

    test('eval with nested {{#if}} and {{#each}}', () => {
      render(
        `{{#if showList}}
          <ul>{{#each items as |item|}}<li class="nested-item">{{prefix}}: {{item}}</li>{{/each}}</ul>
        {{/if}}`,
        {},
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const showList = true;
            // @ts-ignore TS6133 - variable captured by eval()
            const items = ['A', 'B'];
            // @ts-ignore TS6133 - variable captured by eval()
            const prefix = 'Item';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      const items = fixture.container.querySelectorAll('.nested-item');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe('Item: A');
      expect(items[1].textContent).toBe('Item: B');
    });

    test('eval works for unknown inside initially-false if block (deferred render)', async () => {
      // This tests the case where:
      // 1. {{#if @show}} is initially false
      // 2. {{message}} inside uses eval
      // 3. Later @show becomes true and the block renders
      // The eval should still work when the block renders later
      const showCell = cell(false);

      render(
        '{{#if @show}}<div class="deferred-content">{{message}}</div>{{/if}}',
        { show: () => showCell.value },
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const message = 'Deferred eval message!';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      // Initially hidden
      expect(fixture.container.querySelector('.deferred-content')).toBeNull();

      // Toggle to true
      showCell.update(true);

      // Wait for reactivity
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should now show with eval-resolved message
      const content = fixture.container.querySelector('.deferred-content');
      expect(content).not.toBeNull();
      expect(content?.textContent).toBe('Deferred eval message!');
    });

    test('eval works for unknown inside initially-empty each block (deferred render)', async () => {
      // This tests the case where:
      // 1. {{#each @items}} is initially empty
      // 2. {{prefix}} inside uses eval
      // 3. Later items are added and the block renders
      // The eval should still work when items are added later
      const itemsCell = cell<string[]>([]);

      render(
        '<ul>{{#each @items as |item|}}<li class="deferred-item">{{prefix}}: {{item}}</li>{{/each}}</ul>',
        { items: () => itemsCell.value },
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const prefix = 'Added';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      // Initially empty
      expect(fixture.container.querySelectorAll('.deferred-item').length).toBe(0);

      // Add items
      itemsCell.update(['First', 'Second']);

      // Wait for reactivity
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should now show with eval-resolved prefix
      const items = fixture.container.querySelectorAll('.deferred-item');
      expect(items.length).toBe(2);
      expect(items[0].textContent).toBe('Added: First');
      expect(items[1].textContent).toBe('Added: Second');
    });

    test('eval works when items are appended to existing each block', async () => {
      // This tests appending to an existing list
      const itemsCell = cell<string[]>(['Initial']);

      render(
        '<ul>{{#each @items as |item|}}<li class="append-item">{{label}}: {{item}}</li>{{/each}}</ul>',
        { items: () => itemsCell.value },
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const label = 'Item';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      // Initial item rendered
      let items = fixture.container.querySelectorAll('.append-item');
      expect(items.length).toBe(1);
      expect(items[0].textContent).toBe('Item: Initial');

      // Append more items
      itemsCell.update(['Initial', 'Appended1', 'Appended2']);

      // Wait for reactivity
      await new Promise(resolve => setTimeout(resolve, 50));

      // All items should have eval-resolved label
      items = fixture.container.querySelectorAll('.append-item');
      expect(items.length).toBe(3);
      expect(items[0].textContent).toBe('Item: Initial');
      expect(items[1].textContent).toBe('Item: Appended1');
      expect(items[2].textContent).toBe('Item: Appended2');
    });

    test('eval works in deeply nested control flow (if inside each inside if)', async () => {
      // Tests that $_eval propagates through multiple levels of control flow
      const showOuterCell = cell(false);
      const itemsCell = cell<Array<{ name: string; active: boolean }>>([]);

      render(
        `{{#if @showOuter}}
          <div class="outer">
            {{#each @items as |item|}}
              {{#if item.active}}
                <span class="nested-item">{{prefix}}: {{item.name}}</span>
              {{/if}}
            {{/each}}
          </div>
        {{/if}}`,
        {
          showOuter: () => showOuterCell.value,
          items: () => itemsCell.value
        },
        {
          eval: (() => {
            // @ts-ignore TS6133 - variable captured by eval()
            const prefix = 'Active';
            return function() { return eval(arguments[0]); };
          })()
        }
      );

      // Initially nothing rendered
      expect(fixture.container.querySelector('.outer')).toBeNull();
      expect(fixture.container.querySelectorAll('.nested-item').length).toBe(0);

      // Show outer if block
      showOuterCell.update(true);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Outer visible but no items yet
      expect(fixture.container.querySelector('.outer')).not.toBeNull();
      expect(fixture.container.querySelectorAll('.nested-item').length).toBe(0);

      // Add items (some active, some not)
      itemsCell.update([
        { name: 'First', active: true },
        { name: 'Second', active: false },
        { name: 'Third', active: true }
      ]);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Only active items should show with eval-resolved prefix
      const nestedItems = fixture.container.querySelectorAll('.nested-item');
      expect(nestedItems.length).toBe(2);
      expect(nestedItems[0].textContent).toBe('Active: First');
      expect(nestedItems[1].textContent).toBe('Active: Third');
    });

    test('unknown binding without eval returns the binding name as-is', () => {
      // When WITH_EVAL_SUPPORT is false (no eval option), unknown bindings
      // should just return the binding name as the value
      const NoEvalTemplate = template('<span class="no-eval-binding">{{unknownBinding}}</span>');
      render(NoEvalTemplate, {});

      // unknownBinding should render as-is since there's no eval to resolve it
      expect(fixture.container.querySelector('.no-eval-binding')?.textContent).toBe('unknownBinding');
    });

    test('unknown helper with named args works without eval', () => {
      // Tests that $_maybeHelper handles named args correctly when no eval is provided
      // The helper name should be returned as-is
      const NoEvalHelperTemplate = template('<span class="no-eval-helper">{{unknownHelper name="test"}}</span>');
      render(NoEvalHelperTemplate, {});

      // Should not crash and return the helper name
      expect(fixture.container.querySelector('.no-eval-helper')?.textContent).toBe('unknownHelper');
    });

    test('multiple unknown bindings work without eval', () => {
      // Tests multiple unknown bindings in the same template without eval
      const MultipleUnknown = template('<div class="multi-unknown">{{first}} - {{second}} - {{third}}</div>');
      render(MultipleUnknown, {});

      expect(fixture.container.querySelector('.multi-unknown')?.textContent).toBe('first - second - third');
    });

    test('eval returning undefined renders differently from no eval', () => {
      // When eval is provided but variable is undefined -> renders empty
      render('<span class="eval-undef">{{missingVar}}</span>', {}, {
        eval: (() => {
          return function() { return eval(arguments[0]); };
        })()
      });
      expect(fixture.container.querySelector('.eval-undef')?.textContent).toBe('');

      fixture.container.innerHTML = '';

      // When no eval is provided -> renders binding name as-is
      const NoEvalTpl = template('<span class="no-eval">{{missingVar}}</span>');
      render(NoEvalTpl, {});
      expect(fixture.container.querySelector('.no-eval')?.textContent).toBe('missingVar');
    });
  });

  describe('Cross-Component Visibility', () => {
    test('template-only component renders another template-only component', () => {
      // Inner template-only component
      const Badge = template('<span class="badge">{{@label}}</span>');

      // Outer template-only component that uses Badge
      const Card = template(
        '<div class="card"><Badge @label={{@title}} /></div>',
        { scope: { Badge } }
      );

      render(Card, { title: 'Hello Badge' });

      const card = fixture.container.querySelector('.card');
      expect(card).not.toBeNull();

      const badge = fixture.container.querySelector('.badge');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toBe('Hello Badge');
    });

    test('template-only component renders a class-based component', () => {
      // Class-based component
      class Button extends Component {
        [$template] = template('<button class="btn">{{@text}}</button>');
      }

      // Template-only component that uses the class-based Button
      const ButtonWrapper = template(
        '<div class="wrapper"><Button @text={{@label}} /></div>',
        { scope: { Button } }
      );

      render(ButtonWrapper, { label: 'Click Me' });

      const wrapper = fixture.container.querySelector('.wrapper');
      expect(wrapper).not.toBeNull();

      const button = fixture.container.querySelector('.btn');
      expect(button).not.toBeNull();
      expect(button?.textContent).toBe('Click Me');
    });

    test('class-based component renders a template-only component', () => {
      // Template-only component
      const Icon = template('<i class="icon">{{@name}}</i>');

      // Class-based component that uses the template-only Icon
      class IconButton extends Component {
        [$template] = template(
          '<button class="icon-btn"><Icon @name={{this.iconName}} /> {{this.label}}</button>',
          { scope: { Icon } }
        );
        iconName = 'star';
        label = 'Favorite';
      }

      render(IconButton);

      const button = fixture.container.querySelector('.icon-btn');
      expect(button).not.toBeNull();

      const icon = fixture.container.querySelector('.icon');
      expect(icon).not.toBeNull();
      expect(icon?.textContent).toBe('star');
      expect(button?.textContent).toContain('Favorite');
    });

    test('three-level nesting: template-only -> template-only -> class-based', () => {
      // Level 3: Class-based component
      class Text extends Component {
        [$template] = template('<span class="text">{{@content}}</span>');
      }

      // Level 2: Template-only that uses class-based
      const Label = template(
        '<label class="label"><Text @content={{@text}} /></label>',
        { scope: { Text } }
      );

      // Level 1: Template-only that uses template-only
      const FormField = template(
        '<div class="field"><Label @text={{@label}} /></div>',
        { scope: { Label } }
      );

      render(FormField, { label: 'Username' });

      expect(fixture.container.querySelector('.field')).not.toBeNull();
      expect(fixture.container.querySelector('.label')).not.toBeNull();
      expect(fixture.container.querySelector('.text')?.textContent).toBe('Username');
    });

    test('three-level nesting: class-based -> template-only -> template-only', () => {
      // Level 3: Template-only component
      const Dot = template('<span class="dot">•</span>');

      // Level 2: Template-only that uses template-only
      const ListItem = template(
        '<li class="item"><Dot /> {{@text}}</li>',
        { scope: { Dot } }
      );

      // Level 1: Class-based that uses template-only
      class BulletList extends Component {
        items = ['First', 'Second', 'Third'];
        [$template] = template(
          `<ul class="list">
            {{#each this.items as |item|}}
              <ListItem @text={{item}} />
            {{/each}}
          </ul>`,
          { scope: { ListItem } }
        );
      }

      render(BulletList);

      const list = fixture.container.querySelector('.list');
      expect(list).not.toBeNull();

      const items = fixture.container.querySelectorAll('.item');
      expect(items.length).toBe(3);

      const dots = fixture.container.querySelectorAll('.dot');
      expect(dots.length).toBe(3);

      expect(items[0].textContent).toContain('First');
      expect(items[1].textContent).toContain('Second');
      expect(items[2].textContent).toContain('Third');
    });

    test('template-only with multiple child components of different types', () => {
      // Template-only child
      const Header = template('<header class="header">{{@title}}</header>');

      // Class-based child
      class Footer extends Component {
        [$template] = template('<footer class="footer">{{@copyright}}</footer>');
      }

      // Template-only parent using both
      const Page = template(
        `<div class="page">
          <Header @title={{@pageTitle}} />
          <main class="content">{{@body}}</main>
          <Footer @copyright={{@year}} />
        </div>`,
        { scope: { Header, Footer } }
      );

      render(Page, {
        pageTitle: 'My Page',
        body: 'Content here',
        year: '2024',
      });

      expect(fixture.container.querySelector('.header')?.textContent).toBe('My Page');
      expect(fixture.container.querySelector('.content')?.textContent).toBe('Content here');
      expect(fixture.container.querySelector('.footer')?.textContent).toBe('2024');
    });

    test('class-based with multiple template-only children', () => {
      const Avatar = template('<img class="avatar" alt="{{@name}}" />');
      const Name = template('<span class="name">{{@text}}</span>');
      const Status = template(
        `{{#if @online}}
          <span class="status online">Online</span>
        {{else}}
          <span class="status offline">Offline</span>
        {{/if}}`
      );

      class UserProfile extends Component {
        user = { name: 'Alice', online: true };
        [$template] = template(
          `<div class="profile">
            <Avatar @name={{this.user.name}} />
            <Name @text={{this.user.name}} />
            <Status @online={{this.user.online}} />
          </div>`,
          { scope: { Avatar, Name, Status } }
        );
      }

      render(UserProfile);

      expect(fixture.container.querySelector('.avatar')?.getAttribute('alt')).toBe('Alice');
      expect(fixture.container.querySelector('.name')?.textContent).toBe('Alice');
      expect(fixture.container.querySelector('.status.online')?.textContent).toBe('Online');
    });

    test('template-only passing @args down multiple levels', () => {
      const InnerMost = template('<span class="inner">{{@value}}</span>');

      const Middle = template(
        '<div class="middle"><InnerMost @value={{@data}} /></div>',
        { scope: { InnerMost } }
      );

      const Outer = template(
        '<div class="outer"><Middle @data={{@input}} /></div>',
        { scope: { Middle } }
      );

      render(Outer, { input: 'Passed Through' });

      expect(fixture.container.querySelector('.outer')).not.toBeNull();
      expect(fixture.container.querySelector('.middle')).not.toBeNull();
      expect(fixture.container.querySelector('.inner')?.textContent).toBe('Passed Through');
    });

    test('mixed nesting with conditional rendering', () => {
      const SuccessMessage = template('<div class="success">{{@message}}</div>');
      const ErrorMessage = template('<div class="error">{{@message}}</div>');

      class StatusDisplay extends Component {
        [$template] = template(
          `{{#if @isSuccess}}
            <SuccessMessage @message={{@text}} />
          {{else}}
            <ErrorMessage @message={{@text}} />
          {{/if}}`,
          { scope: { SuccessMessage, ErrorMessage } }
        );
      }

      const StatusWrapper = template(
        '<div class="status-wrapper"><StatusDisplay @isSuccess={{@success}} @text={{@msg}} /></div>',
        { scope: { StatusDisplay } }
      );

      // Test success case
      render(StatusWrapper, { success: true, msg: 'All good!' });
      expect(fixture.container.querySelector('.success')?.textContent).toBe('All good!');
      expect(fixture.container.querySelector('.error')).toBeNull();
    });

    test('mixed nesting with each loop', () => {
      const Tag = template('<span class="tag">{{@name}}</span>');

      class TagList extends Component {
        [$template] = template(
          `<div class="tag-list">
            {{#each @tags as |tag|}}
              <Tag @name={{tag}} />
            {{/each}}
          </div>`,
          { scope: { Tag } }
        );
      }

      const Article = template(
        `<article class="article">
          <h1>{{@title}}</h1>
          <TagList @tags={{@labels}} />
        </article>`,
        { scope: { TagList } }
      );

      render(Article, {
        title: 'My Article',
        labels: ['tech', 'news', 'featured'],
      });

      expect(fixture.container.querySelector('h1')?.textContent).toBe('My Article');
      const tags = fixture.container.querySelectorAll('.tag');
      expect(tags.length).toBe(3);
      expect(tags[0].textContent).toBe('tech');
      expect(tags[1].textContent).toBe('news');
      expect(tags[2].textContent).toBe('featured');
    });
  });
});
