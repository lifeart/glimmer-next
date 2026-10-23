/**
 * N5 (ember.js#21340): a DYNAMIC modifier whose name is a `this.*` path must
 * read through the property-tag tap so the modifier re-installs when the name
 * property changes after the initial render.
 *
 * `buildModifierExpr` historically emitted the `this.dyn` modifier name as a
 * plain member read (`$s.dyn`). On an EmberObject with a non-`@tracked` `dyn`
 * that read taps no tag, so the modifier formula is treated as const and a
 * later `set(ctx, 'dyn', X)` never re-runs it (the dynamic modifier is never
 * destroyed/created). Under EMBER_PROPERTY_TAGS the name now goes through the
 * same `$__tag(obj, "key")` chain as a value path.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const EMBER = {
  IS_GLIMMER_COMPAT_MODE: true,
  WITH_EMBER_INTEGRATION: true,
  WITH_MODIFIER_MANAGER: true,
  EMBER_SELF: true,
  EMBER_PROPERTY_TAGS: true,
} as const;

function code(tpl: string, flags: Record<string, unknown>) {
  const result = compile(tpl, { flags: flags as never });
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('dynamic modifier name property-tag tap (N5)', () => {
  test('a this.* modifier name taps the property tag under EMBER_PROPERTY_TAGS', () => {
    const c = code('<div {{this.dyn}}></div>', EMBER);
    // Resolution read goes through the property-tag tap, not a plain `$s.dyn`.
    expect(c).toContain('$_maybeModifier($__tag($s, "dyn")');
    expect(c).not.toContain('$_maybeModifier($s.dyn');
  });

  test('a nested this.* modifier name taps each segment', () => {
    const c = code('<div {{this.a.dyn}}></div>', EMBER);
    expect(c).toContain('$__tag($__tag($s, "a"), "dyn")');
  });

  test('without EMBER_PROPERTY_TAGS the name stays a plain read', () => {
    const c = code('<div {{this.dyn}}></div>', { WITH_MODIFIER_MANAGER: true });
    expect(c).toContain('this.dyn');
    expect(c).not.toContain('$__tag');
  });
});
