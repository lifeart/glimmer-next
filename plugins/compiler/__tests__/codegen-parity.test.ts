import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const COMPAT = { flags: { IS_GLIMMER_COMPAT_MODE: true } } as const;
const STANDALONE = { flags: { IS_GLIMMER_COMPAT_MODE: false } } as const;

/**
 * Extract the JS named-args object emitted inside a `$_componentHelper(...)` /
 * `$_helperHelper(...)` call so two emissions can be compared byte-for-byte.
 */
function namedArgsOf(code: string, symbol: string): string {
  const idx = code.indexOf(`${symbol}([`);
  expect(idx, `expected ${symbol}(...) in: ${code}`).toBeGreaterThan(-1);
  // Find the `], ` separating positional array from the named object, then the
  // matching closing brace of the object.
  const sep = code.indexOf('], ', idx);
  const braceStart = code.indexOf('{', sep);
  let depth = 0;
  for (let i = braceStart; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(braceStart, i + 1);
    }
  }
  throw new Error(`unbalanced named-args object in: ${code}`);
}

/** Extract the `globalThis.__gxtUnboundEval(...)` wrapper shape (id-normalized). */
function unboundWrapperShape(code: string): string {
  const m = code.match(/globalThis\.__gxtUnboundEval\(__ubCache,"__ub\d+",\(\)=>\(/);
  expect(m, `expected unbound cache-wrapper in: ${code}`).not.toBeNull();
  return m![0].replace(/"__ub\d+"/, '"__ubN"');
}

/**
 * U2 — the legacy string serializer (serializeHelperCall, used for {{yield …}} /
 * slot args) must reach parity with the JSExpression serializer (serializers/
 * value.ts) for the inline-unbound cache-wrap and the component/helper
 * named-args getter-wrap.
 */
describe('serializeHelperCall parity with the JSExpression serializer', () => {
  describe('inline unbound cache-wrap', () => {
    test('yielded (unbound this.x) emits the same wrapper shape as top-level {{unbound this.x}}', () => {
      const top = compile('{{unbound this.x}}', COMPAT).code;
      const yielded = compile('{{yield (unbound this.x)}}', COMPAT).code;

      // Both go through globalThis.__gxtUnboundEval(__ubCache, "__ubN", () => (…)).
      expect(unboundWrapperShape(yielded)).toBe(unboundWrapperShape(top));
      // The yielded form is no longer a bare unbound(...) call.
      expect(yielded).not.toContain('[unbound(this.x)]');
      expect(yielded).toContain('globalThis.__gxtUnboundEval(__ubCache,"__ub0",()=>(unbound(this.x)))');
    });

    test('cache keys stay unique across both serializers (shared unboundCounter)', () => {
      const { code } = compile('{{unbound this.a}}{{yield (unbound this.b)}}', COMPAT);
      const ids = [...code.matchAll(/"(__ub\d+)"/g)].map((m) => m[1]);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2); // no collision
    });

    test('standalone (non-compat) keeps the bare form — no ember-only wrapper leaks', () => {
      const { code } = compile('{{yield (unbound this.x)}}', STANDALONE);
      expect(code).toContain('unbound(this.x)');
      expect(code).not.toContain('__gxtUnboundEval');
    });
  });

  describe('component/helper hash getter-wrap', () => {
    test('yielded (component … key=this.y) emits a getter-wrapped named-args object identical to the JSExpression path', () => {
      const yielded = compile('{{yield (component "x" foo=this.y bar="s" n=42)}}', COMPAT).code;
      const top = compile('{{log (component "x" foo=this.y bar="s" n=42)}}', COMPAT).code;

      // Byte-identical named-args objects: only the path value is getter-wrapped;
      // the string/number literals are emitted directly.
      expect(namedArgsOf(yielded, '$_componentHelper')).toBe(
        namedArgsOf(top, '$_componentHelper')
      );
      expect(namedArgsOf(yielded, '$_componentHelper')).toBe('{ foo: () => this.y, bar: "s", n: 42 }');
    });

    test('yielded (helper … key=this.y) getter-wraps the path value', () => {
      const { code } = compile('{{yield (helper "x" foo=this.y)}}', COMPAT);
      expect(namedArgsOf(code, '$_helperHelper')).toBe('{ foo: () => this.y }');
    });

    test('component helper nested inside a yielded (hash …) wraps its path value too', () => {
      const { code } = compile('{{yield (hash c=(component "x" foo=this.y))}}', COMPAT);
      expect(code).toContain('$_componentHelper(["x"], { foo: () => this.y })');
    });

    test('standalone (non-compat) leaves component-helper hash values unwrapped', () => {
      const { code } = compile('{{yield (component "x" foo=this.y)}}', STANDALONE);
      expect(namedArgsOf(code, '$_componentHelper')).toBe('{ foo: this.y }');
    });
  });
});
