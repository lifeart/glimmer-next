/**
 * Ground-truth Emission Report
 *
 * A flat, cheap, serializer-collected record of *what the compiler actually
 * emitted* for a single template. It exists so that host integrations (most
 * importantly the Ember bridge) never have to regex the generated `code`
 * string to route a template — the exact facts they need are surfaced as data
 * on `CompileResult`.
 *
 * This is the same ground-truth-flags discipline already used for
 * `usedRecycle` (#235) and `usedArgsAlias`/`usedSlots`/`usedFw` (#237), taken
 * to its conclusion: the last consumer that still string-scans the output can
 * now read structured fields instead.
 *
 * Five independent facts are collected:
 *
 *  - `emittedSymbols` — the runtime symbol names ($_tag, $_c, $_inElement,
 *    $__log, $_qStr, …) that were actually written into the output as calls or
 *    references. Collected at the single serializer emission choke point
 *    (`builder/serialize.ts`, where every identifier / runtime-ref becomes
 *    text), so no build site can be missed.
 *  - `maybeHelperNames` — the string literals passed as the first argument of
 *    emitted `$_maybeHelper("name", …)` calls (the unresolved-name lookups).
 *    Collected at the two build sites that construct the string form.
 *  - `maybeHelperInNamedArgPosition` — `true` when a string-form
 *    `$_maybeHelper(…)` emission lands as a NAMED-ARG value in the args tuple
 *    (`["@name", $_maybeHelper("n", [], this)]`). Collected where the tuple is
 *    built, which is where the position is known.
 *  - `referencedBindings` — which of the caller-provided `bindings` the
 *    template actually referenced (emitted as identifiers). Collected at the
 *    same emission choke point as `emittedSymbols`.
 *  - `emittedIdentifiers` — every FREE identifier head emitted as a
 *    reference/call that is NOT a `$`-namespace name (runtime symbols `$_*`/
 *    `$__*` AND compiler locals `$a`/`$fw`/`$slots`/`$v`/`$n`/… — the whole
 *    compiler-owned prefix), NOT a compiler block-context local (`ctx0`,
 *    `ctx1`, …), and NOT `this`/a JS keyword/literal. Collected at the SAME
 *    choke point as `emittedSymbols`/`referencedBindings`, so it catches names
 *    that were never in `bindings` — e.g. `{{yield (get this.x 'k')}}` emits a
 *    bare `get(...)` call, and `get` lands here even though it is not a
 *    caller-provided binding. See `isEmittedFreeIdentifierHead`.
 */

import { escapeBindingName } from './utils/js-utils';

/**
 * The mutable collector threaded through compilation. Sets are deduped by
 * construction; the boolean latches to `true` on first hit.
 */
export interface EmissionReport {
  /** Runtime symbol names emitted as calls/references (deduped). */
  readonly emittedSymbols: Set<string>;
  /** First-arg string literals of emitted `$_maybeHelper(` calls (deduped). */
  readonly maybeHelperNames: Set<string>;
  /** Caller-provided bindings that were referenced (emitted) (deduped). */
  readonly referencedBindings: Set<string>;
  /**
   * Free identifier heads emitted as references/calls, minus the compiler's
   * own `$`-namespace, `ctx<N>` block-context locals, and `this`/keywords
   * (deduped). Includes caller-provided-binding references (they also appear
   * in `referencedBindings`) and template block params — a conservative
   * superset. See `isEmittedFreeIdentifierHead`.
   */
  readonly emittedIdentifiers: Set<string>;
  /**
   * The caller-provided binding names (the initial `CompileOptions.bindings`).
   * Membership is tested at emission time to decide `referencedBindings`.
   * Frozen snapshot — never mutated.
   */
  readonly callerBindings: ReadonlySet<string>;
  /**
   * The caller-provided bindings that are emitted under another identifier
   * (`escapeBindingName`: `some-helper` → `__bp_some$2d$helper`, `debugger` →
   * `__bp_debugger`), by that identifier: a reference to one is reported
   * under the binding's own name.
   */
  readonly escapedCallerBindings: ReadonlyMap<string, string>;
  /** True once a string-form `$_maybeHelper` emission lands in named-arg position. */
  maybeHelperInNamedArgPosition: boolean;
}

/**
 * Create an empty report for one compilation.
 *
 * @param callerBindings - The initial `CompileOptions.bindings` (or empty).
 */
export function createEmissionReport(
  callerBindings: ReadonlySet<string> = new Set()
): EmissionReport {
  const escapedCallerBindings = new Map<string, string>();
  for (const name of callerBindings) {
    const emitted = escapeBindingName(name);
    if (emitted !== name) escapedCallerBindings.set(emitted, name);
  }
  return {
    emittedSymbols: new Set<string>(),
    maybeHelperNames: new Set<string>(),
    referencedBindings: new Set<string>(),
    emittedIdentifiers: new Set<string>(),
    callerBindings,
    escapedCallerBindings,
    maybeHelperInNamedArgPosition: false,
  };
}

/** The caller-provided binding an emitted identifier head references, if any. */
function callerBindingOf(report: EmissionReport, head: string): string | undefined {
  if (report.callerBindings.has(head)) return head;
  return report.escapedCallerBindings.get(head);
}

/**
 * Identifier heads that are NOT free helper/binding references even though
 * they can be emitted as bare identifier text: `this` and the JS keyword/
 * literal words. (Literals like `true`/`null`/`undefined` are normally emitted
 * as literal nodes and never reach the choke point; listed here defensively so
 * the field never leaks a keyword.) The compiler `$`-namespace and the
 * `ctx<N>` block-context locals are excluded structurally in
 * `isEmittedFreeIdentifierHead`, not by enumeration.
 */
const NON_FREE_IDENTIFIER_HEADS: ReadonlySet<string> = new Set<string>([
  'this',
  'true',
  'false',
  'null',
  'undefined',
  'NaN',
  'Infinity',
  'arguments',
  'void',
  'typeof',
  'new',
  'in',
  'instanceof',
  'function',
  'return',
]);

/**
 * True when an emitted identifier *head* (already reduced via
 * `referenceRootName`) is a FREE identifier the host may have to provide —
 * i.e. it is emitted as a bare reference/call and is NOT:
 *   - a `$`-prefixed compiler name (runtime symbols `$_*`/`$__*` AND compiler
 *     locals `$a`/`$fw`/`$slots`/`$v`/`$n`/`$args`/`$template`/… — the whole
 *     compiler-owned prefix collapses to one cheap check),
 *   - a compiler block-context local (`ctx0`, `ctx1`, … from `nextContextName`),
 *   - `this` or a JS keyword/literal.
 * Anything else that is a syntactically valid identifier head qualifies, which
 * includes caller-provided bindings and template block params (a conservative
 * superset — over-reporting only routes a host to its safe legacy path).
 */
export function isEmittedFreeIdentifierHead(root: string): boolean {
  if (!root) return false;
  // Must be a plain JS identifier head (excludes numeric/computed/bracket forms
  // that `referenceRootName` may hand back untouched).
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root)) return false;
  // The compiler owns the entire `$` prefix: runtime symbols + injected locals.
  if (root.charCodeAt(0) === 36 /* '$' */) return false;
  // Compiler-generated block-context locals (ctx0, ctx1, …).
  if (/^ctx\d+$/.test(root)) return false;
  // `this` and JS keyword/literal words are not free references.
  if (NON_FREE_IDENTIFIER_HEADS.has(root)) return false;
  return true;
}

/**
 * Extract the head identifier of an emitted reference so a member/bracket/
 * optional-chained access to a binding (`foo.bar`, `foo["x"]`, `foo?.y`) is
 * still attributed to the root binding `foo`.
 */
export function referenceRootName(name: string): string {
  // Stop at the first `.`, `[`, `?`, or `(` — everything before is the head.
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c === '.' || c === '[' || c === '?' || c === '(') {
      return name.slice(0, i);
    }
  }
  return name;
}

/**
 * Ambient host globals that are smuggled into emitted code only as the *object*
 * of a member access — never as a caller-provided binding or a name a host must
 * supply. The `{{unbound}}` compat island `globalThis.__gxtUnboundEval(...)` and
 * the `{{#if this.x}}` compat island `globalThis.__gxtGetCellOrFormula?.(...)`
 * are the current producers. Reducing such a reference to its bare root
 * (`globalThis`) swallows the one meaningful, routing-relevant token — the
 * MEMBER (`__gxtUnboundEval`, `__gxtGetCellOrFormula`). See Task A / #250 report.
 */
const AMBIENT_GLOBAL_ROOTS: ReadonlySet<string> = new Set<string>([
  'globalThis',
  'window',
]);

/** Matches `globalThis.<member>` / `window.<member>` and captures `<member>`. */
const AMBIENT_GLOBAL_MEMBER_RE =
  /(?:globalThis|window)\.([A-Za-z_$][A-Za-z0-9_$]*)/g;

/**
 * Record the meaningful *member* head(s) of every ambient-global access found in
 * a chunk of emitted code (`globalThis.X` / `window.X` → `X`). Threaded from two
 * kinds of emission that bypass the per-identifier choke point:
 *   - a whole `globalThis.__gxtUnboundEval(...)` island wrapped as a single
 *     `B.id` (yielded `{{unbound}}` sub-expression — reaches `recordEmittedName`
 *     with the ENTIRE island as `name`), and
 *   - a `B.raw` island (mustache/attr `{{unbound}}`, `{{#if this.x}}` compat
 *     wrapper — never reaches `recordEmittedName` at all).
 * A cheap `indexOf` guard skips the regex for the overwhelming majority of code
 * that contains no ambient global. Only members that are plain identifier heads
 * are recorded (`isEmittedFreeIdentifierHead`), so the field never leaks a
 * `$`-name or keyword.
 */
export function recordAmbientGlobalMembers(
  report: EmissionReport | undefined,
  code: string
): void {
  if (!report) return;
  if (code.indexOf('globalThis.') === -1 && code.indexOf('window.') === -1) {
    return;
  }
  for (const m of code.matchAll(AMBIENT_GLOBAL_MEMBER_RE)) {
    const member = m[1];
    if (isEmittedFreeIdentifierHead(member)) {
      report.emittedIdentifiers.add(member);
    }
  }
}

/**
 * Strip the CONTENTS of string / template literals (keeping the delimiters) so a
 * `word(` that lives inside a literal (attribute text, a helper NAME string) is
 * never mistaken for a call. A compact escape-aware state machine; the input is
 * always the compiler's own freshly-serialized output.
 */
function stripLiteralsForScan(code: string): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < n) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === c) break;
        i++;
      }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** `$X(` runtime-symbol callees. */
const SYMBOL_CALLEE_RE = /\$[A-Za-z_][A-Za-z0-9_]*(?=\()/g;
/** Bare `word(` callees not preceded by `.`/word/`$`. */
const BARE_CALLEE_RE = /(?:^|[^.\w$])([A-Za-z_][A-Za-z0-9_]*)(?=\()/g;
/** First-arg string of `$_maybeHelper("name"`. */
const MAYBE_HELPER_NAME_RE = /\$_maybeHelper\("((?:[^"\\]|\\.)*)"/g;

/**
 * Record every reportable name found in an already-serialized CODE island.
 *
 * The string-form value serializer (yielded sub-expressions, …) serializes a
 * whole sub-expression to TEXT and wraps it in a SINGLE `B.id`, so the
 * per-identifier choke point would otherwise see only the outermost token and
 * swallow every NESTED callee/symbol/maybeHelper-name/ambient-member — e.g.
 * `{{yield (concat (myHelper this.a) "b")}}` emits `concat(myHelper(this.a),"b")`
 * where `myHelper` (and, for `(if …)`/`(fn …)`, the nested `$__if`/`$__fn`) were
 * dropped. This is a bounded scan of the compiler's OWN emitted text — it feeds
 * the ground-truth report so the CONSUMER never has to scan; it is not host
 * routing. Callee scans run on literal-stripped text; `$_maybeHelper` names are
 * read from the raw text (they live inside the string literal).
 */
export function recordEmittedCode(
  report: EmissionReport | undefined,
  code: string,
  isReportableSymbol: (name: string) => boolean
): void {
  if (!report) return;
  const stripped = stripLiteralsForScan(code);
  // Runtime-symbol callees → emittedSymbols.
  for (const m of stripped.matchAll(SYMBOL_CALLEE_RE)) {
    if (isReportableSymbol(m[0])) report.emittedSymbols.add(m[0]);
  }
  // Free-identifier callees → referencedBindings (caller binding) + emittedIdentifiers.
  for (const m of stripped.matchAll(BARE_CALLEE_RE)) {
    const nm = m[1];
    const binding = report.callerBindings.size > 0 ? callerBindingOf(report, nm) : undefined;
    if (binding !== undefined) {
      report.referencedBindings.add(binding);
    }
    if (isEmittedFreeIdentifierHead(nm)) report.emittedIdentifiers.add(nm);
  }
  // $_maybeHelper("name") lookups → maybeHelperNames.
  for (const m of code.matchAll(MAYBE_HELPER_NAME_RE)) {
    report.maybeHelperNames.add(m[1]);
  }
  // Ambient-global members (globalThis.X / window.X) → emittedIdentifiers.
  recordAmbientGlobalMembers(report, stripped);
}

/**
 * Record an emitted identifier / runtime-ref name into the report. Called from
 * the serializer's single emission choke point (builder/serialize.ts) for every
 * identifier and runtime-ref that becomes text, so:
 *   - a reportable runtime symbol ($_tag, $_maybeHelper, $_inElement, …) lands
 *     in `emittedSymbols`,
 *   - a reference whose head is a caller-provided binding lands in
 *     `referencedBindings`, and
 *   - a free (non-`$`-namespace, non-`ctx<N>`, non-`this`/keyword) identifier
 *     head lands in `emittedIdentifiers`.
 * The checks are independent; a name can satisfy any combination — e.g. a
 * referenced caller binding lands in BOTH `referencedBindings` and
 * `emittedIdentifiers`, while a bare unknown helper (`get`) lands only in
 * `emittedIdentifiers`. Deduplication is handled by the underlying Sets.
 */
export function recordEmittedName(
  report: EmissionReport | undefined,
  name: string,
  isReportableSymbol: (name: string) => boolean
): void {
  if (!report) return;
  // Compound-expression smuggle: the string-form value serializer wraps a whole
  // serialized sub-expression in ONE `B.id`, so a `name` carrying call syntax is
  // really a CODE island, not an identifier. Record all names it contains (nested
  // callees/symbols/maybeHelper-names/ambient-members) instead of just its root.
  // (Subsumes the ambient-island B.id case, e.g. `globalThis.__gxtUnboundEval(…)`.)
  if (name.indexOf('(') !== -1) {
    recordEmittedCode(report, name, isReportableSymbol);
    return;
  }
  if (isReportableSymbol(name)) {
    report.emittedSymbols.add(name);
  }
  const root = referenceRootName(name);
  const binding = report.callerBindings.size > 0 ? callerBindingOf(report, root) : undefined;
  if (binding !== undefined) {
    report.referencedBindings.add(binding);
  }
  // Ambient-global member smuggle (Task A): when the head reduces to an ambient
  // host global (`globalThis`/`window`) the reference is really a member access
  // whose OBJECT is that global — e.g. the whole `globalThis.__gxtUnboundEval(…)`
  // island wrapped as one `B.id` (yielded `{{unbound}}`). The bare root is
  // meaningless for routing, so record the meaningful member(s) INSTEAD of the
  // root. (`recordAmbientGlobalMembers` scans the full `name`, catching every
  // member in a multi-access island.)
  if (AMBIENT_GLOBAL_ROOTS.has(root)) {
    recordAmbientGlobalMembers(report, name);
    return;
  }
  if (isEmittedFreeIdentifierHead(root)) {
    report.emittedIdentifiers.add(root);
  }
}
