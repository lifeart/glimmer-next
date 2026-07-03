/**
 * Ground-truth block-params flag (`CompileResult.usedBlockParams`).
 *
 * A coarse, TEMPLATE-LEVEL boolean the compiler sets when it registers ANY
 * `as |…|` block param — a component/element block, a `<:name … as |x|>` named
 * block, or `{{#each … as |x|}}`. It is threaded like `usedSlots` / `usedFw`
 * through both `compile()` (CompileResult) and `compileTemplate()`
 * (RuntimeCompileResult), so a host (the Ember bridge) reads it instead of
 * source-sniffing the compiled fn for `$_bp<n>` references (`hasBlockParamRef`),
 * which the ember dialect's block-params transform emits as `this.$_bp0`-style
 * member reads.
 *
 * Granularity note: `{{#let … as |y|}}` local aliases use a distinct
 * `let-binding` kind and are deliberately NOT counted.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { compileTemplate } from '../../runtime-compiler';

const compat = { flags: { IS_GLIMMER_COMPAT_MODE: true } };

describe('usedBlockParams via compile()', () => {
  test('true when a component invocation declares block params (<Foo as |x|>)', () => {
    expect(compile('<Foo as |x|>{{x}}</Foo>', compat).usedBlockParams).toBe(true);
  });

  test('true for a named block that declares block params', () => {
    expect(
      compile('<Foo><:header as |x|>{{x}}</:header></Foo>', compat).usedBlockParams
    ).toBe(true);
  });

  test('true for {{#each ... as |item|}} block params', () => {
    expect(
      compile('{{#each this.items as |item|}}{{item}}{{/each}}', compat).usedBlockParams
    ).toBe(true);
  });

  test('false when the template declares no block params', () => {
    expect(compile('<Foo>plain</Foo>', compat).usedBlockParams).toBe(false);
    expect(compile('<div>{{this.title}}</div>', compat).usedBlockParams).toBe(false);
  });

  test('false for {{#let ... as |y|}} (a distinct let-binding kind, not counted)', () => {
    expect(
      compile('{{#let this.a as |b|}}{{b}}{{/let}}', compat).usedBlockParams
    ).toBe(false);
  });
});

describe('usedBlockParams via compileTemplate()', () => {
  test('true for a component invocation with block params', () => {
    expect(compileTemplate('<Foo as |x|>{{x}}</Foo>').usedBlockParams).toBe(true);
  });

  test('true for a named block with block params', () => {
    expect(
      compileTemplate('<Foo><:header as |x|>{{x}}</:header></Foo>').usedBlockParams
    ).toBe(true);
  });

  test('false when no block params are declared', () => {
    expect(compileTemplate('<Foo>plain</Foo>').usedBlockParams).toBe(false);
  });
});
