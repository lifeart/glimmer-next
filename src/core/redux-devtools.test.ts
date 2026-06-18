// @vitest-environment happy-dom
import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import {
  FreezerMiddleware,
  supportChromeExtension,
  enableReduxDevtools,
  disableReduxDevtools,
  isDevToolsRestoring,
  snapshotState,
  devtoolsPendingCount,
  createCellState,
  type FreezerState,
} from './redux-devtools';
import { Component } from './component';
import { RENDERED_NODES_PROPERTY, addToTree, $template } from './shared';
import { $_c, $_args, $_edp } from './dom';
import { cell, cellFor } from './reactive';
import { renderElement } from './render-core';
import { runDestructors } from './destroy';
import { TREE } from './tree';
import { createDOMFixture, type DOMFixture } from './__test-utils__';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../plugins/runtime-compiler';

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

    devTest('dispatches a snapshot when a (global) cell changes', async () => {
      const fake = installFakeExtension();
      enableReduxDevtools();

      const c = cell(1, 'devtools-dispatch');
      c.update(2);
      await flushMicrotasks();

      expect(fake.connection.send).toHaveBeenCalled();
      const state = fake.lastSendState() as any;
      const globals = state.$globals;
      const key = Object.keys(globals).find((k) =>
        k.startsWith('devtools-dispatch#'),
      );
      expect(key).toBeTruthy();
      expect(globals[key!]).toBe(2);
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
      // Two distinct cells changed -> a coalesced, informative batch label.
      // Both are module-level (no tree owner) so they share the $globals owner.
      expect(action.type).toBe('update $globals (2 cells)');
      expect(action.count).toBe(2);
      // Buffer fully drained after the flush — no retention across snapshots.
      expect(devtoolsPendingCount()).toBe(0);
    });

    devTest('createCellState snapshots + restores via the freezer interface', () => {
      const c = cell(100, 'devtools-cellstate');
      const snap = createCellState().get() as any;
      const key = Object.keys(snap.$globals).find((k) =>
        k.startsWith('devtools-cellstate#'),
      )!;
      expect(snap.$globals[key]).toBe(100);

      createCellState().set({ $globals: { [key]: 200 } });
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

  // -------------------------------------------------------------------------
  // Tree-shaped state / informative actions / leak-by-construction / redo
  // (dev-only — these mount a real component tree)
  // -------------------------------------------------------------------------
  describe('component-tree state (dev-only)', () => {
    let fixture: DOMFixture;

    beforeEach(() => {
      fixture = createDOMFixture();
      setupGlobalScope();
      const g = globalThis as Record<string, unknown>;
      Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
        g[name] = value;
      });
    });

    afterEach(() => {
      disableReduxDevtools();
      fixture.cleanup();
    });

    /** Render a (class) component under a fresh parent and return the parent so
     * the whole subtree can be torn down with `runDestructors`. */
    function mount(Root: any, args: Record<string, unknown> = {}) {
      const parent = new Component({});
      (parent as any)[RENDERED_NODES_PROPERTY] = [];
      addToTree(fixture.root, parent);
      const rendered = $_c(
        Root,
        $_args(args, false, $_edp as any),
        parent,
      );
      renderElement(fixture.api, parent, fixture.container, rendered);
      return parent;
    }

    /** Depth-first search of the tree-shaped state for the first node whose
     * label starts with `${classPrefix}#`. Skips the `$state`/`$globals` buckets. */
    function findNode(state: any, classPrefix: string): any {
      for (const key of Object.keys(state)) {
        if (key === '$state' || key === '$globals') continue;
        if (key.startsWith(`${classPrefix}#`)) return state[key];
        const found = findNode(state[key], classPrefix);
        if (found) return found;
      }
      return null;
    }

    /** Live component id for the first node whose class name matches. */
    function idOf(name: string): number {
      return [...TREE.keys()].find(
        (id) => TREE.get(id)?.constructor?.name === name,
      )!;
    }

    /** Live component instance for the first node whose class name matches. */
    function nodeOf(name: string): any {
      return TREE.get(idOf(name)) as any;
    }

    function Counter() {
      return class Counter extends Component {
        _count = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_count');
        }
        [$template] = template('<span class="count">{{this._count}}</span>');
      };
    }

    devTest('snapshot mirrors the mounted component tree (nested, readable)', () => {
      const C = Counter();
      class App extends Component {
        _title = 'Hello';
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_title');
        }
        [$template] = template(
          '<div><h1>{{this._title}}</h1><Counter /></div>',
          { scope: { Counter: C } },
        );
      }

      mount(App);
      const state = snapshotState() as any;

      const app = findNode(state, 'App');
      expect(app).toBeTruthy();
      expect(app.$state._title).toBe('Hello');

      // Counter is NESTED under App (not a sibling, not flattened).
      const counter = findNode(app, 'Counter');
      expect(counter).toBeTruthy();
      expect(counter.$state._count).toBe(0);
    });

    devTest('action label reflects the changed component/prop (single change)', async () => {
      const fake = installFakeExtension();
      class App extends Component {
        _title = 'Hello';
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_title');
        }
        [$template] = template('<h1>{{this._title}}</h1>');
      }
      mount(App);
      enableReduxDevtools();

      (fixture.container.querySelector('h1') as any); // ensure rendered
      // Mutate the tracked prop through its cell-backed accessor.
      const app = TREE.get(
        [...TREE.keys()].find(
          (id) => TREE.get(id)?.constructor?.name === 'App',
        )!,
      ) as any;
      app._title = 'World';
      await flushMicrotasks();

      const _calls = fake.connection.send.mock.calls;
      const [action] = _calls[_calls.length - 1];
      expect(action.type).toBe('set App._title');
      expect(action.count).toBe(1);
      expect(action.changes[0].from).toBe('Hello');
      expect(action.changes[0].to).toBe('World');
      expect(action.changes[0].path).toMatch(/^App#\d+\._title$/);
    });

    devTest('action label summarises a single-owner multi-cell batch', async () => {
      const fake = installFakeExtension();
      class Multi extends Component {
        a = 0;
        b = 0;
        c = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, 'a');
          cellFor(this as any, 'b');
          cellFor(this as any, 'c');
        }
        [$template] = template('<i>{{this.a}}{{this.b}}{{this.c}}</i>');
      }
      mount(Multi);
      enableReduxDevtools();

      const node = TREE.get(
        [...TREE.keys()].find(
          (id) => TREE.get(id)?.constructor?.name === 'Multi',
        )!,
      ) as any;
      node.a = 1;
      node.b = 2;
      node.c = 3;
      await flushMicrotasks();

      const _calls = fake.connection.send.mock.calls;
      const [action] = _calls[_calls.length - 1];
      expect(action.type).toMatch(/^update Multi#\d+ \(3 cells\)$/);
      expect(action.count).toBe(3);
    });

    devTest('action label collapses a large batch', async () => {
      const fake = installFakeExtension();
      enableReduxDevtools();

      const cells = Array.from({ length: 12 }, (_, i) =>
        cell(0, `big-batch-${i}`),
      );
      cells.forEach((c, i) => c.update(i + 1));
      await flushMicrotasks();

      const _calls = fake.connection.send.mock.calls;
      const [action] = _calls[_calls.length - 1];
      expect(action.type).toBe('update: 12 cells');
      expect(action.count).toBe(12);
      // Payload capped, with a truncated count.
      expect(action.changes.length).toBeLessThanOrEqual(12);
      expect(action.truncated ?? 0).toBe(12 - action.changes.length);
    });

    // --- Axis 2: leak by construction -------------------------------------
    devTest('destroyed components leave zero trace in the snapshot (no leak)', async () => {
      const C = Counter();
      class App extends Component {
        _title = 'x';
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_title');
        }
        [$template] = template('<div>{{this._title}}<Counter /></div>', {
          scope: { Counter: C },
        });
      }

      const parent = mount(App);

      // Present before destruction.
      let state = snapshotState() as any;
      expect(findNode(state, 'App')).toBeTruthy();
      expect(findNode(state, 'Counter')).toBeTruthy();

      // Tear the whole subtree down (runs the addToTree destructors that drop
      // the nodes from TREE/CHILD/PARENT).
      await Promise.all(runDestructors(parent, [], true, fixture.api));

      // Absent after destruction — gone from TREE and from the snapshot, and
      // NOT resurrected via the $globals bucket either (component-owned cells
      // of dead components are excluded).
      state = snapshotState() as any;
      expect(findNode(state, 'App')).toBeNull();
      expect(findNode(state, 'Counter')).toBeNull();
      const globals = state.$globals ?? {};
      expect(
        Object.keys(globals).some((k) => k.includes('_title') || k.includes('_count')),
      ).toBe(false);

      // The integration itself holds nothing across snapshots.
      expect(devtoolsPendingCount()).toBe(0);
    });

    // --- Axis 3: redo / forward time-travel -------------------------------
    devTest('time-travel restores backward AND forward without re-dispatching', async () => {
      const fake = installFakeExtension();
      class App extends Component {
        _count = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_count');
        }
        [$template] = template('<b class="c">{{this._count}}</b>');
      }
      mount(App);
      enableReduxDevtools();

      const node = TREE.get(
        [...TREE.keys()].find(
          (id) => TREE.get(id)?.constructor?.name === 'App',
        )!,
      ) as any;
      const dom = () =>
        fixture.container.querySelector('.c')!.textContent;

      // Build a timeline: 0 -> 1 -> 2 -> 3, capturing each computed state as
      // the monitor would.
      const timeline: string[] = [JSON.stringify(snapshotState())]; // value 0
      for (const v of [1, 2, 3]) {
        node._count = v;
        await flushMicrotasks();
        timeline.push(JSON.stringify(snapshotState()));
      }
      expect(node._count).toBe(3);
      expect(dom()).toBe('3');

      const sendsBefore = fake.connection.send.mock.calls.length;
      const jump = (i: number) =>
        fake.emit({
          type: 'DISPATCH',
          payload: { type: 'JUMP_TO_STATE' },
          state: timeline[i],
        });

      // Step BACKWARD: 3 -> 2 -> 1 -> 0, asserting cell + DOM at each.
      for (const i of [2, 1, 0]) {
        jump(i);
        expect(node._count).toBe(i);
        expect(dom()).toBe(String(i));
      }

      // Step FORWARD (redo): 0 -> 1 -> 2 -> 3.
      for (const i of [1, 2, 3]) {
        jump(i);
        expect(node._count).toBe(i);
        expect(dom()).toBe(String(i));
      }

      // A jump to an arbitrary index also works.
      jump(1);
      expect(node._count).toBe(1);
      expect(dom()).toBe('1');

      // No re-dispatch happened during ANY restore (notifier stayed silent).
      expect(fake.connection.send.mock.calls.length).toBe(sendsBefore);
      await flushMicrotasks();
      expect(fake.connection.send.mock.calls.length).toBe(sendsBefore);
      expect(isDevToolsRestoring()).toBe(false);
    });

    devTest('RESET and COMMIT manage the committed baseline', async () => {
      const fake = installFakeExtension();
      class App extends Component {
        _count = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_count');
        }
        [$template] = template('<b class="c">{{this._count}}</b>');
      }
      mount(App);
      enableReduxDevtools();

      const node = TREE.get(
        [...TREE.keys()].find(
          (id) => TREE.get(id)?.constructor?.name === 'App',
        )!,
      ) as any;

      node._count = 5;
      await flushMicrotasks();
      expect(node._count).toBe(5);

      // RESET -> back to the connect-time baseline (0).
      fake.emit({ type: 'DISPATCH', payload: { type: 'RESET' } });
      expect(node._count).toBe(0);

      // COMMIT at 7 -> RESET now returns to 7.
      node._count = 7;
      await flushMicrotasks();
      fake.emit({ type: 'DISPATCH', payload: { type: 'COMMIT' } });
      node._count = 9;
      await flushMicrotasks();
      fake.emit({ type: 'DISPATCH', payload: { type: 'RESET' } });
      expect(node._count).toBe(7);
    });

    // --- Feature A: big-value summaries + cell denylist --------------------
    devTest('summarizes a big array cell; keeps a small one full + restorable', () => {
      class List extends Component {
        _big: number[] = [];
        _small: number[] = [];
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_big');
          cellFor(this as any, '_small');
        }
        [$template] = template('<u>{{this._big.length}}-{{this._small.length}}</u>');
      }
      mount(List);
      const node = nodeOf('List');
      node._big = Array.from({ length: 1000 }, (_, i) => i);
      node._small = [1, 2, 3];

      const state = snapshotState() as any;
      const list = findNode(state, 'List');
      // Big array -> compact summary marker (no 1000-element dump).
      expect(list.$state._big).toEqual({
        $summary: 'Array(1000)',
        $len: 1000,
        $preview: [0, 1, 2, 3, 4],
      });
      // The inspector value is genuinely small.
      expect(JSON.stringify(list.$state._big).length).toBeLessThan(80);
      // Small array kept in full (and therefore restorable).
      expect(list.$state._small).toEqual([1, 2, 3]);
    });

    devTest('restore SKIPS a summarized cell (no corruption); restores small ones', () => {
      const fake = installFakeExtension();
      class List extends Component {
        _big: number[] = [];
        _small: number[] = [];
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_big');
          cellFor(this as any, '_small');
        }
        [$template] = template('<u>{{this._small.length}}</u>');
      }
      mount(List);
      enableReduxDevtools();
      const node = nodeOf('List');

      const bigA = Array.from({ length: 1000 }, (_, i) => i);
      node._big = bigA;
      node._small = [1, 2, 3];

      // Timeline target: the big cell is a summary marker in this snapshot.
      const target = JSON.stringify(snapshotState());
      expect(target).toContain('"$summary":"Array(1000)"');

      // Move on: swap the big array + change the small one.
      const bigB = Array.from({ length: 1000 }, (_, i) => i + 1);
      node._big = bigB;
      node._small = [9];

      // JUMP back to the captured target.
      fake.emit({
        type: 'DISPATCH',
        payload: { type: 'JUMP_TO_STATE' },
        state: target,
      });

      // Small (under-cap) cell IS restored.
      expect(node._small).toEqual([1, 2, 3]);
      // Big (summarized) cell is UNTOUCHED — it kept its real runtime value and
      // was never overwritten with the `{$summary}` marker.
      expect(node._big).toBe(bigB);
      expect(Array.isArray(node._big)).toBe(true);
      expect(node._big.length).toBe(1000);
    });

    devTest('cellsDenylist excludes matching cells from snapshot AND timeline', async () => {
      const fake = installFakeExtension();
      class Noisy extends Component {
        _visible = 1;
        animationFrame = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_visible');
          cellFor(this as any, 'animationFrame');
        }
        [$template] = template('<u>{{this._visible}}</u>');
      }
      mount(Noisy);
      enableReduxDevtools({ cellsDenylist: ['*.animationFrame'] });
      const node = nodeOf('Noisy');

      const state = snapshotState() as any;
      const n = findNode(state, 'Noisy');
      expect(n.$state._visible).toBe(1);
      // Denylisted path is absent from the snapshot entirely.
      expect('animationFrame' in n.$state).toBe(false);

      // Updating ONLY a denylisted cell produces no timeline entry (de-noised).
      const sendsBefore = fake.connection.send.mock.calls.length;
      node.animationFrame = 42;
      await flushMicrotasks();
      expect(fake.connection.send.mock.calls.length).toBe(sendsBefore);
    });

    // --- Feature B: dispatch-to-set + DOM highlight ------------------------
    devTest('SET dispatch writes a live cell + re-renders, with no echo action', async () => {
      const fake = installFakeExtension();
      class App extends Component {
        _count = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_count');
        }
        [$template] = template('<b class="c">{{this._count}}</b>');
      }
      mount(App);
      enableReduxDevtools();
      const node = nodeOf('App');
      const path = `App#${idOf('App')}._count`;
      const sendsBefore = fake.connection.send.mock.calls.length;

      // `value` arrives as a JSON string from the dispatcher.
      fake.emit({
        type: 'ACTION',
        payload: JSON.stringify({ type: 'SET', path, value: '42' }),
      });

      expect(node._count).toBe(42);
      expect(fixture.container.querySelector('.c')!.textContent).toBe('42');
      // No echo: a SET must not re-dispatch back to the monitor.
      await flushMicrotasks();
      expect(fake.connection.send.mock.calls.length).toBe(sendsBefore);
      expect(isDevToolsRestoring()).toBe(false);
    });

    devTest('SET with a bad path warns and does not throw', () => {
      const fake = installFakeExtension();
      enableReduxDevtools();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(() => {
          fake.emit({
            type: 'ACTION',
            payload: JSON.stringify({
              type: 'SET',
              path: 'Ghost#999._x',
              value: '1',
            }),
          });
        }).not.toThrow();
        expect(warn).toHaveBeenCalled();
        expect(fake.connection.error).toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    devTest('HIGHLIGHT creates then removes a DOM overlay; SET auto-flashes', () => {
      const fake = installFakeExtension();
      class App extends Component {
        _count = 0;
        constructor(args: any) {
          super(args);
          cellFor(this as any, '_count');
        }
        [$template] = template('<b class="c">{{this._count}}</b>');
      }
      mount(App);
      enableReduxDevtools();
      const id = idOf('App');
      const overlay = () =>
        document.querySelector('[data-gxt-devtools-overlay]');

      expect(overlay()).toBeNull();

      vi.useFakeTimers();
      try {
        // HIGHLIGHT -> overlay appears over the component's bounds...
        fake.emit({
          type: 'ACTION',
          payload: JSON.stringify({ type: 'HIGHLIGHT', path: `App#${id}` }),
        });
        expect(overlay()).not.toBeNull();
        // ...and auto-removes after ~1s. (getBounds is empty in happy-dom, so
        // the overlay is 0-size — the lifecycle still runs without throwing.)
        vi.advanceTimersByTime(1000);
        expect(overlay()).toBeNull();

        // A SET auto-flashes the owning component too.
        fake.emit({
          type: 'ACTION',
          payload: JSON.stringify({
            type: 'SET',
            path: `App#${id}._count`,
            value: '5',
          }),
        });
        expect(overlay()).not.toBeNull();
        vi.advanceTimersByTime(1000);
        expect(overlay()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
