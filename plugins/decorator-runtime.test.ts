/**
 * Decorators lowered by the template-tag transform import decorator-transforms'
 * runtime in Ember mode.
 *
 * `transform()` (plugins/test.ts) lowers decorators (`@tracked`, `@action`,
 * `@service`, …) with decorator-transforms. Its default `runtime: "globals"`
 * makes every decorator call `dt7948.<fn>(…)` on a global that nothing in an
 * Ember app installs, so a consumer's decorated `.gjs` / `.gts` died with
 * "dt7948 is not defined". An Ember app's own babel pass (Embroider / Vite)
 * configures decorator-transforms with `runtime: { import:
 * 'decorator-transforms/runtime' }`, so each module imports the runtime it
 * calls. Under WITH_EMBER_INTEGRATION the gxt pass now does the same.
 * Standalone gxt keeps the globals runtime (its pages import
 * `decorator-transforms/globals`); a `decoratorRuntime` option overrides either
 * default.
 */
import { describe, test, expect } from 'vitest';
import { transform, type TransformResult } from './test';
import { compiler } from './compiler';
import { defaultFlags, type Flags } from './flags';

const GTS_SOURCE = `import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

export default class Counter extends Component {
  @tracked count: number = 0;
  @action increment() { this.count++; }
  <template><button>{{this.count}}</button></template>
}
`;

const emberFlags = (): Flags => ({
  ...defaultFlags(),
  ASYNC_COMPILE_TRANSFORMS: false,
  WITH_EMBER_INTEGRATION: true,
  WITH_HELPER_MANAGER: true,
  WITH_MODIFIER_MANAGER: true,
});

const standaloneFlags = (): Flags => ({ ...defaultFlags(), ASYNC_COMPILE_TRANSFORMS: false });

async function compile(
  flags: Flags,
  options: Parameters<typeof transform>[6] = {},
): Promise<string> {
  const result = (await transform(
    GTS_SOURCE,
    '/app/components/counter.gts',
    'production',
    false,
    flags,
    undefined,
    options,
  )) as TransformResult;
  return result.code;
}

const RUNTIME_IMPORT = /import \* as dt7948 from "decorator-transforms\/runtime";/;

describe('decorator runtime of the template-tag transform', () => {
  test('Ember mode: decorators import decorator-transforms/runtime, no dt7948 global', async () => {
    const code = await compile(emberFlags());
    expect(code).toMatch(RUNTIME_IMPORT);
    // the calls read the module-scoped namespace, not a global
    expect(code).toContain('dt7948.g(');
    // the field decorator and its deferred initializer, and the method decorator
    expect(code).not.toMatch(/^\s*@tracked/m);
    expect(code).not.toMatch(/^\s*@action/m);
  });

  test('Ember mode, async transform: the same runtime import', async () => {
    const code = await compile({ ...emberFlags(), ASYNC_COMPILE_TRANSFORMS: true });
    expect(code).toMatch(RUNTIME_IMPORT);
  });

  test('standalone gxt keeps the globals runtime (output unchanged)', async () => {
    const code = await compile(standaloneFlags());
    expect(code).toContain('dt7948.');
    expect(code).not.toContain('decorator-transforms/runtime');
  });

  test('decoratorRuntime overrides the default in either mode', async () => {
    const globals = await compile(emberFlags(), { decoratorRuntime: 'globals' });
    expect(globals).toContain('dt7948.');
    expect(globals).not.toContain('decorator-transforms/runtime');

    const custom = await compile(standaloneFlags(), {
      decoratorRuntime: { import: 'my-app/decorator-runtime' },
    });
    expect(custom).toContain('import * as dt7948 from "my-app/decorator-runtime";');
  });

  test('the Vite plugin forwards its decoratorRuntime option and Ember flags', async () => {
    const run = async (options: Parameters<typeof compiler>[1]) => {
      const plugin = compiler('production', options);
      (plugin.config as Function).call({}, {}, { mode: 'production', command: 'build' });
      const result = await (plugin.transform as Function).call(
        {},
        GTS_SOURCE,
        '/app/components/counter.gts',
      );
      return result.code as string;
    };
    const ember = await run({ flags: { WITH_EMBER_INTEGRATION: true } });
    expect(ember).toMatch(RUNTIME_IMPORT);

    const forced = await run({ flags: { WITH_EMBER_INTEGRATION: true }, decoratorRuntime: 'globals' });
    expect(forced).toContain('dt7948.');

    const standalone = await run({});
    expect(standalone).toContain('dt7948.');
  });

  test('the runtime adds no binding a template could resolve (`<i>` stays an element)', async () => {
    // A named import (`import { g, i } from …`) would put `i` in the module
    // scope the template's lexical scope is read from, turning `<i>` into a
    // component invocation of the decorator runtime function.
    const source = `import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
export default class Counter extends Component {
  @tracked count = 0;
  <template><i>{{this.count}}</i><g>{{this.count}}</g></template>
}
`;
    const result = (await transform(source, '/app/c.gjs', 'production', false, emberFlags())) as TransformResult;
    expect(result.code).toContain("$_tag('i'");
    expect(result.code).toContain("$_tag('g'");
    expect(result.code).not.toMatch(/\$_c\(\s*[gi]\b/);
    expect(result.code).toMatch(RUNTIME_IMPORT);
  });

  test('a module that declares dt7948 itself gets no second binding', async () => {
    const source = `import * as dt7948 from 'decorator-transforms/runtime';
import { tracked } from '@glimmer/tracking';
export default class Counter { @tracked count = 0; <template>{{this.count}}</template> }
`;
    const result = (await transform(source, '/app/c.gjs', 'production', false, emberFlags())) as TransformResult;
    expect(result.code.match(/as dt7948/g)).toHaveLength(1);
  });
});
