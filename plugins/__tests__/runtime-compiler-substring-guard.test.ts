/**
 * Regression coverage for the `$slots` / `$fw` reference detection in
 * plugins/runtime-compiler.ts (compileTemplate).
 *
 * The runtime wrapper auto-injects local bindings:
 *
 *   const $slots = $_GET_SLOTS(this, arguments);
 *   const $fw    = $_GET_FW(this, arguments);
 *
 * only when the compiled template body actually references those names.
 * A previous implementation used a bare `result.code.includes('$slots')`
 * / `includes('$fw')` substring match, which false-positives whenever the
 * user's template *content* (a JSON-stringified string literal in the
 * compiled JS) happens to contain those characters — most notably when:
 *
 *   1. A user binds a scope key called `$slots`/`$fw` and references it
 *      in the template; the auto-injected `const $slots = …` shadows the
 *      scope value passed to `new Function(...scopeNames)`.
 *   2. Template text contains an identifier prefix collision such as
 *      `"$fwd"` (see the comment in plugins/runtime-compiler.ts), where
 *      the substring `$fw` matches inside the JSON-encoded literal.
 *
 * The guard now keys off codegen-shape compound substrings (`, $slots,`,
 * `, $slots)`, `, $fw,`, `, $fw]`, `...$fw[`) which never appear from a
 * bare identifier-prefix collision in user text. The tests below
 * inspect the source of the returned template function — produced by
 * `new Function(...)` inside compileTemplate — to confirm no shadow
 * declaration is emitted for templates whose only `$slots`/`$fw`
 * occurrences live inside string literals.
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
