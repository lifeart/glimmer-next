/**
 * Redux DevTools browser-extension integration for gxt's reactive core.
 *
 * Bridges gxt `Cell`s to the Redux DevTools extension
 * (`window.__REDUX_DEVTOOLS_EXTENSION__`) so the whole reactive state tree shows
 * up on the DevTools timeline and supports time-travel debugging: a JUMP in the
 * monitor restores every tracked cell to its recorded value and re-renders the
 * bound DOM, WITHOUT re-dispatching back to the monitor.
 *
 * Design / cost model
 * ===================
 * The feature is strictly DEV-ONLY and browser-only:
 *   * `enableReduxDevtools()` no-ops (returns a no-op disabler) unless
 *     `IS_DEV_MODE` is true, a `window` exists, and the extension is installed.
 *   * The only hot-path touchpoint — `Cell.update()`'s `_devtoolsCellNotifier`
 *     call — is guarded by `IS_DEV_MODE && notifier !== null`. In a lib /
 *     production build `IS_DEV_MODE` is inlined to `false`, so that branch (and
 *     hence every reference that would pull THIS module into the bundle) folds
 *     away. When DevTools is simply not enabled in dev it costs one predictable
 *     null check. Result: this whole module tree-shakes out of production
 *     consumer bundles.
 *
 * State source
 * ============
 * State is read from the existing dev-only `DEBUG_CELLS` registry (every live
 * data cell) — no parallel "ALIVE_CELLS" registry is introduced. Each cell is
 * keyed by a stable, unique `<debugName>#<id>` string.
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
  applyCellUpdateSync,
  setDevtoolsCellNotifier,
  type Cell,
} from '@/core/reactive';

const noop = () => {};

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

/**
 * Stable, unique key for a cell. `id` guarantees uniqueness; the debug name is
 * prepended for human readability in the monitor.
 */
function cellKey(cell: Cell): string {
  const name = (cell as { _debugName?: string })._debugName;
  return name ? `${name}#${cell.id}` : `cell#${cell.id}`;
}

/** Snapshot every live data cell into a plain serializable object. */
export function snapshotCells(): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  DEBUG_CELLS.forEach((cell) => {
    state[cellKey(cell)] = (cell as { _value: unknown })._value;
  });
  return state;
}

/**
 * Restore cell values from a previously snapshotted state (time-travel).
 *
 * Uses `applyCellUpdateSync` so subscribers re-render synchronously and the
 * DevTools-notifier hook in `Cell.update` is NOT triggered (no re-dispatch).
 * The `isRestoringState` guard additionally neutralises any synchronous
 * write-back a subscriber might perform.
 */
export function restoreCells(
  state: Record<string, unknown> | null | undefined,
): void {
  if (!state || typeof state !== 'object') {
    return;
  }
  const byKey = new Map<string, Cell>();
  DEBUG_CELLS.forEach((cell) => byKey.set(cellKey(cell), cell));
  isRestoringState = true;
  try {
    for (const key in state) {
      const cell = byKey.get(key);
      if (cell !== undefined) {
        applyCellUpdateSync(cell as Cell<unknown>, state[key]);
      }
    }
  } finally {
    isRestoringState = false;
  }
}

// ---------------------------------------------------------------------------
// Modern `connect()` transport — the recommended integration
// ---------------------------------------------------------------------------

let _connection: DevToolsConnection | null = null;
let _unsubscribe: (() => void) | null = null;
let _initialSnapshot: Record<string, unknown> = {};

// Coalesce per-microtask: one "action" per synchronous batch of cell updates
// (mirrors gxt's own scheduleRevalidate batching) so a 1000-row update is a
// single timeline entry instead of 1000.
const _changedKeys = new Set<string>();
let _sendScheduled = false;

function scheduleDevtoolsSend(cell: Cell): void {
  if (isRestoringState || _connection === null) {
    return;
  }
  _changedKeys.add(cellKey(cell));
  if (_sendScheduled) {
    return;
  }
  _sendScheduled = true;
  queueMicrotask(() => {
    _sendScheduled = false;
    if (_connection === null) {
      _changedKeys.clear();
      return;
    }
    const changed = Array.from(_changedKeys);
    _changedKeys.clear();
    _connection.send({ type: 'cells:changed', changed }, snapshotCells());
  });
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
      const parsed = parseDevToolsState(connection, message.state);
      if (parsed !== undefined) {
        restoreCells(parsed);
      }
      break;
    }
    case 'RESET':
      // Revert to the state captured when DevTools connected.
      restoreCells(_initialSnapshot);
      connection.init(snapshotCells());
      break;
    case 'COMMIT':
      // Make the current state the new committed base.
      _initialSnapshot = snapshotCells();
      connection.init(_initialSnapshot);
      break;
    case 'IMPORT_STATE': {
      const lifted = message.payload.nextLiftedState as
        | { computedStates?: Array<{ state?: Record<string, unknown> }> }
        | undefined;
      const computed = lifted?.computedStates;
      if (Array.isArray(computed) && computed.length > 0) {
        restoreCells(computed[computed.length - 1]!.state);
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
): Record<string, unknown> | undefined {
  if (typeof state !== 'string') {
    // Some monitors deliver an already-parsed object.
    return state === undefined ? undefined : (state as Record<string, unknown>);
  }
  try {
    return JSON.parse(state) as Record<string, unknown>;
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

  _initialSnapshot = snapshotCells();
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

/** Disconnect the DevTools integration and remove the cell-update hook. */
export function disableReduxDevtools(): void {
  setDevtoolsCellNotifier(null);
  _changedKeys.clear();
  _sendScheduled = false;
  if (_unsubscribe !== null) {
    _unsubscribe();
  } else if (_connection !== null) {
    _connection.unsubscribe();
  }
  _connection = null;
  _unsubscribe = null;
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
 * A `FreezerState` backed by gxt cells — read snapshots from `DEBUG_CELLS`,
 * write restores through `restoreCells`. Use with `supportChromeExtension` for
 * the enhancer-based transport.
 */
export function createCellState(): FreezerState {
  return {
    get() {
      return snapshotCells();
    },
    set(state: Record<string, unknown>) {
      restoreCells(state);
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
