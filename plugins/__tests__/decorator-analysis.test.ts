import { describe, test, expect } from 'vitest';
import { transformSync, type PluginItem } from '@babel/core';
import { Preprocessor } from 'content-tag';
import { transform } from '../test';
import { processTemplate, type ResolvedHBS } from '../babel';
import { defaultFlags, type Flags } from '../flags';

function transformGts(source: string, flags: Partial<Flags> = {}): string {
  const result = transform(
    source,
    'test.gts',
    'development',
    false,
    { ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false, ...flags },
  );
  if (result instanceof Promise) {
    throw new Error('Expected sync transform');
  }
  return result.code;
}

function collectResolvedHbs(source: string): ResolvedHBS[] {
  const p = new Preprocessor();
  const intermediate = p.process(source, { filename: 'test.gts' }).code;
  const hbsToProcess: ResolvedHBS[] = [];
  const plugins: PluginItem[] = [processTemplate(hbsToProcess, 'development'), 'module:decorator-transforms'];
  transformSync(intermediate, {
    plugins,
    filename: 'test.ts',
    presets: [
      [
        '@babel/preset-typescript',
        { allExtensions: true, onlyRemoveTypeImports: true, allowDeclareFields: true },
      ],
    ],
  });
  return hbsToProcess;
}

describe('Babel decorator extraction', () => {
  test('@tracked property keeps getter wrapper (reactive)', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export default class MyComponent {
        @tracked count = 0;
        <template>{{this.count}}</template>
      }
    `);
    // tracked prop should have getter wrapper (reactive)
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('aliased tracked decorator keeps getter wrapper (reactive)', () => {
    const code = transformGts(`
      import { tracked as state } from '@glimmer/tracking';
      export default class MyComponent {
        @state count = 0;
        <template>{{this.count}}</template>
      }
    `);
    // tracked alias should still be detected as reactive
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('namespace tracked decorator keeps getter wrapper (reactive)', () => {
    const code = transformGts(`
      import * as Tracking from '@glimmer/tracking';
      export default class MyComponent {
        @Tracking.tracked count = 0;
        <template>{{this.count}}</template>
      }
    `);
    // namespace import should still resolve to tracked decorator
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('undecorated property skips getter wrapper (static)', () => {
    const code = transformGts(`
      export default class MyComponent {
        title = "Hi";
        <template>{{this.title}}</template>
      }
    `);
    // plain property without @tracked is static — no getter wrapper needed
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    // But the reference should still exist
    expect(code).toContain('this.title');
  });

  test('comment containing @tracked is ignored by Babel AST', () => {
    const code = transformGts(`
      export default class MyComponent {
        // @tracked title
        title = "Hi";
        <template>{{this.title}}</template>
      }
    `);
    // Comment decorator is ignored by Babel AST — title is undecorated = static
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
  });

  test('mixed tracked and undecorated in one class', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export default class MyComponent {
        @tracked count = 0;
        title = "Hi";
        <template>{{this.count}} {{this.title}}</template>
      }
    `);
    // count is @tracked → reactive → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
    // title is undecorated → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
  });

  test('class without template does not cause errors', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export class PlainClass {
        @tracked value = 42;
      }
    `);
    // Should compile without errors
    expect(code).toBeDefined();
    expect(code.length).toBeGreaterThan(0);
  });

  test('property with unknown decorator is treated as static (no @tracked)', () => {
    const code = transformGts(`
      function customDecorator(target: any, key: string) {}
      export default class MyComponent {
        @customDecorator label = "test";
        <template>{{this.label}}</template>
      }
    `);
    // customDecorator is not @tracked, so the property is non-reactive
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.label/);
    expect(code).toContain('this.label');
  });

  test('property initialized with cell() keeps getter wrapper (reactive)', () => {
    const code = transformGts(`
      import { cell } from '@lifeart/gxt';
      export default class MyComponent {
        count = cell(0);
        <template>{{this.count}}</template>
      }
    `);
    // cell() is reactive — must keep getter wrapper
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('property initialized with formula() keeps getter wrapper (reactive)', () => {
    const code = transformGts(`
      import { formula } from '@lifeart/gxt';
      export default class MyComponent {
        fullName = formula(() => "John");
        <template>{{this.fullName}}</template>
      }
    `);
    // formula() is reactive — must keep getter wrapper
    expect(code).toMatch(/\(\)\s*=>\s*this\.fullName/);
  });

  test('mixed: tracked, cell, formula, and plain properties', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      import { cell, formula } from '@lifeart/gxt';
      export default class MyComponent {
        @tracked count = 0;
        state = cell(false);
        derived = formula(() => "x");
        title = "Hello";
        <template>{{this.count}} {{this.state}} {{this.derived}} {{this.title}}</template>
      }
    `);
    // count: @tracked → reactive
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
    // state: cell() → reactive
    expect(code).toMatch(/\(\)\s*=>\s*this\.state/);
    // derived: formula() → reactive
    expect(code).toMatch(/\(\)\s*=>\s*this\.derived/);
    // title: plain string → static, no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
  });

  test('arrow function property keeps getter wrapper (function kind)', () => {
    const code = transformGts(`
      export default class MyComponent {
        onClick = () => { console.log('click'); };
        <template>{{this.onClick}}</template>
      }
    `);
    // Arrow function → kind: 'function' → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.onClick/);
  });

  test('object literal property keeps getter wrapper (object kind)', () => {
    const code = transformGts(`
      export default class MyComponent {
        actions = { run: () => {} };
        <template>{{this.actions}}</template>
      }
    `);
    // Object literal → kind: 'object' → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.actions/);
  });

  test('property without initializer keeps getter wrapper (unknown)', () => {
    const code = transformGts(`
      export default class MyComponent {
        rootNode!: HTMLElement;
        <template>{{this.rootNode}}</template>
      }
    `);
    // No initializer → no hint → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.rootNode/);
  });

  test('extracts args hints from glint signature alias', () => {
    const hbs = collectResolvedHbs(`
      type Sig = {
        Args: {
          label: string;
          count: number;
          onClick: () => void;
        };
      };
      export default class MyComponent extends Component<Sig> {
        <template>{{@label}} {{@count}} {{@onClick}}</template>
      }
    `);
    expect(hbs).toHaveLength(1);
    expect(hbs[0].typeHints?.args?.label).toEqual({ kind: 'primitive' });
    expect(hbs[0].typeHints?.args?.count).toEqual({ kind: 'primitive' });
    expect(hbs[0].typeHints?.args?.onClick).toEqual({ kind: 'function' });
  });

  test('extracts args hints from inline glint signature', () => {
    const hbs = collectResolvedHbs(`
      import type { Cell } from '@lifeart/gxt';
      export default class MyComponent extends Component<{
        Args: {
          ready: boolean;
          user: { name: string };
          state: Cell<number>;
        };
      }> {
        <template>{{@ready}} {{@user}} {{@state}}</template>
      }
    `);
    expect(hbs).toHaveLength(1);
    expect(hbs[0].typeHints?.args?.ready).toEqual({ kind: 'primitive' });
    expect(hbs[0].typeHints?.args?.user).toEqual({ kind: 'object' });
    expect(hbs[0].typeHints?.args?.state).toEqual({ kind: 'cell' });
  });

  test('numeric literal property skips getter wrapper', () => {
    const code = transformGts(`
      export default class MyComponent {
        size = 42;
        <template>{{this.size}}</template>
      }
    `);
    // Numeric literal → primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.size/);
    expect(code).toContain('this.size');
  });

  test('boolean literal property skips getter wrapper', () => {
    const code = transformGts(`
      export default class MyComponent {
        visible = true;
        <template>{{this.visible}}</template>
      }
    `);
    // Boolean literal → primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.visible/);
    expect(code).toContain('this.visible');
  });

  test('property initialized from function call can skip getter with checker inference', () => {
    const code = transformGts(`
      function compute() { return 42; }
      export default class MyComponent {
        value = compute();
        <template>{{this.value}}</template>
      }
    `, { WITH_TYPE_CHECKER_HINTS: true });
    // Type-checker infers number result, so this can be emitted as static.
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.value/);
    expect(code).toContain('this.value');
  });

  test('type-checker hints are opt-in via WITH_TYPE_CHECKER_HINTS', () => {
    const source = `
      function compute() { return 42; }
      export default class MyComponent {
        value = compute();
        <template>{{this.value}}</template>
      }
    `;
    const withoutChecker = transformGts(source);
    const withChecker = transformGts(source, { WITH_TYPE_CHECKER_HINTS: true });

    // Default path remains conservative.
    expect(withoutChecker).toMatch(/\(\)\s*=>\s*this\.value/);
    // Opt-in checker inference allows static emission.
    expect(withChecker).not.toMatch(/\(\)\s*=>\s*this\.value/);
  });

  test('property initialized from identifier can skip getter with checker inference', () => {
    const code = transformGts(`
      const DEFAULT = "hello";
      export default class MyComponent {
        value = DEFAULT;
        <template>{{this.value}}</template>
      }
    `, { WITH_TYPE_CHECKER_HINTS: true });
    // Type-checker resolves constant string type.
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.value/);
    expect(code).toContain('this.value');
  });

  test('checker literal value in readonly property is inlined', () => {
    const code = transformGts(`
      export default class MyComponent {
        readonly VERSION = "1.2.3";
        <template>{{this.VERSION}}</template>
      }
    `, { WITH_TYPE_CHECKER_HINTS: true });
    expect(code).toContain('"1.2.3"');
    expect(code).not.toContain('this.VERSION');
  });

  test('hints do not leak from a template-less class to the next class', () => {
    const code = transformGts(`
      class Config {
        status = "idle";
      }
      export default class MyComponent {
        <template>{{this.status}}</template>
      }
    `);
    // MyComponent has no 'status' property -- stale hint from Config must not apply
    // Without a hint, this.status is unknown -> keeps getter wrapper
    expect(code).toMatch(/\(\)\s*=>\s*this\.status/);
  });

  test('each class gets independent hints (no cross-class pollution)', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      class First {
        label = "static";
      }
      export default class Second {
        @tracked label = "";
        <template>{{this.label}}</template>
      }
    `);
    // Second's @tracked label should be reactive, not affected by First's static hint
    expect(code).toMatch(/\(\)\s*=>\s*this\.label/);
  });

  test('@tracked with array initializer keeps getter wrapper', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export default class MyComponent {
        @tracked items = [];
        <template>{{this.items}}</template>
      }
    `);
    // @tracked takes precedence — reactive regardless of initializer type
    expect(code).toMatch(/\(\)\s*=>\s*this\.items/);
  });

  test('@tracked with object initializer keeps getter wrapper', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export default class MyComponent {
        @tracked config = { debug: false };
        <template>{{this.config}}</template>
      }
    `);
    expect(code).toMatch(/\(\)\s*=>\s*this\.config/);
  });

  test('@tracked with arrow function initializer keeps getter wrapper', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export default class MyComponent {
        @tracked handler = () => {};
        <template>{{this.handler}}</template>
      }
    `);
    expect(code).toMatch(/\(\)\s*=>\s*this\.handler/);
  });

  test('@tracked with new expression initializer keeps getter wrapper', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      export default class MyComponent {
        @tracked data = new Map();
        <template>{{this.data}}</template>
      }
    `);
    expect(code).toMatch(/\(\)\s*=>\s*this\.data/);
  });

  test('null literal property skips getter wrapper', () => {
    const code = transformGts(`
      export default class MyComponent {
        selected = null;
        <template>{{this.selected}}</template>
      }
    `);
    // null literal → primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.selected/);
    expect(code).toContain('this.selected');
  });

  test('template literal without expressions skips getter wrapper', () => {
    const code = transformGts(`
      export default class MyComponent {
        greeting = ${'`'}hello world${'`'};
        <template>{{this.greeting}}</template>
      }
    `);
    // Template literal with no expressions → primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.greeting/);
    expect(code).toContain('this.greeting');
  });

  test('array literal property keeps getter wrapper (object kind)', () => {
    const code = transformGts(`
      export default class MyComponent {
        items = [1, 2, 3];
        <template>{{this.items}}</template>
      }
    `);
    // Array literal → kind: 'object' → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.items/);
  });

  test('new expression property keeps getter wrapper (unknown)', () => {
    const code = transformGts(`
      export default class MyComponent {
        map = new Map();
        <template>{{this.map}}</template>
      }
    `);
    // new expression → no hint → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.map/);
  });

  test('three classes: only the template-owning class hints apply', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      class A {
        x = "static";
        y = "static";
      }
      class B {
        @tracked z = 0;
      }
      export default class C {
        @tracked x = "";
        y = "hello";
        <template>{{this.x}} {{this.y}} {{this.z}}</template>
      }
    `);
    // x: C declares @tracked x → reactive → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.x/);
    // y: C declares y = "hello" → static → skips getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.y/);
    // z: C does not declare z → no hint → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.z/);
  });

  test('static class property does not pollute instance hints', () => {
    const code = transformGts(`
      export default class MyComponent {
        static defaultTitle = "Hello";
        <template>{{this.defaultTitle}}</template>
      }
    `);
    // static property should not create a hint for the instance
    // this.defaultTitle on the instance is unknown → keeps getter wrapper
    expect(code).toMatch(/\(\)\s*=>\s*this\.defaultTitle/);
  });

  test('static and instance property with same name: instance wins', () => {
    const code = transformGts(`
      export default class MyComponent {
        static title = "Static";
        title = "Instance";
        <template>{{this.title}}</template>
      }
    `);
    // Instance property title = "Instance" is a primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    expect(code).toContain('this.title');
  });

  test('private property (#foo) does not interfere with hints', () => {
    const code = transformGts(`
      export default class MyComponent {
        #secret = 42;
        visible = "hi";
        <template>{{this.visible}}</template>
      }
    `);
    // #secret is silently ignored (PrivateName key, not Identifier)
    // visible = "hi" is primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.visible/);
    expect(code).toContain('this.visible');
  });

  test('class getter does not produce a hint', () => {
    const code = transformGts(`
      export default class MyComponent {
        get computed() { return 42; }
        title = "hi";
        <template>{{this.computed}} {{this.title}}</template>
      }
    `);
    // get computed() is a ClassMethod, not ClassProperty → no hint → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.computed/);
    // title = "hi" is primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
  });

  test('property with multiple decorators including @tracked is reactive', () => {
    const code = transformGts(`
      import { tracked } from '@glimmer/tracking';
      function log(target: any, key: string) {}
      export default class MyComponent {
        @tracked @log count = 0;
        <template>{{this.count}}</template>
      }
    `);
    // @tracked is found via .some() among multiple decorators → reactive
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('renamed cell import falls back to unknown (keeps getter)', () => {
    const code = transformGts(`
      import { cell as c } from '@lifeart/gxt';
      export default class MyComponent {
        count = c(0);
        <template>{{this.count}}</template>
      }
    `);
    // c(0) is a CallExpression with callee name "c", not "cell"
    // Falls through to no hint → unknown → keeps getter (conservative)
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('property initialized with undefined skips getter wrapper', () => {
    const code = transformGts(`
      export default class MyComponent {
        value = undefined;
        <template>{{this.value}}</template>
      }
    `);
    // undefined initializer is a static primitive, so getter wrapper can be skipped.
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.value/);
    expect(code).toContain('this.value');
  });

  test('template literal with expressions can skip getter with checker inference', () => {
    const code = transformGts(`
      export default class MyComponent {
        name = "world";
        greeting = ${'`'}hello ${'$'}{this.name}${'`'};
        <template>{{this.greeting}}</template>
      }
    `, { WITH_TYPE_CHECKER_HINTS: true });
    // Type-checker infers string for greeting.
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.greeting/);
    expect(code).toContain('this.greeting');
  });

  test('binary expression initializer can skip getter with checker inference', () => {
    const code = transformGts(`
      export default class MyComponent {
        sum = 1 + 2;
        <template>{{this.sum}}</template>
      }
    `, { WITH_TYPE_CHECKER_HINTS: true });
    // Type-checker infers number for binary expression.
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.sum/);
    expect(code).toContain('this.sum');
  });

  test('conditional expression initializer can skip getter with checker inference', () => {
    const code = transformGts(`
      export default class MyComponent {
        value = true ? "a" : "b";
        <template>{{this.value}}</template>
      }
    `, { WITH_TYPE_CHECKER_HINTS: true });
    // Type-checker infers primitive string union.
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.value/);
    expect(code).toContain('this.value');
  });
});
