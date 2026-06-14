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

It also accepts a few **gxt-only** knobs (stripped before reaching the
extension) that control snapshot size:

| Option | Default | Effect |
| --- | --- | --- |
| `maxArrayItems` | `50` | Arrays longer than this are replaced in the snapshot with a compact `$summary` marker instead of dumping every element. |
| `maxValueBytes` | `8192` | Rough byte budget for one cell value. Strings / objects / nested arrays whose estimated size exceeds it are summarized. |
| `maxValueDepth` | `4` | Nesting depth past which a value is treated as too big. |
| `cellsDenylist` | `[]` | Path globs/prefixes whose cells are **excluded entirely** from the snapshot *and* the action timeline (high-frequency / noisy cells). |

```ts
enableReduxDevtools({
  maxArrayItems: 50,
  cellsDenylist: ['*.animationFrame', 'Benchmark#*._items'],
});
```

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

## Big-value summaries (keeping the inspector light)

A large cell value — e.g. a list's `_items: Array(1000)` — would otherwise dump
every element into the state inspector and produce a huge diff on every change.
Instead, any value over the configured caps is replaced **in the snapshot only**
with a compact summary marker:

```jsonc
// _items: Array(1000)  ->
{ "$summary": "Array(1000)", "$len": 1000, "$preview": [0, 1, 2, 3, 4] }
// a big object ->
{ "$summary": "Foo(120 keys)", "$keys": 120, "$preview": { /* first few */ } }
// a big string ->
{ "$summary": "String(40000)", "$len": 40000, "$preview": "first 64 chars…" }
```

The preview reuses gxt's existing `inspect()` formatter for non-primitive items,
so it stays small and bounded. Summarization happens **only at snapshot time**
(when DevTools is connected) — there is zero cost on the `Cell.update` hot path.

**Restore trade-off (important).** A summarized value is *not* the real value, so
it is **not restorable**. Time-travel (`restoreState`) **skips** any cell whose
snapshot value is a `$summary` marker — it never writes the marker back into the
cell, which would corrupt it. The practical effect:

- Cells **under** the caps keep their real value and are **fully time-travel
  restorable** (including small arrays/objects).
- A summarized large collection becomes **inspect-only**: you can see its
  shape/preview on the timeline, but a JUMP leaves its live runtime value
  untouched (it keeps whatever the app currently holds, never a `{$summary}`
  object). To make a specific big collection restorable again, raise
  `maxArrayItems` / `maxValueBytes`, or keep it small.

## Excluding noisy cells (`cellsDenylist`)

In the spirit of the extension's `actionsDenylist`, `cellsDenylist` is a list of
path globs/prefixes whose cells are excluded from the snapshot **and** the action
timeline entirely. This is for high-frequency / noisy cells (e.g. an
`animationFrame` counter that ticks every frame) that would otherwise flood the
monitor.

- `*` matches any run of characters; a prefix matches any deeper path
  (`Benchmark#4` denylists every cell under it).
- A cell's path is `<Class>#<id>.<prop>` (e.g. `Benchmark#7._items`); `$globals`
  cells match on their `<debugName>#<id>` key.
- A batch consisting *only* of denylisted cells emits **no** timeline entry at
  all — that is the de-noising point.
- Denylisted cells are absent from the snapshot, so (like summaries) they are
  not restored by time-travel. Remove the pattern to bring a cell back.

## Live edit + DOM highlight (Dispatcher actions)

The DevTools "Dispatcher" panel lets you send custom actions to the page. Two
are handled:

### `SET` — write a cell live

```jsonc
{ "type": "SET", "path": "Benchmark#4._selected", "value": "7" }
```

Resolves `path` against the live component tree the same way time-travel does
(matching `<Class>#<id>` nodes), then writes the cell via `applyCellUpdateSync`
under the restore guard — so the app re-renders immediately and the write does
**not** echo back as a new timeline action. `value` arrives as a string and is
`JSON.parse`d (falling back to the raw string if it isn't valid JSON). A path
that doesn't resolve, or an obvious type mismatch, is surfaced via a dev
`console.warn` **and** the monitor's error channel — never silently swallowed.

### `HIGHLIGHT` — flash a component's DOM

```jsonc
{ "type": "HIGHLIGHT", "path": "Row#5" }
```

Resolves the component and draws a temporary overlay (outline + subtle fill,
`scrollIntoView` if offscreen) over its bounds — `getBounds(component)`, the same
bridge gxt's Ember-inspector uses — that auto-removes after ~1s. A single overlay
element is reused and is cleaned up on `disableReduxDevtools()`.

### Auto-flash on change

When a `SET` or a time-travel `JUMP` actually changes one or more components,
their DOM is briefly flashed with the same overlay so you can SEE what moved in
the page. It is debounced via the single overlay element and **skipped** when a
change touches more than a handful of components (so a 1000-row batch never
strobes the screen). Ordinary app-driven updates are **not** flashed.

> **Honest limitation.** The Redux DevTools protocol does **not** notify the page
> when you click a node in the state-tree inspector, so true
> "select-in-tree → highlight" is impossible. gxt delivers the explicit
> `HIGHLIGHT` dispatch action and auto-flash-on-change instead — there is no
> click-to-highlight.

All overlay/DOM code is browser- and dev-only (`typeof document !== 'undefined'`
+ `IS_DEV_MODE`) and tree-shakes out of the library build.

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
- **Big collections are inspect-only.** An array-valued cell over `maxArrayItems`
  (or any value over `maxValueBytes`) is summarized in the snapshot
  (`{ $summary: "Array(1000)", … }`) to keep the inspector light. Such a cell is
  no longer time-travel-restorable (restore skips the marker; the live value is
  kept intact, never corrupted). Raise the caps to make a specific collection
  restorable again. Cells under the caps keep their real value and round-trip.
- **Derived values are omitted.** `MergedCell` / `formula` / `cached` values are
  recomputed from their deps and aren't restorable, so they don't appear in the
  state. Inspect them via the component's data cells instead.
- Only primitive-ish cell values serialize cleanly. Cells holding complex
  objects/functions are subject to the extension's own serialization limits;
  use the `serialize` config option to customise.
