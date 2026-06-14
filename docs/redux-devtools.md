# Redux DevTools integration

gxt can stream its reactive state to the
[Redux DevTools browser extension](https://github.com/reduxjs/redux-devtools)
so you can inspect every live cell on a timeline and **time-travel** through past
states while developing.

It is **opt-in, development-only, and browser-only**. In production / library
builds the whole feature tree-shakes away (it is gated on `IS_DEV_MODE`, which is
inlined to `false`), so it has zero cost for shipped apps.

## Enabling

Install the Redux DevTools extension in your browser, then opt in once at app
startup:

```ts
import { enableReduxDevtools } from '@lifeart/gxt';

if (IS_DEV_MODE) {
  enableReduxDevtools();
}
```

`enableReduxDevtools(config?)` returns a disabler:

```ts
const disable = enableReduxDevtools({ name: 'My App', maxAge: 100 });
// ...later
disable();
```

It is safe to call unconditionally — when the extension is not installed, the
code runs in SSR/Node, or the build is production, it simply returns a no-op
disabler and installs nothing.

The `config` argument accepts the standard
[DevTools options](https://github.com/reduxjs/redux-devtools/blob/main/extension/docs/API/Arguments.md)
(`name`, `maxAge`, `features`, `serialize`, …). gxt provides sensible defaults
(`name: 'GXT Reactive State'`, `maxAge: 50`, `jump`/`skip` enabled).

## What state is exposed

The state **mirrors the gxt component tree** — human-readable and diff-friendly,
not a flat cell dump:

```jsonc
{
  "Application#1": {
    "Benchmark#7": {
      "$state": { "_selected": 5, "_items": [ /* ... */ ] },
      "Row#42": { "$state": { "label": "foo" } },
      "Row#43": { "$state": { "label": "bar" } }
    }
  },
  "$globals": { "theme#3": "dark" }
}
```

- Each node is labelled `<ClassName>#<id>`. The id is stable while the component
  is alive, so key paths stay stable across snapshots and the extension's diff
  view highlights exactly the changed leaf.
- A node's **own** reactive cells live under `$state` (property name → value),
  read from `cellsMap.get(node)` — the component's own data cells. Child
  components are nested directly under the node.
- The walk reads the live component tree (`TREE` / `CHILD` / `PARENT`) and each
  node's `cellsMap`; it **never** reads the strong `DEBUG_CELLS` set for the
  per-component path. Components removed from `TREE` by their destructor are
  therefore **absent by construction** — no retention, no dead-component soup.
- Cells with no live tree owner (module-level `cell()`, list-item cells,
  `@tracked` on plain objects) go in a separate, labelled **`$globals`** bucket.
  Cells owned by a component that is no longer in `TREE` are excluded from
  `$globals` too, so a torn-down component leaves zero trace anywhere.
- Derived `MergedCell`s recompute from their dependencies and are not restorable,
  so they are intentionally **omitted** (data cells are the primary, restorable
  state). `cellsMap` only ever holds data `Cell`s, so this falls out for free.

Every cell change is coalesced per microtask (matching gxt's own
`scheduleRevalidate` batching) so a 1000-row update is a single timeline entry.

## Action timeline

Each timeline entry's `type` tells the story of what changed instead of a generic
`cells:changed`:

| Scenario | Example `type` |
| --- | --- |
| one change | `set Benchmark._selected` |
| several cells, one component | `update Row#42 (3 cells)` |
| several components | `update Row#42 +2 more (3 cells)` |
| large batch | `update: 100 cells` |

The action carries a structured payload for the inspector:

```jsonc
{ "type": "set Benchmark._selected", "count": 1,
  "changes": [{ "path": "Benchmark#7._selected", "from": 5, "to": 9 }] }
```

`from`/`to` are the start-of-batch → end-of-batch transition (non-primitive
values are shown as a light summary like `Array(1000)`; the full value lives in
the state snapshot). The `changes` array is capped (with a `truncated` count) so
a huge batch stays light in the inspector.

## Time-travel (backward **and** forward)

When you JUMP / ROLLBACK / RESET in the monitor, the integration navigates the
tree-shaped target state in parallel with the **live** component tree — matching
nodes by their stable `#<id>` label — and restores each leaf via
`applyCellUpdateSync`, re-rendering the bound DOM **synchronously**. Because the
key paths are stable across the whole session, a JUMP to **any** index works
whether you step backward (undo) or forward (redo).

`applyCellUpdateSync` bypasses `Cell.update`, so restoring does **not**
re-dispatch back to the monitor (no feedback loop). An `isDevToolsRestoring()`
guard provides defence-in-depth against a subscriber that writes back during
restore.

Handled monitor messages: `JUMP_TO_STATE`, `JUMP_TO_ACTION`, `ROLLBACK`, `RESET`,
`COMMIT`, `IMPORT_STATE`. `COMMIT` resets the baseline to the current state;
`RESET` restores the committed (initial) snapshot.

## Design / cost model

- **Hot path.** The only reactive-core touchpoint is a single guarded call in
  `Cell.update()` / `applyDeferredCellUpdate()`:

  ```ts
  if (IS_DEV_MODE && _devtoolsCellNotifier !== null && changed) {
    _devtoolsCellNotifier(this, prevValue);
  }
  ```

  - Lib / production: `IS_DEV_MODE` → `false`, the branch (and every reference
    that would pull the redux-devtools module into the bundle) is removed.
  - Dev, DevTools off: a single predictable `!== null` check, no allocation.
    `prevValue` is the same single `_value` read the change check already needs,
    captured in a local — zero extra hot-path work.
  - Dev, DevTools on: forwards the changed cell + its old value to the coalescing
    sender. All tree-walking and label-building happen at snapshot time, never on
    this path.

- **No new registries; no retention.** The per-component path walks the live
  tree + `cellsMap` and reuses `DEBUG_CELLS` only for the `$globals` bucket. The
  integration holds nothing across snapshots: the coalescing buffer (`_changed`)
  is cleared on every flush, and `disableReduxDevtools()` detaches the notifier,
  buffers, subscription, connection and committed baseline with zero residue.

- **Tree-shakable.** Verified by building the lib (`IS_DEV_MODE` inlined to
  `false`) and grepping the dist: zero references to `__REDUX_DEVTOOLS_EXTENSION__`,
  `$globals`, `supportChromeExtension`, the snapshot/restore walk, etc. A consumer
  bundle of `import { cell } from '@lifeart/gxt'` therefore contains none of the
  integration.

## Lower-level / Freezer-style API

For parity with classic redux-store bindings the `src/core/redux-devtools`
module also exports a faithful port of the freezer-redux-devtools enhancer:
`supportChromeExtension(state, config?)`, `FreezerMiddleware(state)`, and a
`createCellState()` helper that returns a `FreezerState` backed by gxt cells.
These are not re-exported from the package's public entry — import them from the
module directly when working inside the framework. Most apps should prefer
`enableReduxDevtools()`; the enhancer API is an escape hatch.

```ts
import {
  supportChromeExtension,
  createCellState,
} from '@/core/redux-devtools';

const store = supportChromeExtension(createCellState());
```

## Caveats

- **`$globals` is the one pre-existing dev-only unbounded set.** The per-component
  tree is leak-free by construction (it reads the live `TREE`). `$globals` is
  sourced from `DEBUG_CELLS`, which accumulates every cell created during a dev
  session (existing gxt behaviour — data cells have no `destroy()` hook). The
  bucket is *bounded relative to the old flat dump*: tree-owned cells and cells
  owned by torn-down components are both excluded, so what remains is genuine
  module-level / list-item / plain-object state. It can still grow over a long
  session. This is a dev-only memory characteristic, not a correctness issue.
- **Id reuse.** Node labels use the component id, which gxt recycles via
  `releaseId` after destruction. Time-travel matches nodes by id, so a state
  captured for a component that was later destroyed *and whose id was reused by a
  different component* could in principle restore onto the wrong node. Restores
  onto stable (still-alive) components — the common time-travel case — are exact.
- **List growth = diff noise.** An array-valued cell (e.g. `_items`) is included
  in full in every snapshot, so growing a 1000-row list shows a large diff. The
  trade is deliberate: the full value is the most useful thing to inspect and
  restore.
- **Derived values are omitted.** `MergedCell` / `formula` / `cached` values are
  recomputed from their deps and aren't restorable, so they don't appear in the
  state. Inspect them via the component's data cells instead.
- Only primitive-ish cell values serialize cleanly. Cells holding complex
  objects/functions are subject to the extension's own serialization limits;
  use the `serialize` config option to customise.
