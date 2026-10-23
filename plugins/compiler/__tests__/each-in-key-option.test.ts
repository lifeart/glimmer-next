/**
 * R12 (ember.js#21340 N21-N25): the native `{{#each-in}}` lowering forwards a
 * non-identity `key=` option to `$__eachIn(obj, "key")` (which resolves it
 * against each entry) and keys the lowered `each` by `@identity` on the returned
 * pairs. `@identity` / no key stays the historic 1-arg `$__eachIn(obj)`.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const NATIVE = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  FORCE_SYNC_LIST: true,
  EMBER_NATIVE: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
} as const;

function code(tpl: string, bindings: string[] = []) {
  const result = compile(tpl, { flags: NATIVE as never, bindings: new Set(bindings) });
  expect(result.errors).toHaveLength(0);
  return result.code.split('/*#__PURE__*/').join('');
}

describe('{{#each-in key=…}} forwards the key to $__eachIn (R12)', () => {
  test('a path key is forwarded: $__eachIn(o, "id")', () => {
    const out = code('{{#each-in o key="id" as |k v|}}{{k}}{{v.label}}{{/each-in}}', ['o']);
    expect(out).toContain('$__eachIn(o, "id")');
  });

  test('@key is forwarded verbatim', () => {
    const out = code('{{#each-in o key="@key" as |k v|}}{{k}}{{/each-in}}', ['o']);
    expect(out).toContain('$__eachIn(o, "@key")');
  });

  test('@index is forwarded verbatim', () => {
    const out = code('{{#each-in o key="@index" as |k v|}}{{k}}{{/each-in}}', ['o']);
    expect(out).toContain('$__eachIn(o, "@index")');
  });

  test('default / @identity stays the 1-arg form (historic shape)', () => {
    expect(code('{{#each-in o as |k v|}}{{k}}{{/each-in}}', ['o'])).toContain('$__eachIn(o)');
    expect(code('{{#each-in o key="@identity" as |k v|}}{{k}}{{/each-in}}', ['o'])).toContain(
      '$__eachIn(o)',
    );
  });
});
