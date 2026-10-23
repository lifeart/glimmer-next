/**
 * DRAFT / R9 (ember.js#21340 C22): the root template is assembled DETACHED and
 * only inserted into the live document AFTER the whole template has evaluated,
 * so a `{{#in-element (document.getElementById "target")}}` whose destination is
 * a sibling rendered earlier in the SAME root render sees `null` — the host's
 * `_emberInElement` then asserts "You cannot pass a null or undefined
 * destination element to in-element".
 *
 * `renderComponent` does `component()` (build, detached) THEN `renderElement()`
 * (insert). `$_fin` only stashes the roots on `RENDERED_NODES_PROPERTY`; no node
 * reaches the live document until the separate mount pass. gxt already defers
 * in-element resolution to the mount hook for the NATIVE runtime
 * (`deferToMount = isNativeRuntime()`), but the Ember COMPAT path resolves the
 * destination during build through the host's own `_emberInElement`, so the
 * mount-defer does not help it.
 *
 * Fix (see PR description): insert the root template's nodes into their parent
 * AS THEY ARE BUILT (streaming / append-as-you-go), the way nested renders
 * attach, so `getElementById` during the same render pass sees earlier
 * siblings. These todos pin the target behaviour; they are unskipped once the
 * streaming root render lands (validated by #21340 C22 in Ember CI).
 */
import { describe, test } from 'vitest';

describe('streaming root render (R9 / C22) — DRAFT', () => {
  test.todo(
    'a sibling rendered earlier in the root template is findable by getElementById during the same render',
  );
  test.todo(
    'in-element targeting an earlier-rendered sibling attaches its content (no null-destination assertion)',
  );
});
