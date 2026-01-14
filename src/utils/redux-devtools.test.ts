import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { FreezerMiddleware, supportChromeExtension, FreezerState } from './redux-devtools';

describe('Redux DevTools Integration', () => {
  let happyWindow: Window;
  let windowRef: any;

  beforeEach(() => {
    happyWindow = new Window();
    windowRef = happyWindow.window;
    // Set up global window for tests
    (globalThis as any).window = windowRef;
  });

  afterEach(() => {
    happyWindow.close();
    delete (globalThis as any).window;
  });

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
      const middleware = FreezerMiddleware(mockState);
      expect(typeof middleware).toBe('function');
    });

    test('middleware returns StoreEnhancer', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      const next = vi.fn(() => mockStore);
      const storeEnhancer = middleware(next);
      expect(typeof storeEnhancer).toBe('function');
    });

    test('StoreEnhancer calls next with reducer', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      const next = vi.fn(() => mockStore);
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      expect(next).toHaveBeenCalledTimes(1);
      expect(typeof next.mock.calls[0][0]).toBe('function');
    });

    test('sets up afterAll event listener on state', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      const next = vi.fn(() => mockStore);
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      expect(mockState.on).toHaveBeenCalledWith('afterAll', expect.any(Function));
    });

    test('reducer handles INIT action', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      let capturedReducer: any;
      const next = vi.fn((reducer) => {
        capturedReducer = reducer;
        return mockStore;
      });
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      // Call the reducer with INIT action
      capturedReducer({ count: 5 }, { type: '@@INIT' });

      expect(mockState.set).toHaveBeenCalledWith({ count: 5 });
      expect(mockState.get).toHaveBeenCalled();
    });

    test('reducer returns state from State.get()', () => {
      mockState.get = vi.fn(() => ({ count: 42 }));
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      let capturedReducer: any;
      const next = vi.fn((reducer) => {
        capturedReducer = reducer;
        return mockStore;
      });
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      const result = capturedReducer({}, { type: 'SOME_ACTION' });

      expect(result).toEqual({ count: 42 });
    });

    test('afterAll callback dispatches actions to store', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      let afterAllCallback: any;
      mockState.on = vi.fn((event, callback) => {
        if (event === 'afterAll') {
          afterAllCallback = callback;
        }
      });
      const next = vi.fn(() => mockStore);
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      // Simulate a freezer event
      afterAllCallback.call(mockState, 'CUSTOM_EVENT', 'arg1', 'arg2');

      expect(mockStore.dispatch).toHaveBeenCalledWith({
        type: 'CUSTOM_EVENT',
        args: ['arg1', 'arg2'],
      });
    });

    test('afterAll callback skips dispatch when skipDispatch is set', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      let afterAllCallback: any;
      mockState.on = vi.fn((event, callback) => {
        if (event === 'afterAll') {
          afterAllCallback = callback;
        }
      });
      const next = vi.fn(() => mockStore);
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      // Set skipDispatch flag
      mockState.skipDispatch = 1;
      afterAllCallback.call(mockState, 'CUSTOM_EVENT');

      expect(mockStore.dispatch).not.toHaveBeenCalled();
      expect(mockState.skipDispatch).toBe(0);
    });

    test('afterAll callback ignores update events', () => {
      const middleware = FreezerMiddleware(mockState);
      const mockStore = createMockStore();
      let afterAllCallback: any;
      mockState.on = vi.fn((event, callback) => {
        if (event === 'afterAll') {
          afterAllCallback = callback;
        }
      });
      const next = vi.fn(() => mockStore);
      const storeEnhancer = middleware(next);

      storeEnhancer(vi.fn(), {});

      afterAllCallback.call(mockState, 'update');

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('supportChromeExtension', () => {
    test('returns a store with dispatch method', () => {
      const mockState: FreezerState = {
        get: vi.fn(() => ({})),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };

      // Ensure no devtools extension
      delete windowRef.__REDUX_DEVTOOLS_EXTENSION__;

      const store = supportChromeExtension(mockState);

      expect(store).toHaveProperty('dispatch');
      expect(store).toHaveProperty('getState');
      expect(store).toHaveProperty('subscribe');
    });

    test('works with devtools extension', () => {
      const mockState: FreezerState = {
        get: vi.fn(() => ({})),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };

      // Mock devtools extension
      const mockEnhancer = vi.fn((createStore: any) => createStore);
      windowRef.__REDUX_DEVTOOLS_EXTENSION__ = vi.fn(() => mockEnhancer);

      const store = supportChromeExtension(mockState);

      expect(windowRef.__REDUX_DEVTOOLS_EXTENSION__).toHaveBeenCalled();
      expect(store).toHaveProperty('dispatch');
    });

    test('dispatch triggers state listener setup', () => {
      const mockState: FreezerState = {
        get: vi.fn(() => ({ value: 'initial' })),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };

      delete windowRef.__REDUX_DEVTOOLS_EXTENSION__;

      const store = supportChromeExtension(mockState);

      // Dispatch an action
      store.dispatch({ type: 'TEST_ACTION' });

      // State.on should have been called to set up afterAll listener
      expect(mockState.on).toHaveBeenCalledWith('afterAll', expect.any(Function));
    });
  });

  describe('Store created by supportChromeExtension', () => {
    let mockState: FreezerState;
    let store: any;

    beforeEach(() => {
      mockState = {
        get: vi.fn(() => ({ count: 0 })),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };

      delete windowRef.__REDUX_DEVTOOLS_EXTENSION__;
      store = supportChromeExtension(mockState);
    });

    test('getState returns current state', () => {
      const state = store.getState();
      expect(state).toEqual({ count: 0 });
    });

    test('subscribe adds a listener', () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      expect(typeof unsubscribe).toBe('function');
    });

    test('subscribe listener is called on dispatch', () => {
      const listener = vi.fn();
      store.subscribe(listener);

      store.dispatch({ type: 'INCREMENT' });

      expect(listener).toHaveBeenCalled();
    });

    test('unsubscribe removes the listener', () => {
      const listener = vi.fn();
      const unsubscribe = store.subscribe(listener);

      unsubscribe();
      store.dispatch({ type: 'INCREMENT' });

      expect(listener).not.toHaveBeenCalled();
    });

    test('multiple listeners can be subscribed', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      store.subscribe(listener1);
      store.subscribe(listener2);

      store.dispatch({ type: 'INCREMENT' });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    test('dispatch returns the action', () => {
      const action = { type: 'TEST_ACTION' };
      const result = store.dispatch(action);

      expect(result).toEqual(action);
    });
  });

  describe('DevToolsConfig', () => {
    test('supportChromeExtension accepts config options', () => {
      const mockState: FreezerState = {
        get: vi.fn(() => ({})),
        set: vi.fn(),
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };

      // Mock devtools extension that captures config
      let capturedConfig: any = null;
      windowRef.__REDUX_DEVTOOLS_EXTENSION__ = vi.fn((config) => {
        capturedConfig = config;
        return (createStore: any) => createStore;
      });

      supportChromeExtension(mockState, {
        name: 'Test App',
        maxAge: 100,
        features: {
          jump: true,
          skip: true,
        },
      });

      expect(capturedConfig).toEqual({
        name: 'Test App',
        maxAge: 100,
        features: {
          jump: true,
          skip: true,
        },
      });
    });
  });

  describe('Time-travel debugging (set method)', () => {
    test('reducer calls State.set on INIT action', () => {
      const setSpy = vi.fn();
      const mockState: FreezerState = {
        get: vi.fn(() => ({ initialValue: true })),
        set: setSpy,
        skipDispatch: 0,
        trigger: vi.fn(),
        on: vi.fn(),
      };

      const mockDevToolsStore = {
        dispatch: vi.fn(),
        getState: vi.fn(() => ({ computedStates: [] })),
      };

      const mockStore = {
        dispatch: vi.fn(),
        liftedStore: mockDevToolsStore,
        devToolsStore: mockDevToolsStore,
      };

      const middleware = FreezerMiddleware(mockState);
      let capturedReducer: any;
      const next = vi.fn((reducer) => {
        capturedReducer = reducer;
        return mockStore;
      });

      middleware(next)(vi.fn(), {});

      // Call reducer with INIT action
      capturedReducer({ restoredState: true }, { type: '@@INIT' });

      expect(setSpy).toHaveBeenCalledWith({ restoredState: true });
    });
  });
});
