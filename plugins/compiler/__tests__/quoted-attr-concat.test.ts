import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import { SYMBOLS } from '../serializers';

/**
 * EMBER_ATTR_CONCAT flag emission guard.
 *
 * Interpolated quoted attribute values (`class="a {{b}} c"`) serialize the
 * ConcatStatement through `buildConcat`. By default that emits the plain
 * `[...].join("")` string coercion; under the `EMBER_ATTR_CONCAT` flag it emits
 * `$_qStr([...])` (the Ember-dialect coercion helper) instead. The parts array
 * is identical either way — only the consuming call changes.
 */
describe('EMBER_ATTR_CONCAT emission', () => {
  const CLASS_TPL = '<div class="base {{this.active}} end"></div>';
  const TITLE_TPL = '<div title="{{this.x}}{{this.y}}"></div>';
  const SRC_TPL = '<img src="{{this.src}}">';

  describe('flag OFF (default) — byte-identical join emission', () => {
    test('multi-part quoted attr still emits [...].join("")', () => {
      const result = compile(CLASS_TPL);
      expect(result.errors).toHaveLength(0);
      // Pin today's exact concat shape.
      expect(result.code).toContain('["base ", this.active, " end"].join("")');
      expect(result.code).not.toContain('$_qStr');
    });

    test('two-getter quoted attr still emits [...].join("")', () => {
      const result = compile(TITLE_TPL);
      expect(result.code).toContain('[this.x, this.y].join("")');
      expect(result.code).not.toContain('$_qStr');
    });

    test('explicit EMBER_ATTR_CONCAT:false is byte-identical to the default', () => {
      const def = compile(CLASS_TPL).code;
      const off = compile(CLASS_TPL, { flags: { EMBER_ATTR_CONCAT: false } }).code;
      expect(off).toBe(def);
      expect(off).toContain('.join("")');
    });
  });

  describe('flag ON — $_qStr emission', () => {
    test('multi-part quoted attr emits $_qStr([...]) and drops .join', () => {
      const result = compile(CLASS_TPL, { flags: { EMBER_ATTR_CONCAT: true } });
      expect(result.errors).toHaveLength(0);
      expect(result.code).toContain(`${SYMBOLS.QUOTED_STR}(["base ", this.active, " end"])`);
      expect(result.code).not.toContain('.join("")');
    });

    test('two-getter quoted attr emits $_qStr([...])', () => {
      const result = compile(TITLE_TPL, { flags: { EMBER_ATTR_CONCAT: true } });
      expect(result.code).toContain(`${SYMBOLS.QUOTED_STR}([this.x, this.y])`);
      expect(result.code).not.toContain('.join("")');
    });

    test('single-getter quoted attr emits $_qStr([single]) (all-nullish → null path)', () => {
      const result = compile(SRC_TPL, { flags: { EMBER_ATTR_CONCAT: true } });
      expect(result.code).toContain(`${SYMBOLS.QUOTED_STR}([this.src])`);
    });

    test('the symbol emitted is $_qStr', () => {
      expect(SYMBOLS.QUOTED_STR).toBe('$_qStr');
    });
  });

  describe('flag ON is independent of IS_GLIMMER_COMPAT_MODE', () => {
    test('compat mode ON + EMBER_ATTR_CONCAT ON emits $_qStr', () => {
      const result = compile(CLASS_TPL, {
        flags: { EMBER_ATTR_CONCAT: true, IS_GLIMMER_COMPAT_MODE: true },
      });
      expect(result.code).toContain('$_qStr([');
    });

    test('compat mode OFF + EMBER_ATTR_CONCAT ON still emits $_qStr', () => {
      const result = compile(CLASS_TPL, {
        flags: { EMBER_ATTR_CONCAT: true, IS_GLIMMER_COMPAT_MODE: false },
      });
      expect(result.code).toContain('$_qStr([');
      expect(result.code).not.toContain('.join("")');
    });
  });

  describe('only quoted-attr concat is affected', () => {
    test('a static (non-interpolated) attribute is untouched by the flag', () => {
      const on = compile('<div class="static-only"></div>', {
        flags: { EMBER_ATTR_CONCAT: true },
      });
      // No ConcatStatement → no concat call at all.
      expect(on.code).not.toContain('$_qStr');
      expect(on.code).not.toContain('.join("")');
    });
  });
});
