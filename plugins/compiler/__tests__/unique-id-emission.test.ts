/**
 * Compat-mode `{{unique-id}}` emission → `$_uid(this, SITE_INDEX)`.
 *
 * The serializer (serializers/value.ts `buildHelper`) intercepts `unique-id`
 * under IS_GLIMMER_COMPAT_MODE and emits a first-class `$_uid(this, N)` call
 * with a per-template call-site index — instead of the generic
 * `$_maybeHelper("unique-id", [], this)` the Ember bridge used to rewrite. This
 * retires that host-side rewrite + `uidOuterScope` injection, and drops
 * `unique-id`/`unique_id` from the native-routing blocker sets.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const flags = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true };

describe('{{unique-id}} → $_uid emission', () => {
  test('a single {{unique-id}} emits $_uid(this, 0), not $_maybeHelper', () => {
    const r = compile('<div>{{unique-id}}</div>', { flags });
    expect(r.errors).toHaveLength(0);
    expect(r.code).toContain('$_uid(this, 0)');
    expect(r.code).not.toContain('$_maybeHelper("unique-id"');
  });

  test('distinct call-sites get distinct per-template site indices', () => {
    const r = compile('<div id={{unique-id}}>{{unique-id}}</div>', { flags });
    expect(r.errors).toHaveLength(0);
    expect(r.code).toContain('$_uid(this, 0)');
    expect(r.code).toContain('$_uid(this, 1)');
  });

  test('the (unique-id) sub-expression form is intercepted too (#let init)', () => {
    const r = compile('{{#let (unique-id) as |id|}}<b>{{id}}</b>{{/let}}', { flags });
    expect(r.errors).toHaveLength(0);
    // The let-init reuses ONE site index, so every `id()` read maps to the
    // same (ctx, 0) pair — stable id across re-reads.
    expect(r.code).toContain('$_uid(this, 0)');
    expect(r.code).not.toContain('$_maybeHelper("unique-id"');
  });

  test('$_uid lands in emittedSymbols; unique-id leaves maybeHelperNames', () => {
    const r = compile('<div>{{unique-id}}</div>', { flags });
    expect(r.emittedSymbols).toContain('$_uid');
    // No longer routed through the string-form maybeHelper resolver — this is
    // what drops it from the Ember native-routing blocker set.
    expect(r.maybeHelperNames).not.toContain('unique-id');
  });

  test('site index resets per compilation (WeakMap ctx key keeps it collision-free)', () => {
    const a = compile('{{unique-id}}', { flags });
    const b = compile('{{unique-id}}', { flags });
    // Both start at 0 — safe because the runtime keys ids on (ctx, N) and the
    // two templates render into distinct ctx objects.
    expect(a.code).toContain('$_uid(this, 0)');
    expect(b.code).toContain('$_uid(this, 0)');
  });

  test('a scope binding named unique-id shadows the built-in (no $_uid)', () => {
    // If the host provides `unique-id`/`unique_id` in scope, defer to it.
    const r = compile('{{unique-id}}', {
      flags,
      bindings: new Set(['unique-id']),
    });
    expect(r.code).not.toContain('$_uid(');
  });

  test('non-compat mode does NOT emit $_uid', () => {
    const r = compile('<div>{{unique-id}}</div>', {
      flags: { IS_GLIMMER_COMPAT_MODE: false },
    });
    expect(r.code).not.toContain('$_uid(');
  });
});
