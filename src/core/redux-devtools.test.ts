// @vitest-environment happy-dom
import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import {
  FreezerMiddleware,
  supportChromeExtension,
  enableReduxDevtools,
  disableReduxDevtools,
  isDevToolsRestoring,
  snapshotCells,
  createCellState,
  type FreezerState,
} from './redux-devtools';
import { cell } from './reactive';
import { opcodeFor } from './vm';

// `IS_DEV_MODE` is inlined by the compiler: `false` under the default test mode
// and `true` under `--mode development`. The reactive-core DevTools hook
// (`Cell.update` -> notifier) and `DEBUG_CELLS` population are gated on it, so
// the cell-bridge tests only have observable behaviour in dev mode. Under the
// standard `vitest run` they are skipped (mirrors slot.test.ts / component.test.ts).
const devTest = IS_DEV_MODE ? test : test.skip;

function clearExtension() {
  delete (window as any).__REDUX_DEVTOOLS_EXTENSION__;
}

// A fake Redux DevTools extension exposing the modern `connect()` API plus the
// classic enhancer call signature.
function installFakeExtension() {
  let listener: ((m: any) => void) | undefined;
  const connection = {
    init: vi.fn(),
    send: vi.fn(),
    subscribe: vi.fn((l: (m: any) => void) => {
      listener = l;
      return () => {
        listener = undefined;
      };
    }),
    unsubscribe: vi.fn(),
    error: vi.fn(),
  };
  const extension: any = vi.fn(() => (createStore: any) => createStore);
  extension.connect = vi.fn(() => connection);
  (window as any).__REDUX_DEVTOOLS_EXTENSION__ = extension;
  return {
    extension,
    connection,
    emit: (message: any) => listener && listener(message),
    lastSendState: () => {
      const calls = connection.send.mock.calls;
      return calls.length ? calls[calls.length - 1][1] : undefined;
    },
  };
}

const flushMicrotasks = () => Promise.resolve();

describe('Redux DevTools Integration', () => {
  afterEach(() => {
    disableReduxDevtools();
    clearExtension();
  });

  // -------------------------------------------------------------------------
  // FreezerMiddleware (faithful port — runs in every mode)
  // -------------------------------------------------------------------------
  describe('FreezerMiddleware', () => {
    let mockState: FreezerState;
    let dispatchedActions: any[];

    beforeEach(() => {
      dispatchedActions = [];
      mockState = {
        get: vi.fn(() => ({ count: 0 })),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };
    });

    function createMockStore() {
      const mockDevToolsStore = {
        dispatch: vi.fn((action) => {
          dispatchedActions.push(action);
          return action;
        }),
        getState: vi.fn(() => ({
          computedStates: [{ state: { count: 0 } }, { state: { count: 1 } }],
        })),
      };

      return {
        dispatch: vi.fn((action) => {
          dispatchedActions.push(action);
          return action;
        }),
        getState: vi.fn(() => ({
          computedStates: [{ state: { count: 0 } }, { state: { count: 1 } }],
        })),
        liftedStore: mockDevToolsStore,
        devToolsStore: mockDevToolsStore,
      };
    }

    test('creates a middleware function', () => {
      expect(typeof FreezerMiddleware(mockState)).toBe('function');
    });

    test('middleware returns StoreEnhancer', () => {
      const next = vi.fn(() => createMockStore());
      expect(typeof FreezerMiddleware(mockState)(next)).toBe('function');
    });

    test('StoreEnhancer calls next with reducer', () => {
      const next = vi.fn((_reducer: any) => createMockStore());
      FreezerMiddleware(mockState)(next)(vi.fn(), {});
      expect(next).toHaveBeenCalledTimes(1);
      expect(typeof next.mock.calls[0][0]).toBe('function');
    });

    test('sets up afterAll event listener on state', () => {
      const next = vi.fn(() => createMockStore());
      FreezerMiddleware(mockState)(next)(vi.fn(), {});
      expect(mockState.on).toHaveBeenCalledWith('afterAll', expect.any(Function));
    });

    test('reducer handles INIT action', () => {
      let capturedReducer: any;
      const next = vi.fn((reducer) => {
        capturedReducer = reducer;
        return createMockStore();
      });
      FreezerMiddleware(mockState)(next)(vi.fn(), {});
      capturedReducer({ count: 5 }, { type: '@@INIT' });
      expect(mockState.set).toHaveBeenCalledWith({ count: 5 });
      expect(mockState.get).toHaveBeenCalled();
    });

    test('reducer returns state from State.get()', () => {
      mockState.get = vi.fn(() => ({ count: 42 }));
      let capturedReducer: any;
      const next = vi.fn((reducer) => {
        capturedReducer = reducer;
        return createMockStore();
      });
      FreezerMiddleware(mockState)(next)(vi.fn(), {});
      expect(capturedReducer({}, { type: 'SOME_ACTION' })).toEqual({ count: 42 });
    });

    test('afterAll callback dispatches actions to store', () => {
      const mockStore = createMockStore();
      let afterAllCallback: any;
      mockState.on = vi.fn((event, callback) => {
        if (event === 'afterAll') afterAllCallback = callback;
      });
      FreezerMiddleware(mockState)(vi.fn(() => mockStore))(vi.fn(), {});
      afterAllCallback.call(mockState, 'CUSTOM_EVENT', 'arg1', 'arg2');
      expect(mockStore.dispatch).toHaveBeenCalledWith({
        type: 'CUSTOM_EVENT',
        args: ['arg1', 'arg2'],
      });
    });

    test('afterAll callback skips dispatch when skipDispatch is set', () => {
      const mockStore = createMockStore();
      let afterAllCallback: any;
      mockState.on = vi.fn((event, callback) => {
        if (event === 'afterAll') afterAllCallback = callback;
      });
      FreezerMiddleware(mockState)(vi.fn(() => mockStore))(vi.fn(), {});
      mockState.skipDispatch = 1;
      afterAllCallback.call(mockState, 'CUSTOM_EVENT');
      expect(mockStore.dispatch).not.toHaveBeenCalled();
      expect(mockState.skipDispatch).toBe(0);
    });

    test('afterAll callback ignores update events', () => {
      const mockStore = createMockStore();
      let afterAllCallback: any;
      mockState.on = vi.fn((event, callback) => {
        if (event === 'afterAll') afterAllCallback = callback;
      });
      FreezerMiddleware(mockState)(vi.fn(() => mockStore))(vi.fn(), {});
      afterAllCallback.call(mockState, 'update');
      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // supportChromeExtension (enhancer transport — runs in every mode)
  // -------------------------------------------------------------------------
  describe('supportChromeExtension', () => {
    function mockState(): FreezerState {
      return {
        get: vi.fn(() => ({ value: 'initial' })),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };
    }

    test('returns a store with dispatch/getState/subscribe', () => {
      clearExtension();
      const store = supportChromeExtension(mockState());
      expect(store).toHaveProperty('dispatch');
      expect(store).toHaveProperty('getState');
      expect(store).toHaveProperty('subscribe');
    });

    test('works with the enhancer-form extension', () => {
      const mockEnhancer = vi.fn((createStore: any) => createStore);
      (window as any).__REDUX_DEVTOOLS_EXTENSION__ = vi.fn(() => mockEnhancer);
      const store = supportChromeExtension(mockState());
      expect((window as any).__REDUX_DEVTOOLS_EXTENSION__).toHaveBeenCalled();
      expect(store).toHaveProperty('dispatch');
    });

    test('subscribe / dispatch / unsubscribe behave like a redux store', () => {
      clearExtension();
      const store = supportChromeExtension(mockState());
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);
      expect(typeof unsubscribe).toBe('function');

      const action = { type: 'INCREMENT' };
      expect(store.dispatch(action)).toEqual(action);
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      unsubscribe();
      store.dispatch({ type: 'INCREMENT' });
      expect(listener).not.toHaveBeenCalled();
    });

    test('passes config through to the extension', () => {
      let capturedConfig: any = null;
      (window as any).__REDUX_DEVTOOLS_EXTENSION__ = vi.fn((config: any) => {
        capturedConfig = config;
        return (createStore: any) => createStore;
      });
      supportChromeExtension(mockState(), {
        name: 'Test App',
        maxAge: 100,
        features: { jump: true, skip: true },
      });
      expect(capturedConfig).toEqual({
        name: 'Test App',
        maxAge: 100,
        features: { jump: true, skip: true },
      });
    });
  });

  // -------------------------------------------------------------------------
  // enableReduxDevtools — safety in production / extension-absent (every mode)
  // -------------------------------------------------------------------------
  describe('enableReduxDevtools safety', () => {
    test('returns a no-op disabler when the extension is absent', () => {
      clearExtension();
      const disable = enableReduxDevtools();
      expect(typeof disable).toBe('function');
      expect(() => disable()).not.toThrow();
    });

    test('is safe to call repeatedly / disable when never enabled', () => {
      clearExtension();
      expect(() => {
        enableReduxDevtools();
        enableReduxDevtools();
        disableReduxDevtools();
      }).not.toThrow();
    });

    test('isDevToolsRestoring is false at rest', () => {
      expect(isDevToolsRestoring()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Cell bridge — dev-only behaviour (skipped under default test mode)
  // -------------------------------------------------------------------------
  describe('cell bridge (dev-only)', () => {
    devTest('connect initialises the monitor with current state', () => {
      const fake = installFakeExtension();
      enableReduxDevtools();
      expect(fake.extension.connect).toHaveBeenCalledTimes(1);
      expect(fake.connection.init).toHaveBeenCalledTimes(1);
      expect(fake.connection.subscribe).toHaveBeenCalledTimes(1);
    });

    devTest('dispatches a snapshot when a cell changes', async () => {
      const fake = installFakeExtension();
      enableReduxDevtools();

      const c = cell(1, 'devtools-dispatch');
      c.update(2);
      await flushMicrotasks();

      expect(fake.connection.send).toHaveBeenCalled();
      const state = fake.lastSendState();
      const key = Object.keys(state).find((k) => k.startsWith('devtools-dispatch#'));
      expect(key).toBeTruthy();
      expect(state[key!]).toBe(2);
    });

    devTest('does NOT dispatch when DevTools is off (zero-cost guard)', async () => {
      const fake = installFakeExtension();
      // Note: enableReduxDevtools NOT called.
      const c = cell(1, 'devtools-off');
      c.update(2);
      await flushMicrotasks();
      expect(fake.connection.send).not.toHaveBeenCalled();

      // After enabling it dispatches; after disabling it stops again.
      enableReduxDevtools();
      c.update(3);
      await flushMicrotasks();
      expect(fake.connection.send).toHaveBeenCalledTimes(1);

      disableReduxDevtools();
      c.update(4);
      await flushMicrotasks();
      expect(fake.connection.send).toHaveBeenCalledTimes(1);
    });

    devTest('coalesces a batch of updates into a single dispatch', async () => {
      const fake = installFakeExtension();
      enableReduxDevtools();

      const a = cell(0, 'devtools-batch-a');
      const b = cell(0, 'devtools-batch-b');
      a.update(1);
      b.update(1);
      a.update(2);
      await flushMicrotasks();

      expect(fake.connection.send).toHaveBeenCalledTimes(1);
      const [action] = fake.connection.send.mock.calls[0];
      expect(action.type).toBe('cells:changed');
    });

    devTest('time-travel restores cells + re-renders without re-dispatching', async () => {
      const fake = installFakeExtension();
      enableReduxDevtools();

      const c = cell(10, 'devtools-jump');
      const rendered: unknown[] = [];
      const teardown = opcodeFor(c as any, (value) => {
        rendered.push(value);
      });

      c.update(20);
      await flushMicrotasks();

      // The opcode saw the initial value and the update.
      expect(rendered).toContain(20);
      expect(c.value).toBe(20);

      // Locate the cell's key in the snapshot.
      const snapshot = snapshotCells();
      const key = Object.keys(snapshot).find((k) => k.startsWith('devtools-jump#'))!;
      expect(key).toBeTruthy();

      const sendCallsBeforeJump = fake.connection.send.mock.calls.length;

      // Simulate a JUMP_TO_STATE from the monitor back to value 10.
      fake.emit({
        type: 'DISPATCH',
        payload: { type: 'JUMP_TO_STATE' },
        state: JSON.stringify({ [key]: 10 }),
      });

      // Cell restored + subscriber re-rendered synchronously.
      expect(c.value).toBe(10);
      expect(rendered[rendered.length - 1]).toBe(10);

      // No re-dispatch as a result of the restore...
      expect(fake.connection.send.mock.calls.length).toBe(sendCallsBeforeJump);
      // ...even after pending microtasks flush.
      await flushMicrotasks();
      expect(fake.connection.send.mock.calls.length).toBe(sendCallsBeforeJump);

      teardown();
    });

    devTest('createCellState snapshots + restores via the freezer interface', () => {
      const c = cell(100, 'devtools-cellstate');
      const state = createCellState();
      const snap = state.get();
      const key = Object.keys(snap).find((k) => k.startsWith('devtools-cellstate#'))!;
      expect(snap[key]).toBe(100);

      state.set({ [key]: 200 });
      expect(c.value).toBe(200);
    });

    devTest('ignores malformed / non-DISPATCH messages without throwing', () => {
      const fake = installFakeExtension();
      enableReduxDevtools();
      expect(() => {
        fake.emit({ type: 'START' });
        fake.emit({ type: 'DISPATCH', payload: { type: 'PAUSE_RECORDING' } });
        fake.emit({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: '{not valid json',
        });
      }).not.toThrow();
      expect(fake.connection.error).toHaveBeenCalled();
    });
  });
});
