import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { flags: { IS_GLIMMER_COMPAT_MODE: true } } as const;

/**
 * U1 — dynamic component tags whose head is an `@arg` must resolve the head
 * through the args alias ($a) instead of leaking a raw `@identifier` token into
 * the emitted JS (a SyntaxError outside decorator position).
 */
describe('dynamic @-path component tag normalization', () => {
  test('<@model.componentName /> resolves the @-head through $a (no raw @ token)', () => {
    const { code } = compile('<@model.componentName />', COMPAT);
    expect(code).toContain('$a.model.componentName');
    // The raw `@identifier` token must NOT leak into emitted code.
    expect(code).not.toMatch(/@[A-Za-z_$]/);
    // Still a dynamic-component getter call.
    expect(code).toContain('() => $a.model.componentName');
  });

  test('{{component @model.componentName}} normalizes the same way', () => {
    const { code } = compile('{{component @model.componentName}}', COMPAT);
    expect(code).toContain('() => $a.model.componentName');
    expect(code).not.toMatch(/@[A-Za-z_$]/);
  });

  test('@-head with special characters uses bracket notation', () => {
    const { code } = compile('<@weird-name.Foo />', COMPAT);
    expect(code).toContain('() => $a["weird-name"].Foo');
    expect(code).not.toMatch(/@[A-Za-z_$]/);
  });

  test('sibling this-path dynamic tag is unchanged (was already valid)', () => {
    const { code } = compile('<this.foo.Bar />', COMPAT);
    expect(code).toContain('() => this.foo.Bar');
  });
});

/**
 * Ember compat (WITH_EMBER_INTEGRATION): `<@comp>` invokes the component an
 * argument holds — a dynamic component (`$_dc`), as under EMBER_NATIVE —
 * with its block, block params and named blocks. The compat emission was the
 * element `$_tag('@comp', …)`, whose children are element children: block
 * params read `this.v`, a named block became `$_tag(':named', …)`, and the
 * block never reached the component's `{{yield}}`.
 */
describe('Ember compat: `<@comp>` is a dynamic component', () => {
  const EMBER_COMPAT = {
    flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true },
  } as const;

  test('block params bind to the yielded values', () => {
    const { code } = compile('<@comp class="r" as |v|>[{{v}}]</@comp>', EMBER_COMPAT);
    expect(code).toContain('$_dc(() => $a.comp');
    expect(code).toMatch(/default: \(ctx0, v\) => \["\[", \(\) => v, "\]"\]/);
    expect(code).not.toContain("$_tag('@comp'");
    expect(code).not.toContain('this.v');
  });

  test('self-closing, text block and named blocks', () => {
    expect(compile('<@comp />', EMBER_COMPAT).code).toContain(
      '$_dc(() => $a.comp, /*#__PURE__*/$_args({}, {}, $_edp), this, undefined, "@comp")',
    );
    expect(compile('<@comp>text</@comp>', EMBER_COMPAT).code).toMatch(/default: ctx0 => \["text"\]/);
    const named = compile('<@comp><:named>x</:named></@comp>', EMBER_COMPAT).code;
    expect(named).toMatch(/named: ctx0 => \["x"\]/);
    expect(named).not.toContain("$_tag(':named'");
  });

  test('the same emission as under EMBER_NATIVE', () => {
    const native = {
      flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true, EMBER_NATIVE: true },
    } as const;
    for (const tpl of ['<@comp as |v|>{{v}}</@comp>', '<@comp @a={{this.x}} title="t" />']) {
      expect(compile(tpl, EMBER_COMPAT).code).toBe(compile(tpl, native).code);
    }
  });

  test('standalone gxt is unchanged', () => {
    expect(compile('<@comp />', COMPAT).code).toContain("$_tag('@comp'");
  });
});
