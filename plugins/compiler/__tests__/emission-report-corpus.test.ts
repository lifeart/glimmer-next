/**
 * ANTI-REGRESSION emission-report parity corpus.
 *
 * Three report gaps in the ground-truth emission report (#250/#251) were found
 * ONLY by the downstream Ember consumer's full test gates, never by GXT's own
 * CI: an adapter dropped ground-truth flags (#246), the caller-only
 * `referencedBindings` field could not see a yielded bare `get(` (#251), and a
 * `globalThis.X` island root-reduced to the opaque bare `globalThis` (Task A).
 *
 * This corpus catches that class of gap in GXT's OWN CI. It compiles a broad
 * battery of EMBER-REALISTIC templates — every routing-relevant class the Ember
 * bridge keys off — under three flag combos, then asserts the INVARIANT that
 * makes the report trustworthy:
 *
 *   Every runtime symbol / `$_maybeHelper` name / ambient-global member / free
 *   identifier that a GENERIC reference scan can find in the EMITTED CODE is
 *   present in the corresponding report field.
 *
 * The scans are deliberately regex-based: in a TEST they are the independent
 * ORACLE (a second opinion on the emitted text), NOT production routing — the
 * whole point of the report is that the *consumer* never has to scan. If a scan
 * finds a name the report omits, that is a real collector gap to fix, exactly as
 * the three historical gaps would have surfaced here.
 *
 * Design of the oracle (kept faithful, i.e. neither over- nor under-strict):
 *   - String/template-literal contents and block comments are stripped before
 *     the identifier/callee scans so `word(` inside `"text (x)"` or the helper
 *     NAME string never counts as a call. `$_maybeHelper("name",…)` names are
 *     read from the UNSTRIPPED code (the name lives inside the string).
 *   - The compiler owns the whole `$`-namespace (runtime symbols + injected
 *     locals) and the `ctx<N>`/`$index`/`$n`/… block locals; those are excluded
 *     structurally. Only JS keywords, `ctx<N>`, and ambient host-runtime tokens
 *     are subtracted from the free-identifier scan. Ember keyword-helper bare
 *     calls (`get(`, `hash(`, …) ARE required — they are routing-relevant free
 *     identifiers the collector records (the #251 yielded `get(` case).
 */

import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import type { CompileResult } from '../types';
import { compileTemplate } from '../../runtime-compiler';
import { templateToTypescript } from '../adapter';
import { defaultFlags, type Flags } from '../../flags';

// ---------------------------------------------------------------------------
// Flag combos. Every shape runs under all three.
// ---------------------------------------------------------------------------
const COMBOS: Array<[string, Record<string, unknown>]> = [
  ['compat', { IS_GLIMMER_COMPAT_MODE: true }],
  ['compat+ember', { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true }],
  [
    'compat+ember+sync+concat',
    {
      IS_GLIMMER_COMPAT_MODE: true,
      WITH_EMBER_INTEGRATION: true,
      FORCE_SYNC_LIST: true,
      EMBER_ATTR_CONCAT: true,
    },
  ],
  // The Ember native layer's emission-affecting flags ($__tag taps, G3
  // `$_outlet`) — every shape must keep the report invariant under them too.
  [
    'ember-native',
    {
      IS_GLIMMER_COMPAT_MODE: true,
      WITH_EMBER_INTEGRATION: true,
      FORCE_SYNC_LIST: true,
      EMBER_ATTR_CONCAT: true,
      EMBER_NATIVE: true,
      EMBER_OUTLET: true,
    },
  ],
  // The full Ember native-layer flag set (with the helper / modifier managers):
  // G4 `$_maybeHelper(ref, args, named, ctx, site)`, literal-or-thunk
  // arguments, G9 curry sites, `$_maybeModifier(…, ctx)`, unbound `{{on}}`
  // as the Ember built-in modifier, `<@comp />` → `$_dc`, yield params built
  // against the block context.
  [
    'ember-native-managers',
    {
      IS_GLIMMER_COMPAT_MODE: true,
      WITH_EMBER_INTEGRATION: true,
      WITH_HELPER_MANAGER: true,
      WITH_MODIFIER_MANAGER: true,
      FORCE_SYNC_LIST: true,
      EMBER_ATTR_CONCAT: true,
      EMBER_IN_ELEMENT: true,
      EMBER_TRUSTED_HTML: true,
      EMBER_NATIVE: true,
      EMBER_OUTLET: true,
    },
  ],
];

function compileWith(
  tpl: string,
  flags: Record<string, unknown>,
  bindings: string[]
): CompileResult {
  return compile(tpl, { flags: flags as any, bindings: new Set(bindings) });
}

// ---------------------------------------------------------------------------
// Oracle: strip literals + comments so the identifier scans see only code.
// ---------------------------------------------------------------------------
function stripLiteralsAndComments(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    // Block comment /* ... */
    if (c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Line comment // ...
    if (c === '/' && code[i + 1] === '/') {
      i += 2;
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    // String / template literal — keep the delimiters, drop the contents.
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === quote) break;
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Compiler-owned `$`-locals & keys that are deliberately NOT reported as
// runtime symbols (mirror of NON_REPORTED_SYMBOL_VALUES + block locals). Used to
// widen the RHS of the runtime-symbol-callee scan.
const DOLLAR_LOCALS = new Set<string>([
  '$fw',
  '$slots',
  '$v',
  '$n',
  '$e',
  '$args',
  '$a',
  '$_scope',
  '$_eval',
  '$template',
  '$index',
]);

// JS keywords that can appear as bare `word(`-adjacent text but are never free
// template identifiers.
const JS_KEYWORDS = new Set<string>([
  'if', 'else', 'for', 'while', 'do', 'function', 'return', 'typeof', 'new',
  'in', 'instanceof', 'void', 'delete', 'switch', 'case', 'catch', 'try',
  'finally', 'throw', 'var', 'let', 'const', 'of', 'await', 'this', 'super',
  'class', 'extends', 'import', 'export', 'default', 'null', 'true', 'false',
  'undefined', 'yield', 'async',
]);

// Host-runtime globals that appear as bare identifiers/args but are ambient (not
// template free identifiers). Excluded from the free-identifier scan.
//
// NOTE: Ember keyword-helper locals (`get`, `hash`, `fn`, `unbound`, …) are
// deliberately NOT subtracted. They ARE routing-relevant free identifiers when
// emitted as bare calls (the #251 yielded `get(` case), and the collector now
// records them — including the nested ones inside a yielded sub-expression via
// `recordEmittedCode`. Requiring them makes the oracle strictly tighter; because
// `recordEmittedCode` extracts callees with the SAME rule this scan uses, any
// bare call that routes through the collector is guaranteed present, so a scan
// failure means a genuinely un-recorded emission path.
const HOST_RUNTIME_TOKENS = new Set<string>([
  '__ubCache',
  '__logSite',
  '__r',
]);

// ---------------------------------------------------------------------------
// The four generic scans. Each returns the set of scan hits it wants to verify.
// ---------------------------------------------------------------------------

/** `$X(` callees → must be in emittedSymbols ∪ DOLLAR_LOCALS. */
function scanRuntimeSymbolCallees(strippedCode: string): string[] {
  const hits: string[] = [];
  const re = /\$[A-Za-z_][A-Za-z0-9_]*(?=\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedCode)) !== null) hits.push(m[0]);
  return hits;
}

/** `$_maybeHelper("name"` → name must be in maybeHelperNames. Read UNSTRIPPED. */
function scanMaybeHelperNames(code: string): string[] {
  const hits: string[] = [];
  const re = /\$_maybeHelper\("((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) hits.push(m[1]);
  return hits;
}

/**
 * Bare `word(` callees not preceded by `.`/word/`$` → must be in
 * emittedIdentifiers, MINUS JS keywords / ctx-locals / host tokens.
 */
function scanFreeIdentifierCallees(strippedCode: string): string[] {
  const hits: string[] = [];
  const re = /(?:^|[^.\w$])([A-Za-z_][A-Za-z0-9_]*)(?=\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedCode)) !== null) {
    const name = m[1];
    if (JS_KEYWORDS.has(name)) continue;
    if (HOST_RUNTIME_TOKENS.has(name)) continue;
    if (/^ctx\d+$/.test(name)) continue;
    hits.push(name);
  }
  return hits;
}

/** `globalThis.X` / `window.X` members → must be in emittedIdentifiers. */
function scanAmbientGlobalMembers(strippedCode: string): string[] {
  const hits: string[] = [];
  const re = /(?:globalThis|window)\.([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(strippedCode)) !== null) hits.push(m[1]);
  return hits;
}

/** The report-bearing subset both compile() and compileTemplate() satisfy. */
type ReportBearing = Pick<
  CompileResult,
  'code' | 'errors' | 'emittedSymbols' | 'maybeHelperNames' | 'referencedBindings' | 'emittedIdentifiers'
>;

/**
 * Assert the whole invariant for one compiled result. Returns nothing; throws a
 * descriptive error (via expect) on the first violation, tagged with context.
 */
function assertReportInvariant(
  label: string,
  tpl: string,
  r: ReportBearing
): void {
  const ctx = `[${label}] ${JSON.stringify(tpl)}`;
  expect(r.errors, `${ctx} compiled without errors`).toHaveLength(0);

  const code = r.code;
  const stripped = stripLiteralsAndComments(code);

  const emittedSymbols = new Set(r.emittedSymbols);
  const emittedIdentifiers = new Set(r.emittedIdentifiers);
  const maybeHelperNames = new Set(r.maybeHelperNames);

  // Scan 1: runtime-symbol callees ⊆ emittedSymbols ∪ DOLLAR_LOCALS.
  for (const sym of scanRuntimeSymbolCallees(stripped)) {
    if (DOLLAR_LOCALS.has(sym)) continue;
    expect(
      emittedSymbols.has(sym),
      `${ctx}: runtime symbol \`${sym}(\` in code but MISSING from emittedSymbols ${JSON.stringify(r.emittedSymbols)}`
    ).toBe(true);
  }

  // Scan 2: $_maybeHelper("name") ⊆ maybeHelperNames.
  for (const name of scanMaybeHelperNames(code)) {
    expect(
      maybeHelperNames.has(name),
      `${ctx}: $_maybeHelper("${name}") in code but MISSING from maybeHelperNames ${JSON.stringify(r.maybeHelperNames)}`
    ).toBe(true);
  }

  // Scan 3: free-identifier callees ⊆ emittedIdentifiers.
  for (const name of scanFreeIdentifierCallees(stripped)) {
    expect(
      emittedIdentifiers.has(name),
      `${ctx}: free identifier \`${name}(\` in code but MISSING from emittedIdentifiers ${JSON.stringify(r.emittedIdentifiers)}`
    ).toBe(true);
  }

  // Scan 4: globalThis/window members ⊆ emittedIdentifiers (post Task A).
  for (const member of scanAmbientGlobalMembers(stripped)) {
    expect(
      emittedIdentifiers.has(member),
      `${ctx}: ambient-global member \`globalThis.${member}\` in code but MISSING from emittedIdentifiers ${JSON.stringify(r.emittedIdentifiers)}`
    ).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// THE CORPUS. [name, template, bindings]. Ember-realistic across every
// routing-relevant class.
// ---------------------------------------------------------------------------
const CORPUS: Array<[string, string, string[]]> = [
  // --- plain paths / text ---
  ['plain-text', '<div>hello world</div>', []],
  ['plain-path', '<p>{{this.name}}</p>', []],
  ['deep-path', '<p>{{this.a.b.c}}</p>', []],
  ['multiple-paths', '<div>{{this.a}} {{this.b}} {{this.c}}</div>', []],
  ['text-with-parens', '<div>call foo(x) now</div>', []],

  // --- attributes ---
  ['attr-quoted-single', '<div class="static"></div>', []],
  ['attr-quoted-multi', '<div class="a {{this.b}} c"></div>', []],
  ['attr-unquoted-path', '<div class={{this.c}}></div>', []],
  ['attr-boolean', '<input disabled />', []],
  ['attr-data', '<div data-test="x" data-id={{this.id}}></div>', []],
  ['attr-style-static', '<div style="color: red"></div>', []],
  ['attr-style-dynamic', '<div style={{this.styles}}></div>', []],
  ['attr-multiple-mixed', '<a href="/x" title={{this.t}} class="a {{this.c}}">go</a>', []],

  // --- each ---
  ['each-basic', '{{#each this.items as |it|}}<li>{{it.name}}</li>{{/each}}', []],
  ['each-index', '{{#each this.items as |it idx|}}<li>{{idx}}: {{it.name}}</li>{{/each}}', []],
  ['each-keyed', '{{#each this.items key="id" as |it|}}<li>{{it.name}}</li>{{/each}}', []],
  ['each-else', '{{#each this.items as |it|}}<li>{{it.n}}</li>{{else}}<p>empty</p>{{/each}}', []],
  [
    'each-nested',
    '{{#each this.rows as |r|}}{{#each r.cells as |c|}}<td>{{c}}</td>{{/each}}{{/each}}',
    [],
  ],
  ['each-in', '{{#each-in this.obj as |k v|}}<li>{{k}}={{v}}</li>{{/each-in}}', []],

  // --- if / unless ---
  ['if-block', '{{#if this.a}}<b>y</b>{{/if}}', []],
  ['if-else', '{{#if this.a}}<b>y</b>{{else}}<i>n</i>{{/if}}', []],
  ['if-elseif', '{{#if this.a}}A{{else if this.b}}B{{else}}C{{/if}}', []],
  ['if-inline', '<div>{{if this.a "yes" "no"}}</div>', []],
  ['unless-block', '{{#unless this.a}}<b>n</b>{{/unless}}', []],
  ['unless-inline', '<div>{{unless this.a "off"}}</div>', []],

  // --- yield ---
  ['yield-default', '<div>{{yield}}</div>', []],
  ['yield-named', '<div>{{yield to="body"}}</div>', []],
  ['yield-param', '<div>{{yield this.x}}</div>', []],
  ['yield-params', '<div>{{yield this.x this.y}}</div>', []],
  ['yield-hasblock', '<div>{{if (has-block) "y" "n"}}</div>', []],
  ['yield-hasblock-named', '<div>{{if (has-block "body") "y" "n"}}</div>', []],
  ['yield-hasblock-params', '<div>{{if (has-block-params) "y" "n"}}</div>', []],

  // --- outlet (G3: `$_outlet(ctx)` under EMBER_OUTLET, `$_slot` otherwise) ---
  ['outlet', '<main>{{outlet}}</main>', []],
  ['outlet-in-block', '<Layout>{{outlet}}</Layout>', ['Layout']],
  ['outlet-in-if', '{{#if this.a}}{{outlet}}{{/if}}', []],
  ['outlet-shadowed', '{{#let this.x as |outlet|}}<p>{{outlet}}</p>{{/let}}{{outlet}}', []],

  // --- Ember native-layer invocations (G4 / G9 / G-kw) ---
  ['native-helper-named', '<p>{{fmt this.a 2 k=this.b}}</p>', ['fmt']],
  ['native-helper-nested', '{{fmt (concat "a" this.b) (fmt this.c)}}', ['fmt', 'concat']],
  ['native-helper-unbound-kw', '{{neq this.a this.b}}{{(and this.a this.b)}}{{if (not this.c) "x"}}', []],
  ['native-modifier-args', '<div {{tagIt this.a (concat "x" this.b) k=this.c}}></div>', ['tagIt', 'concat']],
  ['native-on-imported', '<button {{on "click" (fn this.go 1)}}></button>', ['on', 'fn']],
  ['native-on-unbound', '<button {{on "click" this.go passive=true}}></button>', []],
  ['native-dynamic-modifier', '<div {{(if this.c (modifier tagIt 1)) this.x}}></div>', ['tagIt']],
  [
    'native-curry',
    '{{#let (component Cmp a=this.x) (helper fmt 1) (modifier tagIt) as |C H M|}}<C @b={{H 2}} {{M}} />{{/let}}',
    ['Cmp', 'fmt', 'tagIt'],
  ],
  ['native-yield-curry', '{{yield (hash title=(component Cmp a=this.y) v=(fmt this.z))}}', ['Cmp', 'fmt']],
  ['native-arg-component', '<@comp @a={{this.x}} />{{component @other b=1}}', []],

  // --- splattributes ---
  ['splat', '<div ...attributes>x</div>', []],
  ['splat-with-attr', '<div class="x" ...attributes>{{yield}}</div>', []],

  // --- components ---
  ['component-angle', '<Foo />', ['Foo']],
  ['component-angle-args', '<Foo @a={{this.x}} @b="y" />', ['Foo']],
  ['component-angle-block', '<Foo as |x|>{{x}}</Foo>', ['Foo']],
  ['component-curly', '{{foo-bar}}', []],
  ['component-curly-args', '{{foo-bar name=this.x}}', []],
  ['component-dynamic-helper', '{{component this.name}}', []],
  ['component-dynamic-angle', '<this.comp />', []],
  ['component-dotted', '<f.Item />', ['f']],
  [
    'component-curried',
    '{{#let (component "foo-bar") as |C|}}<C @a={{this.x}} />{{/let}}',
    [],
  ],

  // --- helpers ---
  ['helper-registry-body', '<div>{{my-helper this.a}}</div>', []],
  ['helper-subexpr', '<div>{{concat (my-helper this.a) "b"}}</div>', []],
  ['helper-nested-subexpr', '<div>{{my-outer (my-inner this.a) this.b}}</div>', []],
  // Yielded sub-expression lowers to a BARE call — a valid-identifier custom
  // helper (camelCase) so the emitted call is well-formed JS the scan can verify
  // (a kebab name here lowers to `my-helper(x)` = `my - helper(x)`, a separate
  // pre-existing codegen concern, not a report gap).
  ['helper-in-yield-camel', '{{yield (myHelper this.a)}}', []],
  // Yielded sub-expression with NESTED calls: the whole expression is serialized
  // to a string and wrapped in ONE B.id, so nested callees/symbols must still be
  // surfaced (regression guard for the smuggled-island gap).
  ['helper-in-yield-nested', '{{yield (concat (myHelper this.a) "b")}}', []],
  ['helper-in-yield-nested-outer', '{{yield (myOuter (myInner this.a))}}', []],
  ['builtin-in-yield-nested', '{{yield (if this.a (myHelper this.b) "n")}}', []],
  ['fn-in-yield-nested', '{{yield (fn this.act (myHelper this.a))}}', []],
  ['helper-named-arg-string-tag', '<Foo @x={{my-helper this.a}} />', []],
  ['helper-named-arg-known', '<Foo @x={{my-helper this.a}} />', ['Foo']],
  ['helper-in-attr', '<div class={{my-helper this.a}}></div>', []],
  ['helper-in-concat-attr', '<div class="a {{my-helper this.a}} b"></div>', []],
  ['helper-bound-binding', '<div>{{fmt this.a}}</div>', ['fmt']],

  // --- modifiers ---
  ['modifier-on', '<button {{on "click" this.handler}}>x</button>', []],
  ['modifier-on-fn', '<button {{on "click" (fn this.act 1)}}>x</button>', ['fn', 'on']],
  // Element modifier lowers to a BARE call; use a valid-identifier custom
  // modifier (see helper-in-yield-camel note).
  ['modifier-custom-camel', '<div {{myModifier this.a}}>x</div>', []],
  ['modifier-arg', '<div {{@myMod this.a}}>x</div>', []],

  // --- unbound (all four positions) ---
  ['unbound-mustache', '<div>{{unbound this.x}}</div>', []],
  ['unbound-yield-subexpr', '{{yield (unbound this.x)}}', []],
  ['unbound-concat-attr', '<div class="a {{unbound this.x}} b"></div>', []],
  ['unbound-attr', '<div title={{unbound this.x}}></div>', []],

  // --- unique-id / log ---
  ['unique-id-attr', '<div id={{unique-id}}></div>', []],
  ['log', '{{log this.a}}', []],
  ['log-with-helper', '{{log (my-helper this.a)}}', []],

  // --- in-element ---
  ['in-element', '{{#in-element this.dest}}<div>x</div>{{/in-element}}', []],
  [
    'in-element-insertbefore',
    '{{#in-element this.dest insertBefore=this.before}}<div>x</div>{{/in-element}}',
    [],
  ],

  // --- mut ---
  ['mut-mustache', '<div>{{mut this.x}}</div>', []],
  ['mut-named-arg', '<Foo @x={{mut this.x}} />', ['Foo']],

  // --- get ---
  ['get-yield', "{{yield (get this.x 'k')}}", []],
  ['get-bound-binding', '<div>{{get this.o "k"}}</div>', ['get']],
  ['get-subexpr', '<div>{{concat (get this.o "k") "z"}}</div>', ['get']],

  // --- let / with ---
  ['let-block', '{{#let this.x as |y|}}<span>{{y}}</span>{{/let}}', []],
  ['let-hash', '{{#let (hash a=1) as |h|}}{{h.a}}{{/let}}', ['hash']],
  ['with-block', '{{#with this.x as |y|}}<span>{{y}}</span>{{/with}}', []],

  // --- block params shadowing keyword-helper names ---
  // Uses valid-identifier keyword-helper names (`on`, `each`) — naming a param
  // after a JS reserved word (`if`) lowers to `let if =`, invalid JS unrelated
  // to the report.
  ['shadow-on', '{{#let this.x as |on|}}<span>{{on}}</span>{{/let}}', []],
  ['shadow-each', '{{#each this.items as |each|}}<li>{{each}}</li>{{/each}}', []],

  // --- scope bindings (used / unused / camelCase host word) ---
  ['binding-used', '<div>{{fmt this.a}}</div>', ['fmt']],
  ['binding-unused', '<div>{{this.a}}</div>', ['fmt']],
  ['binding-subexpr', '<div>{{concat (fmt this.a) "x"}}</div>', ['fmt']],
  ['binding-hostword', '{{#each (gxtEntriesOf this.o) as |e|}}{{e.k}}{{/each}}', ['gxtEntriesOf']],

  // --- mixed / strict-ish ---
  ['strict-mixed', '<Foo @a={{this.x}} @b={{my-helper this.y}} as |z|>{{z}}{{yield}}</Foo>', ['Foo']],
  [
    'kitchen-sink',
    '{{#each this.rows as |r i|}}<Row @r={{r}} class="a {{r.c}}" {{on "click" (fn this.pick r)}}>{{if r.ok (my-fmt r.v) "-"}}</Row>{{/each}}',
    ['Row', 'fn', 'on'],
  ],
];

describe('emission-report anti-regression corpus', () => {
  test(`corpus size is substantial (>= 60 shapes)`, () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(60);
  });

  for (const [name, tpl, bindings] of CORPUS) {
    for (const [comboName, flags] of COMBOS) {
      test(`${name} [${comboName}]`, () => {
        const r = compileWith(tpl, flags, bindings);
        assertReportInvariant(comboName, tpl, r);
      });
    }
  }

  // Prove the invariant also holds through the public compileTemplate() entry
  // (the exact surface the Ember host consumes), for a representative slice.
  describe('through compileTemplate()', () => {
    const SLICE = [
      '{{yield (unbound this.x)}}',
      '<div>{{unbound this.x}}</div>',
      '{{#if this.a}}<b>y</b>{{/if}}',
      "{{yield (get this.x 'k')}}",
      '<Foo @x={{my-helper this.a}} />',
      '{{#each this.items as |it|}}<li>{{it.n}}</li>{{/each}}',
    ];
    for (const tpl of SLICE) {
      test(`compileTemplate: ${JSON.stringify(tpl).slice(0, 50)}`, () => {
        const r = compileTemplate(tpl);
        assertReportInvariant('compileTemplate', tpl, r);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Adapter flag-forwarding (the #246 class): the converter-v2-compat bridge
  // `templateToTypescript(tpl, flags, …)` must forward the FULL host flag set
  // into compile(), not just IS_GLIMMER_COMPAT_MODE. #246 was a silent drop of
  // FORCE_SYNC_LIST / EMBER_ATTR_CONCAT, so the adapter kept emitting async
  // `$_each(` / plain `.join(` while the host thought it had opted in. Guard by
  // asserting the flag-specific symbol reaches the emitted code through the
  // adapter, and — crucially — that compile() and the adapter AGREE.
  // -------------------------------------------------------------------------
  describe('adapter flag-forwarding (#246 class)', () => {
    function flags(extra: Partial<Flags>): Flags {
      return { ...defaultFlags(), IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true, ...extra };
    }

    test('FORCE_SYNC_LIST reaches the adapter → $_eachSync (not $_each)', () => {
      const tpl = '{{#each this.items as |it|}}<li>{{it.n}}</li>{{/each}}';
      const off = templateToTypescript(tpl, flags({ FORCE_SYNC_LIST: false }), new Set());
      const on = templateToTypescript(tpl, flags({ FORCE_SYNC_LIST: true }), new Set());
      expect(off.errors).toHaveLength(0);
      expect(on.errors).toHaveLength(0);
      // Off: async list primitive. On: sync primitive. The flag must flip it.
      expect(/\$_each\(/.test(off.code)).toBe(true);
      expect(on.code).toContain('$_eachSync(');
      expect(/\$_each\(/.test(on.code)).toBe(false);
    });

    test('EMBER_ATTR_CONCAT reaches the adapter → $_qStr (not .join)', () => {
      const tpl = '<div class="a {{this.b}} c"></div>';
      const off = templateToTypescript(tpl, flags({ EMBER_ATTR_CONCAT: false }), new Set());
      const on = templateToTypescript(tpl, flags({ EMBER_ATTR_CONCAT: true }), new Set());
      expect(off.errors).toHaveLength(0);
      expect(on.errors).toHaveLength(0);
      expect(off.code).not.toContain('$_qStr(');
      expect(on.code).toContain('$_qStr(');
    });

    test('EMBER_OUTLET reaches the adapter → $_outlet (not $_slot)', () => {
      const tpl = '<main>{{outlet}}</main>';
      const off = templateToTypescript(tpl, flags({ EMBER_OUTLET: false }), new Set());
      const on = templateToTypescript(tpl, flags({ EMBER_OUTLET: true }), new Set());
      expect(off.errors).toHaveLength(0);
      expect(on.errors).toHaveLength(0);
      expect(off.code).not.toContain('$_outlet(');
      expect(on.code).toContain('$_outlet(this)');
      expect(on.code).not.toContain('$_slot(');
    });

    test('adapter code matches compile() code for the same flags', () => {
      const cases: Array<[string, Partial<Flags>]> = [
        ['{{#each this.items as |it|}}<li>{{it.n}}</li>{{/each}}', { FORCE_SYNC_LIST: true }],
        ['<div class="a {{this.b}} c"></div>', { EMBER_ATTR_CONCAT: true }],
        ['<div>{{unbound this.x}}</div>', {}],
        ['<main>{{outlet}}</main>', { EMBER_OUTLET: true }],
      ];
      for (const [tpl, extra] of cases) {
        const f = flags(extra);
        const adapted = templateToTypescript(tpl, f, new Set());
        const compiled = compile(tpl, { flags: f as any, bindings: new Set() });
        expect(adapted.code, `adapter vs compile: ${tpl}`).toBe(compiled.code);
      }
    });
  });
});
