/**
 * Glimmer compat mode: a curly component block (`{{#x-twice as |s|}}…`) keeps
 * its block params wherever it is in the template.
 *
 * The block lowering registered the PascalCase name as a scope binding in the
 * CURRENT scope, and codegen (which routes a tag to `$_c` by its bindings) runs
 * when only the root scope's bindings are left: a top-level curly block became
 * `$_c('XTwice', …)` with its block as a slot, but one inside an element or a
 * block became a `$_tag('XTwice', …)` element — its block params dropped, their
 * reads compiled as `this.s`. The binding also made every `<XTwice>` element of
 * a template with a top-level curly block a component. The block's node is now
 * marked (`compatComponent`) instead.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { COMPAT_FLAGS, compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import type { CompatTemplate } from './__test-utils__/ember-compat';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { $_MANAGERS } from './manager-integration';
import { $template, COMPONENT_ID_PROPERTY } from './shared';
import { cId } from './tree';
import { cell } from './reactive';
import { syncDom } from './runtime';

function code(tpl: string, flags: Record<string, boolean> = COMPAT_FLAGS) {
  const result = compileTemplateSource(tpl, { flags });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

const BLOCK = '{{#x-twice as |s n|}}[{{s}}-{{n}}]{{/x-twice}}';
const SLOT = "$_c('XTwice', /*#__PURE__*/$_args({}, { default_: true, default: (ctx";

describe('compat curly component block: compiler', () => {
  for (const [label, tpl] of [
    ['at the top level', BLOCK],
    ['inside an element', `<div>${BLOCK}</div>`],
    ['inside an {{#if}}', `{{#if this.a}}${BLOCK}{{/if}}`],
    ['inside an {{#each}}', `{{#each this.list as |item|}}${BLOCK}{{/each}}`],
    ['inside another curly block', `{{#x-outer}}${BLOCK}{{/x-outer}}`],
  ] as const) {
    test(`${label}: a component invoked by name with its block as a slot`, () => {
      const out = code(tpl);
      expect(out).toMatch(/\$_c\('XTwice', (\/\*#__PURE__\*\/)?\$_args\(\{\}, \{ default_: true, default: \(ctx\d+, s, n\) => \[/);
      expect(out).not.toContain("$_tag('XTwice'");
      expect(out).not.toContain('this.s');
    });
  }

  test('the same block compiles the same at the top level and nested', () => {
    expect(code(`<div>${BLOCK}</div>`)).toContain(SLOT);
    expect(code(BLOCK)).toContain(SLOT);
  });

  test('an element of the same name stays an element next to a curly block', () => {
    const alone = code('<XTwice class="a">b</XTwice>');
    const withCurly = code(`${BLOCK}<XTwice class="a">b</XTwice>`);
    expect(alone).toContain("$_tag('XTwice'");
    expect(withCurly).toContain("$_tag('XTwice'");
    expect(withCurly).toContain(alone.slice(1, -1));
  });

  test('a lexical binding of the PascalCase name is still invoked as that binding', () => {
    const result = compileTemplateSource(`<div>${BLOCK}</div>`, {
      flags: COMPAT_FLAGS,
      bindings: new Set(['XTwice']),
    });
    expect(result.code).toContain('$_c(XTwice, ');
  });
});

describe('compat curly component block: runtime', () => {
  const compat = useEmberCompatRuntime();
  const registry = new Map<string, CompatTemplate>();
  let saved: typeof $_MANAGERS.component;

  beforeEach(() => {
    saved = { ...$_MANAGERS.component };
    // The Ember compat manager resolves a component name through its
    // registry; here a name maps to a template-only component.
    $_MANAGERS.component.canHandle = (value: unknown) =>
      typeof value === 'string' && registry.has(value);
    $_MANAGERS.component.handle = ((name: string) => {
      const template = registry.get(name)!;
      return function NamedComponent() {
        return { [COMPONENT_ID_PROPERTY]: cId(), [$template]: template };
      };
    }) as unknown as typeof $_MANAGERS.component.handle;
    registry.set('XTwice', compileCompat('{{yield "foo" 1}}|{{yield "" 2}}'));
  });

  afterEach(() => {
    $_MANAGERS.component.canHandle = saved.canHandle;
    $_MANAGERS.component.handle = saved.handle;
    registry.clear();
  });

  test('a curly block inside an element gets the params of each yield', () => {
    compat.render(compileCompat(`<div>${BLOCK}</div>`));
    expect(compat.fixture.container.querySelector('div')!.textContent).toBe('[foo-1]|[-2]');
  });

  test('a curly block inside an {{#if}} branch gets its params', async () => {
    const show = cell(false);
    compat.render(compileCompat(`{{#if show.value}}<p>${BLOCK}</p>{{/if}}`, { show }));
    expect(compat.fixture.container.textContent).toBe('');
    show.update(true);
    await syncDom();
    expect(compat.fixture.container.querySelector('p')!.textContent).toBe('[foo-1]|[-2]');
  });
});
