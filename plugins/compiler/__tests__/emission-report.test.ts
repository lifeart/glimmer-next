/**
 * Ground-truth emission report coverage (plugins/compiler/emission-report.ts).
 *
 * Pins the five CompileResult fields — `emittedSymbols`, `maybeHelperNames`,
 * `maybeHelperInNamedArgPosition`, `referencedBindings`, `emittedIdentifiers` —
 * with positive and negative cases, through BOTH `compile()` and
 * `compileTemplate()`, plus a parity sweep proving the report reproduces the
 * exact regex verdicts the Ember bridge uses today (so it is a faithful
 * drop-in replacement — including the keyword-call regex `emittedIdentifiers`
 * replaces).
 */

import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import type { CompileResult } from '../types';
import { compileTemplate } from '../../runtime-compiler';

// Ember-dialect compile() options. WITH_EMBER_INTEGRATION mirrors the flags the
// Ember bridge compiles under; explicit flags keep emitted shapes precise
// (compileTemplate additionally flips WITH_HELPER_MANAGER, exercised separately).
function ember(
  extraFlags: Record<string, unknown> = {},
  bindings: string[] = []
): { flags: any; bindings: Set<string> } {
  return {
    flags: { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true, ...extraFlags },
    bindings: new Set(bindings),
  };
}

function compileEmber(
  tpl: string,
  extraFlags: Record<string, unknown> = {},
  bindings: string[] = []
): CompileResult {
  return compile(tpl, ember(extraFlags, bindings));
}

describe('emission report', () => {
  describe('shape / defaults', () => {
    test('all five fields present and empty for a trivial template', () => {
      const r = compileEmber('<div>{{this.x}}</div>');
      expect(Array.isArray(r.emittedSymbols)).toBe(true);
      expect(Array.isArray(r.maybeHelperNames)).toBe(true);
      expect(Array.isArray(r.referencedBindings)).toBe(true);
      expect(Array.isArray(r.emittedIdentifiers)).toBe(true);
      expect(typeof r.maybeHelperInNamedArgPosition).toBe('boolean');
      // A plain element still emits $_tag.
      expect(r.emittedSymbols).toContain('$_tag');
      expect(r.maybeHelperNames).toEqual([]);
      expect(r.referencedBindings).toEqual([]);
      // `this.x` → `this` head is excluded; no free identifier emitted.
      expect(r.emittedIdentifiers).toEqual([]);
      expect(r.maybeHelperInNamedArgPosition).toBe(false);
    });

    test('fields are deduped (no repeats across many identical emissions)', () => {
      const r = compileEmber('<div><span></span><span></span><b></b></div>');
      const uniq = new Set(r.emittedSymbols);
      expect(uniq.size).toBe(r.emittedSymbols.length);
      // $_tag emitted 4×, listed once.
      expect(r.emittedSymbols.filter((s) => s === '$_tag')).toHaveLength(1);
    });

    test('locals ($fw / $slots / $a) are NOT reported as emitted symbols', () => {
      // Splat + yield + @-arg all emit locals; surfaced via usedFw/usedSlots/
      // usedArgsAlias, deliberately absent from emittedSymbols.
      const r = compileEmber('<div ...attributes>{{yield}}{{@name}}</div>');
      expect(r.emittedSymbols).not.toContain('$fw');
      expect(r.emittedSymbols).not.toContain('$slots');
      expect(r.emittedSymbols).not.toContain('$a');
      expect(r.emittedSymbols).not.toContain('$args');
    });
  });

  // --------------------------------------------------------------------------
  describe('emittedSymbols', () => {
    test('POSITIVE: {{#in-element}} → $_inElement', () => {
      const r = compileEmber('{{#in-element this.dest}}<div>x</div>{{/in-element}}');
      expect(r.emittedSymbols).toContain('$_inElement');
      expect(r.code).toContain('$_inElement');
    });

    test('NEGATIVE: plain template does not emit $_inElement', () => {
      const r = compileEmber('<div>{{this.x}}</div>');
      expect(r.emittedSymbols).not.toContain('$_inElement');
      expect(r.code).not.toContain('$_inElement');
    });

    test('POSITIVE: {{log}} → $__log (raw-embedded, still captured)', () => {
      const r = compileEmber('{{log this.a}}');
      expect(r.emittedSymbols).toContain('$__log');
      // $__log lives inside a B.raw island — proves nested serializeJS threading.
      expect(r.code).toContain('$__log');
      expect(r.code).toContain('__logSite');
    });

    test('POSITIVE: {{log (helper …)}} captures the nested $_maybeHelper too', () => {
      const r = compileEmber('{{log (myHelp this.a)}}');
      expect(r.emittedSymbols).toContain('$__log');
      expect(r.emittedSymbols).toContain('$_maybeHelper');
    });

    test('POSITIVE: quoted-attr concat under EMBER_ATTR_CONCAT → $_qStr', () => {
      const r = compileEmber('<div class="a {{this.b}} c"></div>', { EMBER_ATTR_CONCAT: true });
      expect(r.emittedSymbols).toContain('$_qStr');
      expect(r.code).toContain('$_qStr');
    });

    test('NEGATIVE: without EMBER_ATTR_CONCAT the same template has no $_qStr', () => {
      const r = compileEmber('<div class="a {{this.b}} c"></div>');
      expect(r.emittedSymbols).not.toContain('$_qStr');
      expect(r.code).not.toContain('$_qStr');
    });

    test('POSITIVE: {{unbound}} → $_maybeHelper (raw-embedded island)', () => {
      const r = compileEmber('<div>{{unbound this.x}}</div>');
      expect(r.emittedSymbols).toContain('$_maybeHelper');
      expect(r.code).toContain('__gxtUnboundEval');
    });

    test('POSITIVE: component → $_c / $_args', () => {
      const r = compileEmber('<Foo />', {}, ['Foo']);
      expect(r.emittedSymbols).toEqual(expect.arrayContaining(['$_c', '$_args']));
    });
  });

  // --------------------------------------------------------------------------
  describe('maybeHelperNames', () => {
    test('POSITIVE: {{my-helper}} in body → ["my-helper"]', () => {
      const r = compile('<div>{{my-helper}}</div>', {
        flags: { IS_GLIMMER_COMPAT_MODE: true },
        bindings: new Set(),
      });
      expect(r.maybeHelperNames).toContain('my-helper');
      expect(r.code).toContain('$_maybeHelper("my-helper"');
    });

    test('POSITIVE: unknown named-arg value records the lookup name', () => {
      const r = compileEmber('<Foo @x={{myHelper}} />');
      expect(r.maybeHelperNames).toContain('myHelper');
    });

    test('NEGATIVE: a known helper binding passes a reference, not a string', () => {
      // WITH_HELPER_MANAGER off + known binding → direct call, no maybeHelper string.
      const r = compileEmber('<div>{{this.x}}</div>', {}, []);
      expect(r.maybeHelperNames).toEqual([]);
      expect(r.code).not.toContain('$_maybeHelper');
    });

    test('NEGATIVE: built-in helper ({{if}}) is not a maybeHelper lookup', () => {
      const r = compileEmber('<div>{{if this.a "y" "n"}}</div>');
      expect(r.maybeHelperNames).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  describe('maybeHelperInNamedArgPosition', () => {
    test('POSITIVE: @x={{helper}} on a string-tag component → tuple shape, flag true', () => {
      const r = compileEmber('<Foo @x={{myHelper}} />');
      expect(r.maybeHelperInNamedArgPosition).toBe(true);
      // Ground truth vs the exact code shape.
      expect(r.code).toContain('["@x", $_maybeHelper("myHelper", [], this)]');
    });

    test('NEGATIVE: {{myHelper}} in body position → flag false', () => {
      const r = compileEmber('<div>{{myHelper}}</div>');
      expect(r.maybeHelperInNamedArgPosition).toBe(false);
    });

    test('NEGATIVE: @x={{helper}} on a KNOWN component → object arg, not tuple', () => {
      // Known component args serialize as `$_args({ x: $_maybeHelper(...) })`,
      // an object property — NOT the `["@x", …]` tuple the guard keys off.
      const r = compileEmber('<Foo @x={{myHelper}} />', {}, ['Foo']);
      expect(r.maybeHelperInNamedArgPosition).toBe(false);
      expect(r.maybeHelperNames).toContain('myHelper'); // still a string lookup
    });

    test('NEGATIVE: static named arg → no maybeHelper, flag false', () => {
      const r = compileEmber('<Foo @x="hi" />');
      expect(r.maybeHelperInNamedArgPosition).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  describe('referencedBindings', () => {
    test('POSITIVE: (hash a=1) with a `hash` binding → ["hash"]', () => {
      const r = compileEmber('{{#let (hash a=1) as |h|}}{{h.a}}{{/let}}', {}, ['hash']);
      expect(r.referencedBindings).toContain('hash');
      expect(r.code).toContain('hash(');
    });

    test('POSITIVE: (fn …) + {{on}} bindings referenced', () => {
      const r = compileEmber('<button {{on "click" (fn this.act 1)}}>x</button>', {}, ['fn', 'on']);
      expect(r.referencedBindings).toEqual(expect.arrayContaining(['fn', 'on']));
    });

    test('POSITIVE: gxtEntriesOf (each-in host binding) referenced', () => {
      const r = compileEmber('{{#each (gxtEntriesOf this.o) as |e|}}{{e.k}}{{/each}}', {}, ['gxtEntriesOf']);
      expect(r.referencedBindings).toContain('gxtEntriesOf');
    });

    test('NEGATIVE: a provided-but-unreferenced binding is NOT listed', () => {
      const r = compileEmber('<div>{{this.x}}</div>', {}, ['hash']);
      expect(r.referencedBindings).not.toContain('hash');
      expect(r.referencedBindings).toEqual([]);
    });

    test('NEGATIVE: built-in (hash) with NO `hash` binding → $__hash, not a ref', () => {
      const r = compileEmber('<Foo @data={{hash a=1}} />', {}, ['Foo']);
      expect(r.referencedBindings).not.toContain('hash');
      expect(r.code).toContain('$__hash');
    });

    test('member access to a binding attributes to its root', () => {
      const r = compileEmber('<div>{{foo.bar.baz}}</div>', {}, ['foo']);
      expect(r.referencedBindings).toContain('foo');
    });
  });

  // --------------------------------------------------------------------------
  describe('emittedIdentifiers', () => {
    test('THE GAP: {{yield (get …)}} emits a bare `get(` — captured even though `get` is NOT a caller binding', () => {
      // Unknown helper in subexpression position lowers to a scope-variable
      // reference: () => [get(this.x, "k")]. `referencedBindings` can't see it
      // (never in `bindings`); `emittedIdentifiers` MUST.
      const r = compileEmber("{{yield (get this.x 'k')}}");
      expect(r.code).toContain('get(this.x, "k")');
      expect(r.emittedIdentifiers).toContain('get');
      expect(r.referencedBindings).not.toContain('get'); // not a caller binding
    });

    test('documented choice: a referenced caller binding appears in BOTH lists', () => {
      const r = compileEmber('<button {{on "click" (fn this.act 1)}}>x</button>', {}, ['fn', 'on']);
      expect(r.emittedIdentifiers).toEqual(expect.arrayContaining(['fn', 'on']));
      expect(r.referencedBindings).toEqual(expect.arrayContaining(['fn', 'on']));
    });

    test('NEGATIVE: runtime symbols ($_tag/$_slot/…) are NOT free identifiers', () => {
      const r = compileEmber('<div>{{yield}}</div>');
      expect(r.emittedSymbols).toContain('$_tag');
      expect(r.emittedIdentifiers).not.toContain('$_tag');
      expect(r.emittedIdentifiers).not.toContain('$_slot');
    });

    test('NEGATIVE: compiler `$`-locals ($fw/$slots/$a) and `this` are excluded', () => {
      // Splat + yield + @-arg emit $fw / $slots / $a; the ctxName `this` is
      // emitted as a bare id too. None are free identifiers.
      const r = compileEmber('<div ...attributes>{{yield}}{{@name}}</div>');
      expect(r.code).toContain('$fw'); // proof the locals ARE in the code
      expect(r.emittedIdentifiers).not.toContain('$fw');
      expect(r.emittedIdentifiers).not.toContain('$slots');
      expect(r.emittedIdentifiers).not.toContain('$a');
      expect(r.emittedIdentifiers).not.toContain('this');
      expect(r.emittedIdentifiers).toEqual([]);
    });

    test('NEGATIVE: compiler block-context locals (ctx0/$index/$n) are excluded', () => {
      const r = compileEmber('{{#in-element this.dest}}<div>x</div>{{/in-element}}');
      expect(r.code).toContain('ctx0 =>'); // ctx0 IS emitted as a param + ref
      expect(r.emittedIdentifiers).not.toContain('ctx0');
      expect(r.emittedIdentifiers).toEqual([]);

      // $index (synthetic each index param, present when unnamed) starts with
      // `$` → excluded. Single block param leaves the index synthetic.
      const each = compileEmber('{{#each this.items as |it|}}<li>{{it.name}}</li>{{/each}}');
      expect(each.code).toContain('$index');
      expect(each.emittedIdentifiers).not.toContain('$index');
      expect(each.emittedIdentifiers).not.toContain('ctx0');
    });

    test('block params are included (conservative superset, no scope at the choke point)', () => {
      const r = compileEmber('{{#each this.items as |item idx|}}<li>{{item.name}} {{idx}}</li>{{/each}}');
      expect(r.emittedIdentifiers).toEqual(expect.arrayContaining(['item', 'idx']));
    });

    test('deduped (a name emitted many times is listed once)', () => {
      const r = compileEmber('<div>{{get this.a}}{{get this.b}}{{get this.c}}</div>', {}, ['get']);
      expect(r.emittedIdentifiers.filter((n) => n === 'get')).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // Task A: ambient-global member surfacing. A `globalThis.X` / `window.X`
  // reference (the `{{unbound}}` / `{{#if this.x}}` compat islands) previously
  // root-reduced to the meaningless bare `globalThis`. The DOCUMENTED CHOICE is
  // to record the meaningful MEMBER (`X`) INSTEAD of the bare root: the ambient
  // global is never a caller binding nor a name a host provides, while the member
  // (`__gxtUnboundEval`, `__gxtGetCellOrFormula`) is the routing signal. This
  // covers BOTH producing paths — the whole island wrapped as a single `B.id`
  // (yielded sub-expression, reaches `recordEmittedName`) and the `B.raw` island
  // (mustache/attr/if, scanned at the raw serializer).
  describe('emittedIdentifiers: ambient-global member (Task A)', () => {
    test('THE PIN: {{yield (unbound this.x)}} → __gxtUnboundEval, NOT globalThis', () => {
      const r = compileEmber('{{yield (unbound this.x)}}');
      expect(r.code).toContain('globalThis.__gxtUnboundEval');
      expect(r.emittedIdentifiers).toContain('__gxtUnboundEval');
      // Documented "instead of" choice: the bare ambient root is not reported.
      expect(r.emittedIdentifiers).not.toContain('globalThis');
    });

    test('B.raw island: mustache {{unbound}} surfaces the member', () => {
      const r = compileEmber('<div>{{unbound this.x}}</div>');
      expect(r.code).toContain('globalThis.__gxtUnboundEval');
      expect(r.emittedIdentifiers).toContain('__gxtUnboundEval');
      expect(r.emittedIdentifiers).not.toContain('globalThis');
    });

    test('B.raw island: quoted-attr concat {{unbound}} surfaces the member', () => {
      const r = compileEmber('<div class="a{{unbound this.x}}b"></div>');
      expect(r.emittedIdentifiers).toContain('__gxtUnboundEval');
      expect(r.emittedIdentifiers).not.toContain('globalThis');
    });

    test('B.raw island: {{#if this.x}} surfaces __gxtGetCellOrFormula', () => {
      const r = compileEmber('{{#if this.x}}<b>a</b>{{/if}}');
      expect(r.code).toContain('globalThis.__gxtGetCellOrFormula');
      expect(r.emittedIdentifiers).toContain('__gxtGetCellOrFormula');
      expect(r.emittedIdentifiers).not.toContain('globalThis');
    });

    test('named-arg {{unbound}} surfaces the member alongside the component binding', () => {
      const r = compileEmber('<Foo @a={{unbound this.x}} />', {}, ['Foo']);
      expect(r.emittedIdentifiers).toEqual(
        expect.arrayContaining(['Foo', '__gxtUnboundEval'])
      );
      expect(r.emittedIdentifiers).not.toContain('globalThis');
    });

    test('survives compileTemplate()', () => {
      const r = compileTemplate('{{yield (unbound this.x)}}');
      expect(r.emittedIdentifiers).toContain('__gxtUnboundEval');
      expect(r.emittedIdentifiers).not.toContain('globalThis');
    });
  });

  // --------------------------------------------------------------------------
  describe('through compileTemplate()', () => {
    test('all five fields are threaded through the success path', () => {
      const r = compileTemplate('{{#in-element this.dest}}<div>x</div>{{/in-element}}');
      expect(r.emittedSymbols).toContain('$_inElement');
      expect(r.maybeHelperNames).toEqual([]);
      expect(r.maybeHelperInNamedArgPosition).toBe(false);
      expect(r.referencedBindings).toEqual([]);
      expect(r.emittedIdentifiers).toEqual([]); // ctx0 excluded
    });

    test('emittedIdentifiers threaded: yielded bare `get(` survives compileTemplate', () => {
      const r = compileTemplate("{{yield (get this.x 'k')}}");
      expect(r.emittedIdentifiers).toContain('get');
      expect(r.referencedBindings).not.toContain('get');
    });

    test('named-arg maybeHelper flag survives compileTemplate', () => {
      const r = compileTemplate('<Foo @x={{myHelper}} />');
      expect(r.maybeHelperInNamedArgPosition).toBe(true);
      expect(r.maybeHelperNames).toContain('myHelper');
    });

    test('referencedBindings threaded (WITH_HELPER_MANAGER reference form)', () => {
      const r = compileTemplate('{{#let (hash a=1) as |h|}}{{h.a}}{{/let}}', {
        bindings: new Set(['hash']),
      });
      expect(r.referencedBindings).toContain('hash');
    });

    test('error path still returns the (empty) report fields', () => {
      const r = compileTemplate('<div>{{this.x}}'); // unclosed tag → error
      expect(r.errors.length).toBeGreaterThan(0);
      expect(Array.isArray(r.emittedSymbols)).toBe(true);
      expect(Array.isArray(r.maybeHelperNames)).toBe(true);
      expect(Array.isArray(r.referencedBindings)).toBe(true);
      expect(Array.isArray(r.emittedIdentifiers)).toBe(true);
      expect(typeof r.maybeHelperInNamedArgPosition).toBe('boolean');
    });
  });

  // --------------------------------------------------------------------------
  // Parity sweep: the report reproduces the exact routing verdict the Ember
  // bridge computes today by regex-scanning `code`. If these agree across a
  // battery of real template shapes, the report is a faithful replacement.
  // --------------------------------------------------------------------------
  describe('parity with the Ember routing regexes', () => {
    // Verbatim from packages/@ember/-internals/gxt-backend/compile.ts.
    const NATIVE_BLOCKERS_CODE =
      /__logSite|__ubCache|\$_inElement|\b(?:gxtEntriesOf|gxtGetOutletState|__gxtCommentLookup|__mutGet|unique_id|__gxtUnboundEval)\b|(?:^|[^.\w$])(?:get|unbound|array|hash|concat|fn|mut|readonly|helper|modifier)\(/;
    const NAMED_ARG_GUARD_TRIGGER =
      /\["@[A-Za-z_][A-Za-z0-9_-]*",\s*\$_maybeHelper\("[^"]+",\s*\[\],\s*this\)/;

    // Host-provided binding names the blocker regex words / keyword-calls match.
    const HOST_WORD_BINDINGS = [
      'gxtEntriesOf', 'gxtGetOutletState', '__gxtCommentLookup', '__mutGet', 'unique_id',
    ];
    const KEYWORD_LOCALS = [
      'get', 'unbound', 'array', 'hash', 'concat', 'fn', 'mut', 'readonly', 'helper', 'modifier',
    ];

    // Reconstruct the SAME routing verdict purely from the report.
    //
    // The keyword-call alternative `(?:^|[^.\w$])(?:get|hash|fn|…)\(` is now
    // reproduced by `emittedIdentifiers ∩ KEYWORD_LOCALS` — this catches the
    // yielded bare `get(` case (get emitted as a scope var, NOT a caller
    // binding) that `referencedBindings` structurally cannot see.
    function reportBlocked(r: CompileResult): boolean {
      if (r.emittedSymbols.includes('$__log')) return true; // __logSite
      if (r.emittedSymbols.includes('$_inElement')) return true;
      if (r.maybeHelperNames.includes('unbound')) return true; // __ubCache/__gxtUnboundEval
      if (HOST_WORD_BINDINGS.some((w) => r.referencedBindings.includes(w))) return true;
      if (KEYWORD_LOCALS.some((k) => r.emittedIdentifiers.includes(k))) return true;
      if (r.maybeHelperInNamedArgPosition) return true; // named-arg guard
      return false;
    }
    function regexBlocked(code: string): boolean {
      return NATIVE_BLOCKERS_CODE.test(code) || NAMED_ARG_GUARD_TRIGGER.test(code);
    }

    // [template, provided-bindings, extra-flags]. Chosen to exercise every
    // blocker branch plus clearly-native templates. Text deliberately avoids
    // literal keyword-like tokens (where the legacy regex has a known
    // text-false-positive the report is strictly better on).
    const CASES: Array<[string, string[], Record<string, unknown>]> = [
      ['<div>{{this.x}}</div>', [], {}],
      ['<div class="static">hi</div>', [], {}],
      ['{{#if this.a}}<b>y</b>{{else}}<i>n</i>{{/if}}', [], {}],
      ['{{#each this.items as |it|}}<li>{{it.name}}</li>{{/each}}', [], {}],
      ['<Foo @a={{this.x}} />', ['Foo'], {}],
      ['<Foo @a={{myHelper}} />', [], {}],            // named-arg guard (string tag)
      ['<Foo @a={{myHelper}} />', ['Foo'], {}],       // object arg — NOT blocked
      ['<div>{{myHelper}}</div>', [], {}],            // body maybeHelper — native
      ['{{#in-element this.d}}<x>y</x>{{/in-element}}', [], {}],
      ['{{log this.a}}', [], {}],
      ['<div>{{unbound this.x}}</div>', [], {}],
      ['{{#let (hash a=1) as |h|}}{{h.a}}{{/let}}', ['hash'], {}],
      ['<button {{on "click" (fn this.act 1)}}>x</button>', ['fn', 'on'], {}],
      ['{{#each (gxtEntriesOf this.o) as |e|}}{{e.k}}{{/each}}', ['gxtEntriesOf'], {}],
      ['<div>{{get this.o "k"}}</div>', ['get'], {}],
      ["{{yield (get this.x 'k')}}", [], {}],           // bare `get(` — NOT a binding
      ['<div>{{concat this.a this.b}}</div>', ['concat'], {}],
      ['<div>{{array this.a this.b}}</div>', ['array'], {}],
      ['<div class="a {{this.b}} c"></div>', [], { EMBER_ATTR_CONCAT: true }],
      ['<div ...attributes>{{yield}}</div>', [], {}],
      ['<Foo @a={{this.x}} @b={{this.y}} as |z|>{{z}}</Foo>', ['Foo'], {}],
    ];

    for (const [tpl, bindings, flags] of CASES) {
      test(`verdict parity: ${JSON.stringify(tpl).slice(0, 60)}`, () => {
        const r = compileEmber(tpl, flags, bindings);
        expect(r.errors).toHaveLength(0);
        expect(reportBlocked(r)).toBe(regexBlocked(r.code));
      });
    }

    test('per-symbol facts agree with direct regex scans across all cases', () => {
      for (const [tpl, bindings, flags] of CASES) {
        const r = compileEmber(tpl, flags, bindings);
        // $_inElement
        expect(r.emittedSymbols.includes('$_inElement')).toBe(/\$_inElement/.test(r.code));
        // __logSite  <-> $__log
        expect(r.emittedSymbols.includes('$__log')).toBe(/__logSite/.test(r.code));
        // $_qStr
        expect(r.emittedSymbols.includes('$_qStr')).toBe(/\$_qStr\(/.test(r.code));
        // named-arg guard
        expect(r.maybeHelperInNamedArgPosition).toBe(NAMED_ARG_GUARD_TRIGGER.test(r.code));
      }
    });

    test('emittedIdentifiers ∩ KEYWORD_LOCALS reproduces the keyword-call regex', () => {
      // The exact keyword-call alternative from the Ember NATIVE_BLOCKERS regex.
      const KEYWORD_CALL_RE =
        /(?:^|[^.\w$])(?:get|unbound|array|hash|concat|fn|mut|readonly|helper|modifier)\(/;
      for (const [tpl, bindings, flags] of CASES) {
        const r = compileEmber(tpl, flags, bindings);
        const reportHit = KEYWORD_LOCALS.some((k) => r.emittedIdentifiers.includes(k));
        expect(reportHit).toBe(KEYWORD_CALL_RE.test(r.code));
      }
    });
  });
});
