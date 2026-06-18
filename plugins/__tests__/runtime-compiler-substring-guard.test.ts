/**
 * Regression coverage for the `$a` / `$slots` / `$fw` preamble-local detection
 * in plugins/runtime-compiler.ts (compileTemplate).
 *
 * The runtime wrapper auto-injects local bindings:
 *
 *   const $a     = this[$args];
 *   const $slots = $_GET_SLOTS(this, arguments);
 *   const $fw    = $_GET_FW(this, arguments);
 *
 * only when the compiled template body actually references those names.
 *
 * This is now driven by the compiler's GROUND TRUTH: the serializers set
 * `CompileResult.usedArgsAlias` / `usedSlots` / `usedFw` at the exact site that
 * emits each free reference, and the runtime wrapper injects the matching local
 * iff its flag is set. It REPLACES the old substring scans, which had two
 * failure modes:
 *
 *   - false POSITIVE — `code.includes('$slots')` / `includes('$fw')` matched
 *     the user's template *text* (a `$slots`/`$fw` literal, or a `$fwd` prefix
 *     collision), injecting a `const $slots = …` that shadowed a same-named
 *     `scope` value. (A compound-substring narrowing fixed most of this; the
 *     ground-truth flag removes the failure mode entirely.)
 *   - false NEGATIVE (the dangerous one) — `code.includes('$a.')` MISSED the
 *     bracket form `$a["foo-bar"]` that the compiler emits for hyphenated arg
 *     names, leaving `$a` undeclared → a ReferenceError at render. The
 *     args-alias block below pins the fix.
 *
 * The tests inspect the source of the returned template function — produced by
 * `new Function(...)` inside compileTemplate — to confirm the preamble local is
 * (or is not) declared.
 */

import { describe, test, expect } from 'vitest';
import { compileTemplate } from '../runtime-compiler';

describe('runtime-compiler $slots/$fw shadow-injection guard', () => {
  test('text content containing "$slots" does not inject const $slots', () => {
    const result = compileTemplate('<p>$slots is just a string</p>');

    expect(result.errors).toHaveLength(0);
    // Sanity: the literal made it into the compiled body.
    expect(result.code).toContain('$slots is just a string');

    const fnSrc = result.templateFn.toString();
    expect(fnSrc).not.toMatch(/const\s+\$slots\s*=/);
  });

  test('text content containing "$fwd" (prefix collision with $fw) does not inject const $fw', () => {
    const result = compileTemplate('<p>"price $fwd: 12"</p>');

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$fwd');

    const fnSrc = result.templateFn.toString();
    expect(fnSrc).not.toMatch(/const\s+\$fw\s*=/);
  });

  test('text content with "hello $fw bye" still does not inject const $fw', () => {
    // `$fw` followed by a space (not by `,`/`]`/`[`) — a real codegen
    // reference would be `, $fw,` / `, $fw]` / `...$fw[`. This text
    // form must NOT trigger injection.
    const result = compileTemplate('<p>hello $fw bye</p>');

    expect(result.errors).toHaveLength(0);
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).not.toMatch(/const\s+\$fw\s*=/);
  });

  test('a template that genuinely uses (has-block) DOES inject const $slots', () => {
    // Sanity: the guard must still fire for real codegen references —
    // (has-block) emits `$_hasBlock.bind(this, $slots)` per
    // plugins/compiler/serializers/value.ts:791.
    const result = compileTemplate(
      '{{#if (has-block)}}<span>yes</span>{{else}}<span>no</span>{{/if}}'
    );

    expect(result.errors).toHaveLength(0);
    // The codegen pattern must be present.
    expect(result.code).toMatch(/\.bind\(this,\s*\$slots\)/);
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$slots\s*=/);
  });

  test('a template with splat attributes DOES inject const $fw', () => {
    // `<div ...attributes>` triggers the element-tuple codegen which appends
    // `$fw` as a positional element: `$_tag('div', [[], [], [], $fw], this)`
    // (see plugins/compiler/serializers/element.ts:257). The compound
    // `, $fw]` substring fires the auto-injection.
    const result = compileTemplate('<div ...attributes></div>');

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain(', $fw]');
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$fw\s*=/);
  });
});

describe('runtime-compiler $a (args-alias) ground-truth injection', () => {
  // The OLD detector was `result.code.includes('$a.')`. The compiler emits a
  // hyphenated @-arg as BRACKET access (`$a["foo-bar"]`), which contains no
  // `$a.` — so the old scan returned false, `const $a` was NOT injected, and
  // the template threw `ReferenceError: $a is not defined` at render. These
  // pin the ground-truth fix: any emission of `$a` declares the local.

  test('hyphenated @arg mustache emits $a["..."] and DOES inject const $a (was a ReferenceError)', () => {
    const result = compileTemplate('{{@foo-bar}}');

    expect(result.errors).toHaveLength(0);
    // bracket access is emitted...
    expect(result.code).toContain('$a["foo-bar"]');
    // ...and crucially NOT the dotted form the old scan keyed off
    expect(result.code).not.toContain('$a.');
    // the preamble local is declared (old `includes('$a.')` would have missed it)
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$a\s*=\s*this\[/);
  });

  test('hyphenated @arg attribute value injects const $a', () => {
    const result = compileTemplate('<div aria-label={{@aria-label}}></div>');

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$a["aria-label"]');
    expect(result.code).not.toContain('$a.');
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$a\s*=\s*this\[/);
  });

  test('hyphenated @arg modifier reference injects const $a', () => {
    const result = compileTemplate('<div {{@my-modifier}}></div>');

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$a["my-modifier"]');
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$a\s*=\s*this\[/);
  });

  test('hyphenated @arg helper reference injects const $a', () => {
    const result = compileTemplate('{{(@my-helper 1)}}');

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$a["my-helper"]');
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$a\s*=\s*this\[/);
  });

  test('dotted @arg still injects const $a (the case the old scan DID catch)', () => {
    const result = compileTemplate('{{@name}}');

    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$a.name');
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).toMatch(/const\s+\$a\s*=\s*this\[/);
  });

  test('a template with no @arg access injects NO preamble locals', () => {
    const result = compileTemplate('<p>plain text {{this.value}}</p>');

    expect(result.errors).toHaveLength(0);
    const fnSrc = result.templateFn.toString();
    expect(fnSrc).not.toMatch(/const\s+\$a\s*=/);
    expect(fnSrc).not.toMatch(/const\s+\$slots\s*=/);
    expect(fnSrc).not.toMatch(/const\s+\$fw\s*=/);
  });
});
