/**
 * `@lifeart/gxt/recycle` — opt-in row-recycling runtime entry.
 *
 * The recycle machinery (control-flow/list-recycle.ts, ~0.95KB br) is kept OUT
 * of the main `.` barrel and the runtime-compiler default symbol set so it
 * tree-shakes away from apps that never use `{{#each items key="@recycle"}}`.
 * The compiler emits `$_eachRecycled` / `$_eachSyncRecycled` for the sentinel
 * key:
 *   - AOT (plugins/babel.ts) auto-imports them from THIS entry, and only when a
 *     compiled template actually uses `key="@recycle"`.
 *   - Runtime-compiled templates resolve them from globalThis; call
 *     `registerRecycleRuntime()` once before rendering a recycled template
 *     (mirrors `setupGlobalScope()` in the runtime compiler, which no longer
 *     registers the recycle symbols).
 */
export {
  $_eachRecycled,
  $_eachSyncRecycled,
  RECYCLE_KEY,
} from './control-flow/list-recycle';

import {
  $_eachRecycled,
  $_eachSyncRecycled,
} from './control-flow/list-recycle';

/**
 * Install the recycle entry points on `globalThis` for the runtime-compiled
 * template path. The runtime compiler's `setupGlobalScope()` deliberately
 * omits them (so the recycle runtime stays tree-shakable), so standalone apps
 * that compile `key="@recycle"` templates at runtime must call this once before
 * the first render. Idempotent — safe to call multiple times.
 */
export function registerRecycleRuntime(): void {
  const g = globalThis as Record<string, unknown>;
  g.$_eachRecycled = $_eachRecycled;
  g.$_eachSyncRecycled = $_eachSyncRecycled;
}
