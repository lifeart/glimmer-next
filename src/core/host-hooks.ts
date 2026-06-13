/**
 * Host-integration hooks.
 *
 * A host renderer embedding GXT (e.g. the Ember dual-backend integration)
 * historically extended the runtime through optional `globalThis.__gxt*`
 * slots — mutable cross-realm state that masks dual-module-copy bugs and is
 * invisible to bundlers. The hooks live here as module-local slots behind an
 * explicit registration API instead. Every runtime call site reads the hook
 * slot FIRST and falls back to the historical global, so hosts running the
 * legacy wiring keep working unchanged.
 *
 * Register once at host module init:
 *
 * ```ts
 * import { registerHostHooks } from '@lifeart/gxt';
 * registerHostHooks({ toBool: emberToBool, scheduleRevalidate: syncNow });
 * ```
 */
export interface HostHooks {
  /**
   * Truthiness override for `{{#if}}`-style conditionals (e.g. Ember's
   * toBool semantics: `[]` is falsy, `isHTMLSafe('')` is truthy, …).
   * Replaces `globalThis.__gxtToBool`.
   */
  toBool?: (value: unknown) => boolean;
  /**
   * When installed, the runtime delegates revalidation scheduling to the
   * host, which becomes responsible for calling `syncDom()` at the right
   * time; the built-in async scheduler is bypassed. Replaces
   * `globalThis.__gxtExternalSchedule` (see also `takeRenderingControl`).
   */
  scheduleRevalidate?: () => void;
  /**
   * Observe keyed-list / const-if anchor markers as they are created so the
   * host can re-associate row state across re-renders. Replaces
   * `globalThis.__gxtRegisterListMarker`.
   */
  registerListMarker?: (marker: Comment) => void;
  /**
   * Unregister keyed-list anchor markers on list teardown (the converse of
   * `registerListMarker`). Replaces `globalThis.__gxtUnregisterListMarker`.
   */
  unregisterListMarker?: (marker: Comment) => void;
  /**
   * Re-bind a keyed row's block param to a NEW object in place when a
   * ref-swap reused the row by a stale key — preserves DOM identity.
   * Replaces `globalThis.__gxtRebindEachItem`.
   */
  rebindEachItem?: (oldItem: unknown, newItem: unknown) => void;
  /**
   * Register a leaf object held by a tracked cell as a value-owner of that
   * cell (host reverse-lookup so `set(leafObj, key, …)` can reach the
   * cell). Replaces `globalThis.__gxtRegisterObjectValueOwner`.
   */
  registerObjectValueOwner?: (
    value: object,
    relatedObj: object,
    relatedKey: string,
  ) => void;
  /**
   * The `this` of the currently-evaluating runtime-compiled template, used
   * to materialize absent-path cells. Replaces
   * `globalThis.__gxtCurrentTemplateThis` (which the host had to mutate
   * around every template evaluation — with the hook the host keeps that
   * state module-local).
   */
  getCurrentTemplateThis?: () => unknown;
  /**
   * Brand check / brand mark for host "functional helpers" — plain
   * functions invoked as `(positional, named) => value` rather than
   * spread-args. Replaces the `EmberFunctionalHelpers` global Set.
   */
  isFunctionalHelper?: (fn: unknown) => boolean;
  markFunctionalHelper?: (fn: unknown) => void;
  /**
   * Dynamic-eval fallback for compiled-template identifier resolution when
   * the render context doesn't carry `$_eval` (initial render). Replaces
   * the `globalThis.$_eval` fallback read.
   */
  dynamicEval?: (value: unknown) => unknown;
}

/**
 * Internal read path for runtime call sites. Intentionally a plain mutable
 * object (not getters) — these slots sit on hot paths (per-row list-marker
 * registration, per-conditional toBool).
 */
export const HOST_HOOKS: HostHooks = {};

/**
 * Merge the given hooks into the active slot table. Later registrations
 * override earlier ones per-key; passing `undefined` for a key is ignored
 * (use an explicit no-op function to disable a default the host set
 * earlier).
 */
export function registerHostHooks(hooks: HostHooks): void {
  for (const key of Object.keys(hooks) as Array<keyof HostHooks>) {
    const value = hooks[key];
    if (value !== undefined) {
      (HOST_HOOKS as Record<string, unknown>)[key] = value;
    }
  }
  // Cross-instance host-presence sentinel. HOST_HOOKS is module-local, so a
  // consumer bundled into a different entry chunk (e.g. the list frame-mode
  // gate) sees its OWN empty copy. This single globalThis flag — set true the
  // first time any host registers hooks — is visible regardless of how many
  // times the package is instantiated, restoring the cross-instance property
  // the legacy `globalThis.__gxt*` hook slots had.
  (globalThis as Record<string, unknown>).__gxtHostHooksInstalled = true;
}

/**
 * Functional-helper brand check, hook-first with the legacy
 * `EmberFunctionalHelpers` bare-global Set as fallback. Hosts should
 * register `isFunctionalHelper` and `markFunctionalHelper` together.
 */
export function isHostFunctionalHelper(fn: unknown): boolean {
  if (HOST_HOOKS.isFunctionalHelper) {
    return HOST_HOOKS.isFunctionalHelper(fn);
  }
  return (
    // @ts-expect-error EmberFunctionalHelpers legacy global
    typeof EmberFunctionalHelpers !== 'undefined' &&
    // @ts-expect-error EmberFunctionalHelpers legacy global
    EmberFunctionalHelpers.has(fn)
  );
}

export function markHostFunctionalHelper(fn: unknown): void {
  if (HOST_HOOKS.markFunctionalHelper) {
    HOST_HOOKS.markFunctionalHelper(fn);
    return;
  }
  // @ts-expect-error EmberFunctionalHelpers legacy global
  if (typeof EmberFunctionalHelpers !== 'undefined') {
    // @ts-expect-error EmberFunctionalHelpers legacy global
    EmberFunctionalHelpers.add(fn);
  }
}
