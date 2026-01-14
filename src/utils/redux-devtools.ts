// inspired by https://www.npmjs.com/package/freezer-redux-devtools?activeTab=code

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

declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION__?: (config?: DevToolsConfig) => (createStore: any) => any;
  }
}

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
  on(eventName: string, callback: (this: FreezerState, reactionName: string, ...args: unknown[]) => void): void;
}

/**
 * Redux middleware to make freezer and devtools
 * talk to each other.
 * @param {Freezer} State Freezer's app state.
 */
export function FreezerMiddleware(State: FreezerState) {
  return function (next: any) {
    return function StoreEnhancer(_someReducer: any, _someState: any) {
      const commitedState = State.get();
      let lastAction: string | number = 0;

      /**
       * Freezer reducer will trigger events on any
       * devtool action to synchronize freezer's and
       * devtool's states.
       */
      const reducer = function (state: any, action: { type: string; arguments?: unknown[]; id?: number }) {
        if (action.type === ActionTypes.INIT) {
          State.set(state || commitedState);
        } else if (lastAction !== ActionTypes.PERFORM_ACTION) {
          // Flag that we are dispatching to not
          // to dispatch the same action twice
          State.skipDispatch = 1;
          State.trigger(action.type, ...(action.arguments || []));
        }
        // The only valid state is freezer's one.
        return State.get();
      };

      const store = next(reducer);
      const liftedStore = store.liftedStore;
      const dtStore = store.devToolsStore || store.liftedStore;

      // Only set up devtools integration if dtStore is available
      if (dtStore) {
        const toolsDispatcher = dtStore.dispatch;

        // Override devTools store's dispatch, to set commitedState
        // on Commit action.
        dtStore.dispatch = function (action: { type: string; id?: number }) {
          lastAction = action.type;

          // If we are using redux-devtools we need to reset the state
          // to the last valid one manually
          if (liftedStore && lastAction === ActionTypes.TOGGLE_ACTION) {
            const states = dtStore.getState().computedStates;
            const nextValue = states[action.id! - 1].state;
            State.set(nextValue);
          }

          toolsDispatcher.call(dtStore, action);
          return action;
        };
      }

      // Dispatch any freezer "fluxy" event to let the devTools
      // know about the update.
      State.on('afterAll', function (this: FreezerState, reactionName: string, ...restArgs: unknown[]) {
        if (reactionName === 'update') {
          return;
        }

        // We don't dispatch if the flag is true
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
 * Binds freezer store to the chrome's redux-devtools extension.
 * @param {Freezer} State Freezer's app state
 * @param {DevToolsConfig} config Optional devtools configuration
 */
export function supportChromeExtension(State: FreezerState, config?: DevToolsConfig) {
  const devtools = window.__REDUX_DEVTOOLS_EXTENSION__
    ? window.__REDUX_DEVTOOLS_EXTENSION__(config)
    : (f: any) => f;

  return compose(
    FreezerMiddleware(State),
    devtools
  )(createStore)((state: any) => state);
}


/**
 * Creates a valid redux store. Copied directly from redux.
 * https://github.com/rackt/redux
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
      throw new Error('Actions may not have an undefined "type" property. Have you misspelled a constant?');
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
  // reducer returns their initial state. This effectively populates
  // the initial state tree.
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
 * Copied directly from redux.
 * https://github.com/rackt/redux
 */
function compose(...funcs: Array<(arg: any) => any>) {
  return function (arg: any) {
    return funcs.reduceRight((composed, f) => f(composed), arg);
  };
}

