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
