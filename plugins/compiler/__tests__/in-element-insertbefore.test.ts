/**
 * `{{#in-element}}` insertBefore emission (EMBER_IN_ELEMENT flag).
 *
 * Pins the compat serializer contract that replaces the Ember host's
 * out-of-band `__ieSet` insertBefore signalling channel: the render mode is
 * emitted as a first-class 4th `$_inElement(target, roots, ctx, MODE)` argument.
 *
 *   template                              →  mode arg  (runtime meaning)
 *   {{#in-element d}}                      →  1         IN_ELEMENT_CLEAR
 *   {{#in-element d insertBefore=undefined}} → 1        IN_ELEMENT_CLEAR
 *   {{#in-element d insertBefore=null}}    →  0         IN_ELEMENT_APPEND
 *   {{#in-element d insertBefore=".foo"}}  →  ".foo"    unsupported → dev-assert
 *
 * With the flag OFF the historic 3-arg call is emitted byte-for-byte.
 */

import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import type { CompileResult } from '../types';

const BASE = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true } as const;

function compileIE(tpl: string, emberInElement: boolean): CompileResult {
  return compile(tpl, { flags: { ...BASE, EMBER_IN_ELEMENT: emberInElement } });
}

/** Extract the argument list of the (single) `$_inElement(...)` call. */
function inElementCall(code: string): string {
  const start = code.indexOf('$_inElement(');
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start + '$_inElement'.length; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced $_inElement call');
}

describe('in-element insertBefore emission (EMBER_IN_ELEMENT)', () => {
  describe('flag ON — mode argument emitted', () => {
    test('omitted insertBefore → CLEAR (1)', () => {
      const r = compileIE('{{#in-element this.dest}}<div>x</div>{{/in-element}}', true);
      expect(r.code).toContain('$_inElement');
      expect(inElementCall(r.code)).toMatch(/,\s*this,\s*1\)$/);
      expect(r.emittedSymbols).toContain('$_inElement');
    });

    test('insertBefore=undefined → CLEAR (1)', () => {
      const r = compileIE('{{#in-element this.dest insertBefore=undefined}}<div>x</div>{{/in-element}}', true);
      expect(inElementCall(r.code)).toMatch(/,\s*this,\s*1\)$/);
    });

    test('insertBefore=null → APPEND (0)', () => {
      const r = compileIE('{{#in-element this.dest insertBefore=null}}<div>x</div>{{/in-element}}', true);
      expect(inElementCall(r.code)).toMatch(/,\s*this,\s*0\)$/);
    });

    test('insertBefore="<non-null literal>" → string mode carrying the value', () => {
      const r = compileIE('{{#in-element this.dest insertBefore=".foo"}}<div>x</div>{{/in-element}}', true);
      const call = inElementCall(r.code);
      expect(call).toMatch(/,\s*this,\s*(['"])\.foo\1\)$/);
    });

    test('insertBefore=5 (number) → string mode "5"', () => {
      const r = compileIE('{{#in-element this.dest insertBefore=5}}<div>x</div>{{/in-element}}', true);
      expect(inElementCall(r.code)).toMatch(/,\s*this,\s*(['"])5\1\)$/);
    });

    test('insertBefore=this.node (path) → string mode "this.node"', () => {
      const r = compileIE('{{#in-element this.dest insertBefore=this.node}}<div>x</div>{{/in-element}}', true);
      expect(inElementCall(r.code)).toMatch(/,\s*this,\s*(['"])this\.node\1\)$/);
    });
  });

  describe('flag OFF — historic 3-arg call (backwards compatible)', () => {
    test('omitted insertBefore → no mode arg', () => {
      const r = compileIE('{{#in-element this.dest}}<div>x</div>{{/in-element}}', false);
      const call = inElementCall(r.code);
      expect(call).toMatch(/,\s*this\)$/);
      expect(call).not.toMatch(/,\s*this,\s*[0-9"']/);
    });

    test('insertBefore=null is dropped (3-arg, unchanged) when flag OFF', () => {
      const r = compileIE('{{#in-element this.dest insertBefore=null}}<div>x</div>{{/in-element}}', false);
      expect(inElementCall(r.code)).toMatch(/,\s*this\)$/);
    });

    test('flag OFF byte-identical to the default (no EMBER_IN_ELEMENT key)', () => {
      const tpl = '{{#in-element this.dest insertBefore=null}}<div>x</div>{{/in-element}}';
      const off = compileIE(tpl, false).code;
      const def = compile(tpl, { flags: { ...BASE } }).code;
      expect(off).toBe(def);
    });
  });

  describe('multiple in-element blocks', () => {
    test('independent modes per block', () => {
      const tpl =
        '{{#in-element this.a}}<i>a</i>{{/in-element}}' +
        '{{#in-element this.b insertBefore=null}}<i>b</i>{{/in-element}}';
      const code = compileIE(tpl, true).code;
      // First call → CLEAR (1), second → APPEND (0)
      const first = code.indexOf('$_inElement(');
      const second = code.indexOf('$_inElement(', first + 1);
      const call1 = inElementCall(code.slice(first));
      const call2 = inElementCall(code.slice(second));
      expect(call1).toMatch(/,\s*this,\s*1\)$/);
      expect(call2).toMatch(/,\s*this,\s*0\)$/);
    });
  });
});
