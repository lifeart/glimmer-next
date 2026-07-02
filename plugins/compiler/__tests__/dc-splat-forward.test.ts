import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { flags: { IS_GLIMMER_COMPAT_MODE: true } } as const;

/**
 * A dynamic component (`$_dc`, dotted-path tag) in splat context forwards the
 * enclosing component's `...attributes` (`$fw`) as a dedicated 4th `$_dc`
 * argument, instead of baking it into the args-props tuple. Static component
 * invocations ($_c) keep the in-args merge; a dynamic component WITHOUT splat
 * is emitted unchanged (no 4th arg, `usedFw` not flipped by this site).
 */
describe('$_dc splat forwarding ($fw) emission', () => {
  test('splat dynamic component emits $fw as the 4th $_dc argument', () => {
    const { code, usedFw } = compile('<this.X ...attributes />', COMPAT);
    // $fw threaded as a dedicated 4th arg to $_dc.
    expect(code).toContain('$_dc(() => this.X,');
    expect(code).toMatch(/\$_dc\(\(\) => this\.X,[^)]*\), this, \$fw\)/);
    // Not baked into the args-props tuple (no `[...$fw[0]` spread merge).
    expect(code).not.toContain('...$fw[0]');
    // Requires the `const $fw = $_GET_FW(...)` preamble local.
    expect(usedFw).toBe(true);
  });

  test('dynamic component WITHOUT splat is unchanged (no $fw arg, usedFw not set)', () => {
    const { code, usedFw } = compile('<this.X class="foo" />', COMPAT);
    // 3-arg $_dc, direct props carried in args as before.
    expect(code).toContain('$_dc(() => this.X,');
    expect(code).not.toContain(', $fw)');
    expect(code).toContain('[["", "foo"]]');
    expect(usedFw).toBe(false);
  });

  test('bare dynamic component (no props/splat) is unchanged', () => {
    const { code, usedFw } = compile('<this.X />', COMPAT);
    expect(code).not.toContain(', $fw)');
    expect(usedFw).toBe(false);
  });

  test('splat + direct attrs: direct props stay in args, $fw is the 4th arg', () => {
    const { code, usedFw } = compile('<this.X class="foo" ...attributes />', COMPAT);
    // Direct class prop remains in the args-props tuple...
    expect(code).toContain('[["", "foo"]]');
    // ...and $fw is threaded as the 4th arg (runtime merges fw-first).
    expect(code).toMatch(/\), this, \$fw\)/);
    expect(usedFw).toBe(true);
  });

  test('nested dotted dynamic tag also emits the 4th $fw arg', () => {
    const { code } = compile('<this.foo.Bar ...attributes />', COMPAT);
    expect(code).toContain('$_dc(() => this.foo.Bar,');
    expect(code).toMatch(/\), this, \$fw\)/);
  });

  test('static component splat still merges $fw into args (unchanged path)', () => {
    // A non-dotted component tag routes through $_c and keeps the in-args merge.
    const Button = 'Button';
    const { code, usedFw } = compile('<Button ...attributes />', {
      ...COMPAT,
      bindings: new Set([Button]),
    } as any);
    expect(code).toContain('...$fw[0]');
    expect(usedFw).toBe(true);
  });
});
