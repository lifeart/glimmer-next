/**
 * Glimmer compat mode: a lowercase tag with a dash (`<x-foo>`) is a custom
 * element, never a component.
 *
 * Glimmer classifies a tag as a component only when it starts with an
 * uppercase letter or is a path (`this.x`, `@x`, `x.y`, `Foo::Bar`); a
 * lowercase dashed tag is an element even when a component of that name
 * exists (a component's own template may render `<x-foo>` as its element).
 * The compat compiler treated every dashed tag like a component invocation: an
 * empty `<x-foo></x-foo>` got the `@__hasBlock__` argument marker, and the
 * children of `<x-foo>` were wrapped in lazy node thunks for the host's
 * component resolution. The tags the compiler lowers itself (`<LinkTo>` →
 * `link-to`, `<Foo::Bar>` → `foo--bar`) are still component invocations.
 * Standalone gxt keeps the lazy children; it loses the marker, which it set as
 * an attribute named `@__hasBlock__`.
 */
import { describe, test, expect } from 'vitest';
// The compat test runtime (and with it the main entry) first: vite-node
// populates `export *` namespaces in import order (see
// plugins/__tests__/template-source.test.ts).
import { COMPAT_FLAGS, compileCompat, useEmberCompatRuntime } from './__test-utils__/ember-compat';
import { compileTemplateSource } from '../../plugins/runtime-compiler';
import { cell } from './reactive';
import { syncDom } from './runtime';

const NATIVE_FLAGS = { ...COMPAT_FLAGS, EMBER_NATIVE: true, EMBER_LOOSE_COMPONENTS: true };

function code(tpl: string, flags: Record<string, boolean> = COMPAT_FLAGS) {
  const result = compileTemplateSource(tpl, { flags });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('compat custom element: compiler', () => {
  test('an empty custom element gets no block marker', () => {
    expect(code('<x-foo></x-foo>')).not.toContain('@__hasBlock__');
    expect(code('<x-foo></x-foo>')).toBe(code('<x-foo />'));
  });

  test('the children of a custom element are created like the children of a div', () => {
    const children = '<h1>X</h1><p>Hello {{@name}}</p><Bar />';
    const custom = code(`<x-foo>${children}</x-foo>`);
    expect(custom).not.toContain('$_nt(');
    expect(custom).toBe(code(`<div>${children}</div>`).replace("$_tag('div'", "$_tag('x-foo'"));
  });

  test('native: the children of a custom element are not node thunks', () => {
    expect(code('<x-foo><h1>X</h1></x-foo>', NATIVE_FLAGS)).not.toContain('$_nt(');
  });

  test('standalone: an empty custom element gets no block marker either', () => {
    expect(code('<x-foo></x-foo>', {})).toBe(code('<x-foo />', {}));
  });

  test('standalone: the children of a custom element compile as before', () => {
    expect(code('<x-foo><h1>X</h1></x-foo>', {})).toBe(
      "[/*#__PURE__*/$_tag('x-foo', $_edp, this, [$_nt(() => $_tag('h1', [[], [], [[\"1\", \"X\"]]], this))])]",
    );
  });

  test('a lexical binding of a dashed name is not a custom element', () => {
    const result = compileTemplateSource('<x-foo></x-foo>', {
      flags: COMPAT_FLAGS,
      bindings: new Set(['x-foo']),
    });
    expect(result.code).not.toBe(code('<x-foo />'));
  });

  for (const [label, tpl, tag] of [
    ['<LinkTo>', '<LinkTo></LinkTo>', 'link-to'],
    ['<Foo::Bar>', '<Foo::Bar></Foo::Bar>', 'foo--bar'],
    ['<FooBar>', '<FooBar></FooBar>', 'FooBar'],
  ] as const) {
    test(`${label} is still a component invocation`, () => {
      const empty = code(tpl);
      expect(empty).toContain(`$_tag('${tag}'`);
      expect(empty).toContain('@__hasBlock__');
      const withChild = code(tpl.replace('></', '><h1>X</h1></'));
      expect(withChild).toContain("$_nt(() => $_tag('h1'");
    });
  }
});

describe('compat custom element: runtime', () => {
  const compat = useEmberCompatRuntime();

  test('an empty custom element renders with no argument attribute', () => {
    compat.render(compileCompat('<x-foo class="a"></x-foo>'));
    const el = compat.fixture.container.querySelector('x-foo')!;
    // (`data-node-id` is the SSR test environment's node id.)
    expect(el.getAttributeNames().filter((name) => name !== 'data-node-id')).toEqual(['class']);
    expect(el.childNodes).toHaveLength(0);
  });

  test("a custom element's children are its own elements and stay reactive", async () => {
    const name = cell('Godfrey');
    compat.render(compileCompat('<x-foo><h1>X-Foo</h1><p>Hello {{name.value}}</p></x-foo>', { name }));
    const el = compat.fixture.container.querySelector('x-foo')!;
    expect(Array.from(el.childNodes, (n) => n.nodeName)).toEqual(['H1', 'P']);
    expect(el.textContent).toBe('X-FooHello Godfrey');
    name.update('Tom');
    await syncDom();
    expect(el.querySelector('p')!.textContent).toBe('Hello Tom');
    expect(Array.from(el.childNodes, (n) => n.nodeName)).toEqual(['H1', 'P']);
  });
});
