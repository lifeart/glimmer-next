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

State is read from the existing dev-only `DEBUG_CELLS` registry — the set of all
live **data cells** (`cell(...)`, `cellFor(...)`, `@tracked` fields). It does
**not** introduce a parallel registry. Each cell is keyed by a stable, unique
`"<debugName>#<id>"` string (derived formulas / `MergedCell`s are not part of the
serialized state; they are recomputed from their dependencies).

Every cell change is coalesced per microtask (matching gxt's own
`scheduleRevalidate` batching) and sent to the monitor as one `cells:changed`
action carrying a full snapshot, so a 1000-row update is a single timeline entry.

## Time-travel

When you JUMP / ROLLBACK / RESET in the monitor, the integration restores each
cell's `_value` and re-renders the bound DOM **synchronously**, via
`applyCellUpdateSync`. That path bypasses `Cell.update`, so restoring does **not**
re-dispatch back to the monitor (no feedback loop). An `isDevToolsRestoring()`
guard provides defence-in-depth against a subscriber that writes back during
restore.

Handled monitor messages: `JUMP_TO_STATE`, `JUMP_TO_ACTION`, `ROLLBACK`, `RESET`,
`COMMIT`, `IMPORT_STATE`.

## Design / cost model

- **Hot path.** The only reactive-core touchpoint is a single guarded call in
  `Cell.update()` / `applyDeferredCellUpdate()`:

  ```ts
  if (IS_DEV_MODE && _devtoolsCellNotifier !== null && changed) {
    _devtoolsCellNotifier(this);
  }
  ```

  - Lib / production: `IS_DEV_MODE` → `false`, the branch (and every reference
    that would pull the redux-devtools module into the bundle) is removed.
  - Dev, DevTools off: a single predictable `!== null` check, no allocation.
  - Dev, DevTools on: forwards the changed cell to the coalescing sender.

- **No new registries.** Enumeration reuses `DEBUG_CELLS`.

- **Tree-shakable.** Verified: a consumer bundle of `import { cell } from
  '@lifeart/gxt'` contains none of the integration (no `__REDUX_DEVTOOLS_EXTENSION__`,
  `supportChromeExtension`, `cells:changed`, …).

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

- `DEBUG_CELLS` accumulates every cell created during a dev session (existing gxt
  behaviour — data cells have no `destroy()` hook). The state tree therefore
  grows over a long session and may include cells whose owning components were
  torn down. This is a dev-only memory characteristic, not a correctness issue.
- Only primitive-ish cell values serialize cleanly. Cells holding complex
  objects/functions are subject to the extension's own serialization limits;
  use the `serialize` config option to customise.
