/**
 * Regression coverage for `(has-block)` / `(has-block-params)` codegen.
 *
 * Bug:
 *   Prior to this test, the SubExpression form `(has-block)` (no positional
 *   args) emitted just `$_hasBlock.bind(this, $slots)` (the bound function
 *   itself, NOT a call). For two top-level shapes — direct mustache
 *   `{{has-block}}` (handled by the renderer's `deepFnValue` auto-call) and
 *   `{{#if (has-block)}}` (handled by `$_if`'s `setupCondition` auto-call) —
 *   that happened to work. But the helper-param shape
 *   `{{if (has-block) "true" "false"}}` and the attribute-position shape
 *   `<button name={{(has-block)}}></button>` both route through `$__if`,
 *   whose `unwrap()` is shallow: it calls a getter arrow once but does not
 *   recurse into the bound function it returns. The bound function itself
 *   is then evaluated for truthiness (always truthy), so the inline form
 *   always selected the "true" branch regardless of slot presence. The
 *   `(has-block "inverse")` variant happened to pass because the explicit
 *   string positional argument forced the emitter into the `args.length > 0`
 *   branch, which DID emit a call.
 *
 * Fix:
 *   Always emit `$_hasBlock.bind(this, $slots)(<args...>)` — i.e. always
 *   call the bound function. Slots are populated synchronously by the
 *   runtime-compiler wrapper before the template body runs and the helper
 *   does a pure key lookup, so eager invocation is correct regardless of
 *   surrounding position.
 *
 * (Tracked under task 2.3 in the GXT migration plan; surfaces as 4 failing
 * tests in the ember.js curly-components-test smoke module:
 *   - `(has-block) expression in an attribute`
 *   - `(has-block-params) expression in an attribute`
 *   - `(has-block) as a param to a helper`
 *   - `(has-block-params) as a param to a helper`)
 */

import { describe, test, expect } from 'vitest';
import { compileTemplate } from '../runtime-compiler';

describe('has-block / has-block-params SubExpression codegen', () => {
  test('attribute position: `<button name={{(has-block)}}></button>` emits call', () => {
    const result = compileTemplate('<button name={{(has-block)}}></button>');
    expect(result.errors).toHaveLength(0);
    // The bound function MUST be called — `.bind(this, $slots)()` not just
    // `.bind(this, $slots)`. The trailing `()` makes the SubExpression
    // evaluate to a boolean before reaching `$__if`'s shallow `unwrap()`.
    expect(result.code).toContain('$_hasBlock.bind(this, $slots)()');
    // And `$slots` must be extracted in the wrapper so the bind has
    // something to close over.
    expect(result.templateFn.toString()).toMatch(/const\s+\$slots\s*=/);
  });

  test('attribute position: `<button name={{(has-block-params)}}></button>` emits call', () => {
    const result = compileTemplate(
      '<button name={{(has-block-params)}}></button>'
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_hasBlockParams.bind(this, $slots)()');
    expect(result.templateFn.toString()).toMatch(/const\s+\$slots\s*=/);
  });

  test('helper-param position: `{{if (has-block) "true" "false"}}` emits call', () => {
    const result = compileTemplate('{{if (has-block) "true" "false"}}');
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_hasBlock.bind(this, $slots)()');
    expect(result.code).not.toMatch(/\$_hasBlock\.bind\(this,\s*\$slots\)\s*,/);
    expect(result.templateFn.toString()).toMatch(/const\s+\$slots\s*=/);
  });

  test('helper-param position: `{{if (has-block-params) "true" "false"}}` emits call', () => {
    const result = compileTemplate('{{if (has-block-params) "true" "false"}}');
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_hasBlockParams.bind(this, $slots)()');
    expect(result.templateFn.toString()).toMatch(/const\s+\$slots\s*=/);
  });

  test('explicit "inverse" still passes the string positional arg', () => {
    // `(has-block "inverse")` already passed before the fix because the
    // emitter took the `args.length > 0` branch; lock it in to make sure
    // the unified-call path didn't drop the argument.
    const result = compileTemplate('{{if (has-block "inverse") "x" "y"}}');
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_hasBlock.bind(this, $slots)("inverse")');
  });

  test('block form `{{#if (has-block)}}` still emits call (boolean condition)', () => {
    // Block form goes through `$_if`, whose `setupCondition` *would* auto-call
    // a function condition — but since the SubExpression now always emits a
    // call, `$_if` receives a plain boolean, which it wraps as a primitive
    // condition. Either way: no false-truthy regression.
    const result = compileTemplate(
      '{{#if (has-block)}}<span>y</span>{{else}}<span>n</span>{{/if}}'
    );
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_hasBlock.bind(this, $slots)()');
  });

  test('direct mustache `{{has-block}}` still emits call', () => {
    // Direct mustache is rendered by the runtime via `deepFnValue` auto-call,
    // so emitting either the bound function or its result is observationally
    // equivalent. Lock the call form in to keep the codegen uniform across
    // positions.
    const result = compileTemplate('{{has-block}}');
    expect(result.errors).toHaveLength(0);
    expect(result.code).toContain('$_hasBlock.bind(this, $slots)()');
  });
});
