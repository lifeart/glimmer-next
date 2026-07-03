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
 * Four independent facts are collected:
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
    callerBindings,
    maybeHelperInNamedArgPosition: false,
  };
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
 *     in `emittedSymbols`, and
 *   - a reference whose head is a caller-provided binding lands in
 *     `referencedBindings`.
 * Both checks are independent; a name can satisfy neither, either, or (in
 * principle) both. Deduplication is handled by the underlying Sets.
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
  if (report.callerBindings.size > 0) {
    const root = referenceRootName(name);
    if (report.callerBindings.has(root)) {
      report.referencedBindings.add(root);
    }
  }
}
