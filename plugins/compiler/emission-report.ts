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
  return {
    emittedSymbols: new Set<string>(),
    maybeHelperNames: new Set<string>(),
    referencedBindings: new Set<string>(),
    emittedIdentifiers: new Set<string>(),
    callerBindings,
    maybeHelperInNamedArgPosition: false,
  };
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
  if (isReportableSymbol(name)) {
    report.emittedSymbols.add(name);
  }
  const root = referenceRootName(name);
  if (report.callerBindings.size > 0 && report.callerBindings.has(root)) {
    report.referencedBindings.add(root);
  }
  if (isEmittedFreeIdentifierHead(root)) {
    report.emittedIdentifiers.add(root);
  }
}
