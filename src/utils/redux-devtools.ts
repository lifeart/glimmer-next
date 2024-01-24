// inspired by https://www.npmjs.com/package/freezer-redux-devtools?activeTab=code
var ActionTypes = {
	INIT: '@@INIT',
	PERFORM_ACTION: 'PERFORM_ACTION',
	TOGGLE_ACTION: 'TOGGLE_ACTION'
};

type Listener = () => void;

/**
 * Redux middleware to make freezer and devtools
 * talk to each other.
 * @param {Freezer} State Freezer's app state.
 */
export function FreezerMiddleware( State ){
	return function( next ){
		return function StoreEnhancer( someReducer, someState ){
			var commitedState = State.get(),
				lastAction = 0,
				/**
				 * Freezer reducer will trigger events on any
				 * devtool action to synchronize freezer's and
				 * devtool's states.
				 *
				 * @param  {Object} state  Current devtool state.
				 * @param  {Object} action Action being dispatched.
				 * @return {Object}        Freezer state after the action.
				 */
				reducer = function( state, action ){
					if( action.type == ActionTypes.INIT ){
						State.set( state || commitedState );
					}
					else if( lastAction != ActionTypes.PERFORM_ACTION ) {
						// Flag that we are dispatching to not
						// to dispatch the same action twice
						State.skipDispatch = 1;
						State.trigger.apply( State, [ action.type ].concat( action.arguments || [] ) );
					}
					// The only valid state is freezer's one.
					return State.get();
				},
				store = next( reducer ),
				liftedStore = store.liftedStore,
				dtStore = store.devToolsStore || store.liftedStore,

				toolsDispatcher = dtStore.dispatch
			;

			// Override devTools store's dispatch, to set commitedState
			// on Commit action.
			dtStore.dispatch = function( action ){
				lastAction = action.type;

				// If we are using redux-devtools we need to reset the state
				// to the last valid one manually
				if( liftedStore && lastAction == ActionTypes.TOGGLE_ACTION ){
					var states = dtStore.getState().computedStates,
						nextValue = states[ action.id - 1].state
					;

					State.set( nextValue );
				}

				toolsDispatcher.apply( dtStore, arguments );

				return action;
			};

			// Dispatch any freezer "fluxy" event to let the devTools
			// know about the update.
			State.on('afterAll', function( reactionName ){
				if( reactionName == 'update')
					return;

				// We don't dispatch if the flag is true
				if( this.skipDispatch )
					this.skipDispatch = 0;
				else {
					var args = [].slice.call( arguments, 1 );
					store.dispatch({ type: reactionName, args: args });
				}
			});

			return store;
		};
	};
}

/**
 * Binds freezer store to the chrome's redux-devtools extension.
 * @param {Freezer} State Freezer's app state
 */
export function supportChromeExtension( State ){
    var devtools = window.__REDUX_DEVTOOLS_EXTENSION__
  ? window.__REDUX_DEVTOOLS_EXTENSION__()
  : (f) => f;
	
	compose(
		FreezerMiddleware( State ),
		devtools
	)(createStore)( function( state ){
		return state;
	});
}


/**
 * Creates a valid redux store. Copied directly from redux.
 * https://github.com/rackt/redux
 */
function createStore(reducer: any, initialState: any) {


  if (typeof reducer !== 'function') {
    throw new Error('Expected the reducer to be a function.');
  }

  var currentReducer = reducer;
  var currentState = initialState;
  var listeners: Listener[] = [];
  var isDispatching = false;
  var ActionTypes = {
	 INIT: '@@redux/INIT'
  };

  function getState() {
    return currentState;
  }

  function subscribe(listener: Listener) {
    listeners.push(listener);
    var isSubscribed = true;

    return function unsubscribe() {
      if (!isSubscribed) {
        return;
      }

      isSubscribed = false;
      var index = listeners.indexOf(listener);
      listeners.splice(index, 1);
    };
  }

  function dispatch(action: { type: string | undefined }) {
    if (typeof action.type === 'undefined') {
      throw new Error('Actions may not have an undefined "type" property. ' + 'Have you misspelled a constant?');
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

    listeners.slice().forEach(function (listener) {
      return listener();
    });
    return action;
  }

  function replaceReducer(nextReducer: any) {
    currentReducer = nextReducer;
    dispatch({ type: ActionTypes.INIT });
  }

  // When a store is created, an "INIT" action is dispatched so that every
  // reducer returns their initial state. This effectively populates
  // the initial state tree.
  dispatch({ type: ActionTypes.INIT });

  return {
    dispatch: dispatch,
    subscribe: subscribe,
    getState: getState,
    replaceReducer: replaceReducer
  };
}

/**
 * Composes single-argument functions from right to left.
 * Copied directly from redux.
 * https://github.com/rackt/redux
 */
function compose() {
  for (var _len = arguments.length, funcs = Array(_len), _key = 0; _key < _len; _key++) {
    funcs[_key] = arguments[_key];
  }

  return function (arg: any) {
    return funcs.reduceRight(function (composed, f) {
      return f(composed);
    }, arg);
  };
}
