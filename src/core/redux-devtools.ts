/**
 * Redux DevTools browser-extension integration for gxt's reactive core.
 *
 * Bridges gxt's reactive state to the Redux DevTools extension
 * (`window.__REDUX_DEVTOOLS_EXTENSION__`) so the whole COMPONENT TREE shows up on
 * the DevTools timeline and supports time-travel debugging: a JUMP in the
 * monitor restores every recorded data cell to its value and re-renders the
 * bound DOM, WITHOUT re-dispatching back to the monitor — backward AND forward.
 *
 * What you see in the monitor
 * ===========================
 * Instead of a flat `"<debugName>#<id>": value` dump, the state mirrors the gxt
 * component tree, human-readable and diff-friendly:
 *
 *   {
 *     "Application#1": {
 *       "Benchmark#7": {
 *         "$state": { "_selected": 5, "_items": [ ... ] },
 *         "Row#42": { "$state": { "label": "foo" } },
 *         "Row#43": { "$state": { "label": "bar" } }
 *       }
 *     },
 *     "$globals": { "theme#3": "dark" }
 *   }
 *
 *   * Each node is labelled `<ClassName>#<id>` (id is stable while the component
 *     is alive, so key paths stay stable across snapshots and the extension's
 *     diff view highlights exactly the changed leaf).
 *   * A node's OWN reactive cells live under `$state` (property name -> value),
 *     read from `cellsMap.get(node)` — NOT from the strong `DEBUG_CELLS` set, so
 *     destroyed components (removed from `TREE` by their destructor) are absent
 *     by construction. No retention, no dead-component soup.
 *   * Cells with no live tree owner (module-level `cell()`, list-item cells,
 *     `@tracked` on plain objects) go in a separate, labelled `$globals` bucket.
 *     Cells owned by a component that is no longer in `TREE` are excluded from
 *     `$globals` too — a torn-down component leaves zero trace.
 *   * Derived `MergedCell`s recompute from their deps and are not restorable, so
 *     they are intentionally OMITTED from the state (`cellsMap` only ever holds
 *     data `Cell`s, so this falls out for free). Data cells are the primary,
 *     restorable state.
 *
 * Action timeline
 * ===============
 * Each timeline entry's `type` tells a story about what changed rather than a
 * generic `cells:changed`:
 *   * one change   -> `"set Benchmark._selected"`
 *   * one owner    -> `"update Row#42 (3 cells)"`
 *   * many owners  -> `"update Row#42 +2 more (3 cells)"`
 *   * large batch  -> `"update: 100 cells"`
 * with a structured payload (`{ count, changes: [{ path, from, to }] }`) so the
 * action inspector is informative. Per-microtask coalescing is preserved (a
 * 1000-row update is one entry), and the coalesced label still describes it.
 *
 * Cost model
 * ==========
 * The feature is strictly DEV-ONLY and browser-only:
 *   * `enableReduxDevtools()` no-ops (returns a no-op disabler) unless
 *     `IS_DEV_MODE` is true, a `window` exists, and the extension is installed.
 *   * The only hot-path touchpoint — `Cell.update()`'s `_devtoolsCellNotifier`
 *     call — is guarded by `IS_DEV_MODE && notifier !== null && changed`. In a
 *     lib / production build `IS_DEV_MODE` is inlined to `false`, so that branch
 *     (and hence every reference that would pull THIS module into the bundle)
 *     folds away. When DevTools is simply not enabled in dev it costs one
 *     predictable null check. The tree-walk + label-building happen ONLY at
 *     snapshot time (DevTools connected), never on the cell-update hot path.
 *     Result: this whole module tree-shakes out of production consumer bundles.
 *
 * Two transports
 * ==============
 *  1. `enableReduxDevtools()` — the recommended modern integration. Uses the
 *     extension's `connect()` API (`init` / `send` / `subscribe`) which handles
 *     JUMP_TO_STATE / JUMP_TO_ACTION / ROLLBACK / RESET / COMMIT cleanly.
 *  2. `supportChromeExtension()` + `FreezerMiddleware` — a faithful port of the
 *     classic Freezer-style redux-store enhancer binding. Kept for parity with
 *     the original integration and as a lower-level escape hatch; wire it to the
 *     cell state with `createCellState()`.
 */
import {
  DEBUG_CELLS,
  cellsMap,
  applyCellUpdateSync,
  setDevtoolsCellNotifier,
  type Cell,
} from '@/core/reactive';
import { TREE, CHILD, PARENT } from '@/core/tree';
import { COMPONENT_ID_PROPERTY } from '@/core/types';

const noop = () => {};

// Reserved keys in the tree-shaped state. Component nodes are labelled
// `<ClassName>#<id>` (always containing `#`), so these never collide.
const STATE_KEY = '$state';
const GLOBALS_KEY = '$globals';
// Cap the per-action `changes` payload so a huge batch stays light in the
// action inspector (the full state still carries every value).
const CHANGE_CAP = 25;

// ---------------------------------------------------------------------------
// Public configuration / extension types
// ---------------------------------------------------------------------------

export interface DevToolsConfig {
  name?: string;
  maxAge?: number;
  serialize?: boolean | { replacer?: (key: string, value: unknown) => unknown };
  actionsDenylist?: string[];
  actionsAllowlist?: string[];
  features?: {
    pause?: boolean;
    lock?: boolean;
    persist?: boolean;
    export?: boolean | 'custom';
    import?: boolean | 'custom';
    jump?: boolean;
    skip?: boolean;
    reorder?: boolean;
    dispatch?: boolean;
    test?: boolean;
  };
  trace?: boolean;
  traceLimit?: number;
}

/** Action shape we send to the monitor. */
export interface DevToolsAction {
  type: string;
  [key: string]: unknown;
}

/** A message delivered to the `connect()` subscriber (e.g. on time-travel). */
export interface DevToolsMessage {
  type: string; // 'DISPATCH' | 'ACTION' | 'START' | 'STOP' | ...
  payload?: { type?: string; [key: string]: unknown };
  // For DISPATCH/time-travel this is a JSON string of the target state.
  state?: string;
}

/** The object returned by `__REDUX_DEVTOOLS_EXTENSION__.connect(config)`. */
export interface DevToolsConnection {
  init(state: unknown): void;
  send(action: DevToolsAction | null, state: unknown): void;
  subscribe(listener: (message: DevToolsMessage) => void): (() => void) | void;
  unsubscribe(): void;
  error(message: string): void;
}

/** The extension global: an enhancer factory that also carries `connect`. */
export interface ReduxDevToolsExtension {
  (config?: DevToolsConfig): (createStore: any) => any;
  connect(config?: DevToolsConfig): DevToolsConnection;
  disconnect?: () => void;
}

declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION__?: ReduxDevToolsExtension;
  }
}

// ---------------------------------------------------------------------------
// Cell <-> state bridge (shared by both transports)
// ---------------------------------------------------------------------------

// Guard that suppresses re-dispatch while we push state back into the cells
// during time-travel. The restore path already bypasses `Cell.update` (it uses
// `applyCellUpdateSync`), so the notifier never fires during restore — this is
// belt-and-braces in case a subscriber re-enters `update()` synchronously.
let isRestoringState = false;

/** Whether the integration is currently restoring cell state (time-travel). */
export function isDevToolsRestoring(): boolean {
  return isRestoringState;
}

type AnyObj = Record<string, unknown>;
type CellRecord = { _value: unknown; _debugName?: string; _relatedObj?: object };

/** Human-readable class name for a component node. */
function nodeClassName(node: unknown): string {
  const ctorName = (node as { constructor?: { name?: string } })?.constructor
    ?.name;
  if (ctorName && ctorName !== 'Object') {
    return ctorName;
  }
  const dbg = (node as { _debugName?: string })?._debugName;
  return dbg || 'Component';
}

/** Stable node label, e.g. `BenchRoot#7`. */
function nodeLabel(node: unknown, id: number): string {
  return `${nodeClassName(node)}#${id}`;
}

/** Stable per-session key for a non-tree (global/detached) cell. */
function globalKey(cell: Cell): string {
  const name = (cell as CellRecord)._debugName;
  return name ? `${name}#${cell.id}` : `cell#${cell.id}`;
}

/** Parse the trailing `#<id>` off a node label; null if not a node label. */
function parseNodeId(label: string): number | null {
  const i = label.lastIndexOf('#');
  if (i === -1) {
    return null;
  }
  const n = Number(label.slice(i + 1));
  return Number.isInteger(n) ? n : null;
}

/** A component id is a root of the snapshot when its parent is not a live node. */
function isRootId(id: number): boolean {
  const parent = PARENT.get(id);
  return parent === undefined || !TREE.has(parent);
}

/** Where a tree-owned cell lives, for action labelling. */
interface CellPathInfo {
  className: string;
  ownerLabel: string;
  key: string;
}

/**
 * One walk of the live component tree -> a serializable, nested state object
 * plus a `cell -> path` index (used to label actions) and the set of cells the
 * tree already covers (so `$globals` doesn't double-count them).
 *
 * Reads each node's own cells from `cellsMap.get(node)` and NEVER from the
 * strong `DEBUG_CELLS` set, so torn-down components — gone from `TREE` — are
 * absent by construction. Nothing here is retained past the call.
 */
function buildSnapshot(): { state: AnyObj; index: Map<Cell, CellPathInfo> } {
  const state: AnyObj = {};
  const index = new Map<Cell, CellPathInfo>();
  const treeOwned = new Set<Cell>();
  const visited = new Set<number>();
  for (const id of TREE.keys()) {
    if (isRootId(id) && !visited.has(id)) {
      visited.add(id);
      const node = TREE.get(id)!;
      state[nodeLabel(node, id)] = buildNode(node, id, index, treeOwned, visited);
    }
  }
  const globals = buildGlobals(treeOwned);
  if (globals !== null) {
    state[GLOBALS_KEY] = globals;
  }
  return { state, index };
}

function buildNode(
  node: unknown,
  id: number,
  index: Map<Cell, CellPathInfo>,
  treeOwned: Set<Cell>,
  visited: Set<number>,
): AnyObj {
  const obj: AnyObj = {};
  const cells = cellsMap.get(node as object);
  if (cells !== undefined && cells.size > 0) {
    const className = nodeClassName(node);
    const ownerLabel = `${className}#${id}`;
    const own: AnyObj = {};
    let any = false;
    cells.forEach((cell, key) => {
      if (typeof key === 'symbol') {
        return; // symbol-keyed internals don't round-trip through JSON
      }
      const k = String(key);
      own[k] = (cell as unknown as CellRecord)._value;
      index.set(cell as unknown as Cell, { className, ownerLabel, key: k });
      treeOwned.add(cell as unknown as Cell);
      any = true;
    });
    if (any) {
      obj[STATE_KEY] = own;
    }
  }
  const children = CHILD.get(id);
  if (children !== undefined) {
    children.forEach((childId) => {
      const childNode = TREE.get(childId);
      if (childNode !== undefined && !visited.has(childId)) {
        visited.add(childId);
        obj[nodeLabel(childNode, childId)] = buildNode(
          childNode,
          childId,
          index,
          treeOwned,
          visited,
        );
      }
    });
  }
  return obj;
}

/**
 * The `$globals` bucket: live cells with no live tree owner. Sourced from the
 * dev-only `DEBUG_CELLS` set, but:
 *   - cells already shown in the tree are skipped (no duplication);
 *   - cells owned by a COMPONENT that is no longer in `TREE` are skipped — a
 *     destroyed component leaves zero trace here either.
 * What remains is module-level `cell()`, list-item cells and `@tracked` on plain
 * (non-component) objects. `DEBUG_CELLS` is the one pre-existing dev-only set
 * that grows over a session; the per-component path above never touches it.
 */
function buildGlobals(treeOwned: Set<Cell>): AnyObj | null {
  const out: AnyObj = {};
  let any = false;
  DEBUG_CELLS.forEach((cell) => {
    if (treeOwned.has(cell)) {
      return;
    }
    const owner = (cell as unknown as CellRecord)._relatedObj;
    if (
      owner !== undefined &&
      owner !== null &&
      typeof owner === 'object' &&
      (COMPONENT_ID_PROPERTY in owner)
    ) {
      // Component-owned but absent from the live TREE => torn down. Exclude.
      return;
    }
    out[globalKey(cell)] = (cell as unknown as CellRecord)._value;
    any = true;
  });
  return any ? out : null;
}

/** Public snapshot of the whole reactive tree (used by `createCellState`). */
export function snapshotState(): AnyObj {
  return buildSnapshot().state;
}

function stringKeyedCells(
  cells: Map<string | number | symbol, unknown>,
): Map<string, Cell> {
  const m = new Map<string, Cell>();
  cells.forEach((c, k) => m.set(String(k), c as Cell));
  return m;
}

/**
 * Restore reactive state from a previously snapshotted tree-shaped object
 * (time-travel — backward OR forward). Navigates the nested state in parallel
 * with the LIVE component tree, matching nodes by their stable `#<id>` label, and
 * applies each leaf via `applyCellUpdateSync` (synchronous re-render, no
 * re-dispatch). The `isRestoringState` guard neutralises any synchronous
 * write-back a subscriber might perform.
 *
 * Entries whose component is no longer live are skipped (you cannot restore a
 * destroyed component's cells); live nodes absent from the target state are left
 * untouched. Stable across a session as long as component ids are stable.
 */
export function restoreState(
  state: AnyObj | null | undefined,
): void {
  if (!state || typeof state !== 'object') {
    return;
  }
  isRestoringState = true;
  try {
    for (const key in state) {
      if (key === GLOBALS_KEY) {
        restoreGlobals(state[key] as AnyObj);
        continue;
      }
      const id = parseNodeId(key);
      if (id === null) {
        continue;
      }
      const node = TREE.get(id);
      if (node !== undefined) {
        restoreNode(node, state[key] as AnyObj);
      }
    }
  } finally {
    isRestoringState = false;
  }
}

function restoreNode(node: unknown, obj: AnyObj | null | undefined): void {
  if (!obj || typeof obj !== 'object') {
    return;
  }
  const cells = cellsMap.get(node as object);
  for (const key in obj) {
    if (key === STATE_KEY) {
      if (cells === undefined) {
        continue;
      }
      const byStr = stringKeyedCells(cells);
      const own = obj[key] as AnyObj;
      if (own && typeof own === 'object') {
        for (const ck in own) {
          const cell = byStr.get(ck);
          if (cell !== undefined) {
            applyCellUpdateSync(cell as Cell<unknown>, own[ck]);
          }
        }
      }
      continue;
    }
    const id = parseNodeId(key);
    if (id === null) {
      continue;
    }
    const child = TREE.get(id);
    if (child !== undefined) {
      restoreNode(child, obj[key] as AnyObj);
    }
  }
}

function restoreGlobals(globals: AnyObj | null | undefined): void {
  if (!globals || typeof globals !== 'object') {
    return;
  }
  const byKey = new Map<string, Cell>();
  DEBUG_CELLS.forEach((cell) => byKey.set(globalKey(cell), cell));
  for (const k in globals) {
    const cell = byKey.get(k);
    if (cell !== undefined) {
      applyCellUpdateSync(cell as Cell<unknown>, globals[k]);
    }
  }
}

// ---------------------------------------------------------------------------
// Modern `connect()` transport — the recommended integration
// ---------------------------------------------------------------------------

let _connection: DevToolsConnection | null = null;
let _unsubscribe: (() => void) | null = null;
let _initialSnapshot: AnyObj = {};

// Coalesce per-microtask: one "action" per synchronous batch of cell updates
// (mirrors gxt's own scheduleRevalidate batching) so a 1000-row update is a
// single timeline entry instead of 1000. `_changed` maps each changed cell to
// its FIRST-seen value this batch (the "from"); the "to" is read live at flush.
// Both the map and the scheduled flag are buffers, cleared every flush — the
// integration holds nothing across snapshots.
const _changed = new Map<Cell, unknown>();
let _sendScheduled = false;

/** Dev-only introspection for the leak test: count of cells buffered for the
 * next flush. The integration retains nothing else across snapshots. */
export function devtoolsPendingCount(): number {
  return _changed.size;
}

function isPrimitiveish(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean'
  );
}

/** A light, JSON-safe stand-in for a non-primitive value in the action payload
 * (the full state still carries the real value). */
function summarizeValue(v: unknown): unknown {
  if (isPrimitiveish(v)) {
    return v;
  }
  if (Array.isArray(v)) {
    return `Array(${v.length})`;
  }
  if (typeof v === 'function') {
    return 'ƒ()';
  }
  const name = (v as { constructor?: { name?: string } })?.constructor?.name;
  return `${name || 'Object'}{…}`;
}

interface ChangeEntry {
  cell: Cell;
  from: unknown;
  to: unknown;
  /** `Class.prop` (no id) — for the action `type`. */
  shortLabel: string;
  /** `Class#id.prop` (precise) — for the payload path. */
  path: string;
  /** `Class#id` — to count distinct owners. */
  ownerLabel: string;
}

function describeChange(
  cell: Cell,
  from: unknown,
  index: Map<Cell, CellPathInfo>,
): ChangeEntry {
  const info = index.get(cell);
  const to = (cell as unknown as CellRecord)._value;
  if (info !== undefined) {
    return {
      cell,
      from,
      to,
      shortLabel: `${info.className}.${info.key}`,
      path: `${info.ownerLabel}.${info.key}`,
      ownerLabel: info.ownerLabel,
    };
  }
  // Non-tree (global/detached) cell.
  const name =
    (cell as unknown as CellRecord)._debugName || `cell#${cell.id}`;
  return {
    cell,
    from,
    to,
    shortLabel: name,
    path: globalKey(cell),
    ownerLabel: GLOBALS_KEY,
  };
}

/** Build the timeline label that tells the story of this coalesced batch. */
function buildActionType(entries: ChangeEntry[]): string {
  const n = entries.length;
  if (n === 1) {
    return `set ${entries[0]!.shortLabel}`;
  }
  if (n > 8) {
    return `update: ${n} cells`;
  }
  const owners = new Set(entries.map((e) => e.ownerLabel));
  if (owners.size === 1) {
    return `update ${entries[0]!.ownerLabel} (${n} cells)`;
  }
  return `update ${entries[0]!.ownerLabel} +${n - 1} more (${n} cells)`;
}

function scheduleDevtoolsSend(cell: Cell, oldValue: unknown): void {
  if (isRestoringState || _connection === null) {
    return;
  }
  // First-seen old value wins so the coalesced action reports the true
  // start-of-batch -> end-of-batch transition.
  if (!_changed.has(cell)) {
    _changed.set(cell, oldValue);
  }
  if (_sendScheduled) {
    return;
  }
  _sendScheduled = true;
  queueMicrotask(flushDevtoolsSend);
}

function flushDevtoolsSend(): void {
  _sendScheduled = false;
  if (_connection === null) {
    _changed.clear();
    return;
  }
  const pending = Array.from(_changed.entries());
  _changed.clear();
  if (pending.length === 0) {
    return;
  }
  const { state, index } = buildSnapshot();
  const entries = pending.map(([cell, from]) =>
    describeChange(cell, from, index),
  );
  const changes = entries.slice(0, CHANGE_CAP).map((e) => ({
    path: e.path,
    from: summarizeValue(e.from),
    to: summarizeValue(e.to),
  }));
  const action: DevToolsAction = {
    type: buildActionType(entries),
    count: entries.length,
    changes,
  };
  if (entries.length > CHANGE_CAP) {
    action.truncated = entries.length - CHANGE_CAP;
  }
  _connection.send(action, state);
}

function handleDevToolsMessage(
  connection: DevToolsConnection,
  message: DevToolsMessage,
): void {
  if (message.type !== 'DISPATCH' || !message.payload) {
    return;
  }
  const action = message.payload.type;
  switch (action) {
    case 'JUMP_TO_STATE':
    case 'JUMP_TO_ACTION':
    case 'ROLLBACK': {
      // Restores work for ANY target index — backward or forward — because the
      // tree-shaped state carries stable `#<id>` key paths that `restoreState`
      // navigates against the live tree.
      const parsed = parseDevToolsState(connection, message.state);
      if (parsed !== undefined) {
        restoreState(parsed);
      }
      break;
    }
    case 'RESET':
      // Revert to the state captured when DevTools connected.
      restoreState(_initialSnapshot);
      connection.init(snapshotState());
      break;
    case 'COMMIT':
      // Make the current state the new committed base.
      _initialSnapshot = snapshotState();
      connection.init(_initialSnapshot);
      break;
    case 'IMPORT_STATE': {
      const lifted = message.payload.nextLiftedState as
        | { computedStates?: Array<{ state?: AnyObj }> }
        | undefined;
      const computed = lifted?.computedStates;
      if (Array.isArray(computed) && computed.length > 0) {
        restoreState(computed[computed.length - 1]!.state);
      }
      break;
    }
    default:
      // PAUSE_RECORDING / LOCK_CHANGES / etc. — nothing to restore.
      break;
  }
}

function parseDevToolsState(
  connection: DevToolsConnection,
  state: string | undefined,
): AnyObj | undefined {
  if (typeof state !== 'string') {
    // Some monitors deliver an already-parsed object.
    return state === undefined ? undefined : (state as AnyObj);
  }
  try {
    return JSON.parse(state) as AnyObj;
  } catch (e) {
    // Never swallow: surface to the dev console AND the extension monitor.
    if (IS_DEV_MODE) {
      console.error('[gxt redux-devtools] failed to parse time-travel state', e);
    }
    connection.error('gxt: failed to parse time-travel state');
    return undefined;
  }
}

/**
 * Connect gxt's reactive state to the Redux DevTools extension.
 *
 * Opt-in, dev-only, browser-only. Returns a disabler that disconnects the
 * integration and removes the cell-update hook. Safe to call when the extension
 * is absent, in SSR, or in production — it simply returns a no-op disabler.
 *
 * @example
 *   import { enableReduxDevtools } from '@lifeart/gxt';
 *   if (IS_DEV_MODE) enableReduxDevtools();
 */
export function enableReduxDevtools(config?: DevToolsConfig): () => void {
  // Production / lib builds: this whole body folds away (IS_DEV_MODE === false).
  if (!IS_DEV_MODE) {
    return noop;
  }
  if (typeof window === 'undefined') {
    return noop; // SSR / non-browser
  }
  const extension = window.__REDUX_DEVTOOLS_EXTENSION__;
  if (!extension || typeof extension.connect !== 'function') {
    return noop; // extension not installed
  }
  if (_connection !== null) {
    return disableReduxDevtools; // idempotent — already connected
  }

  const connection = extension.connect({
    name: 'GXT Reactive State',
    features: {
      pause: true,
      lock: false,
      persist: false,
      export: true,
      import: true,
      jump: true,
      skip: true,
      reorder: false,
      dispatch: true,
      test: false,
    },
    maxAge: 50,
    trace: false,
    ...config,
  });

  _initialSnapshot = snapshotState();
  connection.init(_initialSnapshot);
  const unsub = connection.subscribe((message) =>
    handleDevToolsMessage(connection, message),
  );

  _connection = connection;
  _unsubscribe = typeof unsub === 'function' ? unsub : null;

  // Install the reactive-core hot-path notifier (zero-cost when not installed).
  setDevtoolsCellNotifier(scheduleDevtoolsSend);

  return disableReduxDevtools;
}

/**
 * Disconnect the DevTools integration and remove the cell-update hook. Fully
 * detaches with zero residue: the notifier, the coalescing buffers, the
 * subscription, the connection and the committed baseline are all cleared.
 */
export function disableReduxDevtools(): void {
  setDevtoolsCellNotifier(null);
  _changed.clear();
  _sendScheduled = false;
  if (_unsubscribe !== null) {
    _unsubscribe();
  } else if (_connection !== null) {
    _connection.unsubscribe();
  }
  _connection = null;
  _unsubscribe = null;
  _initialSnapshot = {};
}

// ---------------------------------------------------------------------------
// Classic Freezer-style enhancer transport (faithful port)
//   Inspired by https://www.npmjs.com/package/freezer-redux-devtools
// ---------------------------------------------------------------------------

const ActionTypes = {
  INIT: '@@INIT',
  PERFORM_ACTION: 'PERFORM_ACTION',
  TOGGLE_ACTION: 'TOGGLE_ACTION',
} as const;

type Listener = () => void;

export interface FreezerState {
  get(): Record<string, unknown>;
  set(state: any): void;
  skipDispatch: number;
  trigger(eventName: string, ...args: unknown[]): void;
  on(
    eventName: string,
    callback: (this: FreezerState, reactionName: string, ...args: unknown[]) => void,
  ): void;
}

/**
 * A `FreezerState` backed by gxt cells — read tree-shaped snapshots via
 * `snapshotState`, write restores through `restoreState`. Use with
 * `supportChromeExtension` for the enhancer-based transport.
 */
export function createCellState(): FreezerState {
  return {
    get() {
      return snapshotState();
    },
    set(state: Record<string, unknown>) {
      restoreState(state);
    },
    skipDispatch: 0,
    trigger() {
      /* no-op: gxt cells push via the connect transport, not freezer events */
    },
    on() {
      /* no-op */
    },
  };
}

/**
 * Redux middleware that makes a `FreezerState` and the DevTools talk to each
 * other (faithful port of the freezer-redux-devtools middleware).
 */
export function FreezerMiddleware(State: FreezerState) {
  return function (next: any) {
    return function StoreEnhancer(_someReducer: any, _someState: any) {
      const commitedState = State.get();
      let lastAction: string | number = 0;

      // The freezer reducer triggers events on any devtool action to keep the
      // freezer's and the devtool's states in sync.
      const reducer = function (
        state: any,
        action: { type: string; arguments?: unknown[]; id?: number },
      ) {
        if (action.type === ActionTypes.INIT) {
          State.set(state || commitedState);
        } else if (lastAction !== ActionTypes.PERFORM_ACTION) {
          // Flag that we're dispatching so we don't dispatch the same action
          // twice.
          State.skipDispatch = 1;
          State.trigger(action.type, ...(action.arguments || []));
        }
        // The only valid state is the freezer's one.
        return State.get();
      };

      const store = next(reducer);
      const liftedStore = store.liftedStore;
      const dtStore = store.devToolsStore || store.liftedStore;

      if (dtStore) {
        const toolsDispatcher = dtStore.dispatch;

        // Override the devTools store's dispatch to set committedState on a
        // Commit action.
        dtStore.dispatch = function (action: { type: string; id?: number }) {
          lastAction = action.type;

          // With redux-devtools we must reset the state to the last valid one
          // manually.
          if (liftedStore && lastAction === ActionTypes.TOGGLE_ACTION) {
            const states = dtStore.getState().computedStates;
            const nextValue = states[action.id! - 1].state;
            State.set(nextValue);
          }

          toolsDispatcher.call(dtStore, action);
          return action;
        };
      }

      // Forward any freezer event to the devTools.
      State.on('afterAll', function (
        this: FreezerState,
        reactionName: string,
        ...restArgs: unknown[]
      ) {
        if (reactionName === 'update') {
          return;
        }
        if (this.skipDispatch) {
          this.skipDispatch = 0;
        } else {
          store.dispatch({ type: reactionName, args: restArgs });
        }
      });

      return store;
    };
  };
}

/**
 * Bind a `FreezerState` to the Redux DevTools extension via the enhancer API.
 */
export function supportChromeExtension(
  State: FreezerState,
  config?: DevToolsConfig,
) {
  const devtools = window.__REDUX_DEVTOOLS_EXTENSION__
    ? window.__REDUX_DEVTOOLS_EXTENSION__(config)
    : (f: any) => f;

  return compose(FreezerMiddleware(State), devtools)(createStore)(
    (state: any) => state,
  );
}

/**
 * Creates a minimal valid redux store. Copied directly from redux.
 * https://github.com/reduxjs/redux
 */
function createStore(reducer: any, initialState?: any) {
  if (typeof reducer !== 'function') {
    throw new Error('Expected the reducer to be a function.');
  }

  let currentReducer = reducer;
  let currentState = initialState;
  const listeners: Listener[] = [];
  let isDispatching = false;
  const ReduxActionTypes = {
    INIT: '@@redux/INIT',
  };

  function getState() {
    return currentState;
  }

  function subscribe(listener: Listener) {
    listeners.push(listener);
    let isSubscribed = true;

    return function unsubscribe() {
      if (!isSubscribed) {
        return;
      }
      isSubscribed = false;
      const index = listeners.indexOf(listener);
      listeners.splice(index, 1);
    };
  }

  function dispatch(action: { type: string }) {
    if (typeof action.type === 'undefined') {
      throw new Error(
        'Actions may not have an undefined "type" property. Have you misspelled a constant?',
      );
    }
    if (isDispatching) {
      throw new Error('Reducers may not dispatch actions.');
    }

    try {
      isDispatching = true;
      currentState = currentReducer(currentState, action);
    } finally {
      isDispatching = false;
    }

    listeners.slice().forEach((listener) => listener());
    return action;
  }

  function replaceReducer(nextReducer: any) {
    currentReducer = nextReducer;
    dispatch({ type: ReduxActionTypes.INIT });
  }

  // When a store is created, an "INIT" action is dispatched so that every
  // reducer returns its initial state, populating the initial state tree.
  dispatch({ type: ReduxActionTypes.INIT });

  return {
    dispatch,
    subscribe,
    getState,
    replaceReducer,
  };
}

/**
 * Composes single-argument functions from right to left.
 * Copied directly from redux. https://github.com/reduxjs/redux
 */
function compose(...funcs: Array<(arg: any) => any>) {
  return function (arg: any) {
    return funcs.reduceRight((composed, f) => f(composed), arg);
  };
}
