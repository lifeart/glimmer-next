import * as backburner from 'backburner.js';
import { getRoot } from '../dom';
import { $_debug_args, CHILD, COMPONENT_ID_PROPERTY, getBounds, TREE } from '../shared';
import { Component } from '..';
import { Cell, MergedCell, getCells, getMergedCells } from '../reactive';
import { $args } from '../shared';
import { inspect } from '@/utils/inspector';

const genericProxy = new Proxy(
  {},
  {
    get(_, key) {
      console.log('genericProxy', key);
      return new Proxy(
        {},
        {
          get(_, key1) {
            console.log('genericProxy', key, key1);
          },
        },
      );
    },
  },
);

const dataAdapter = {
  watchModelTypes(
    typesAdded: (items: any[]) => void,
    typesUpdated: (items: any[]) => void,
  ) {
    typesAdded([
      {
        columns: this.columnsForType('cell'),
        count: 1,
        name: 'Cell',
        object: Cell,
      },
      {
        columns: this.columnsForType('merged-cell'),
        count: 1,
        name: 'MergedCell',
        object: MergedCell,
      },
    ]);
    console.log('watchModelTypes', arguments, typesUpdated);
  },
  columnsForType(item: 'cell' | 'merged-cell') {
    if (item === 'cell') {
      let columns = [
        {
          name: 'id',
          desc: 'Id',
        },
        {
          name: 'value',
          desc: 'Value',
        },
        {
          name: 'name',
          desc: 'Name',
        },
      ];
      return columns;
    } else {
      // relatedTags
      let columns = [
        {
          name: 'id',
          desc: 'Id',
        },
        {
          name: 'isConst',
          desc: 'Is Const',
        },
        {
          name: 'isRemoved',
          desc: 'Is Destroyed',
        },
        {
          name: 'name',
          desc: 'Name',
        },
        {
          name: 'value',
          desc: 'Value',
        },
      ];
      return columns;
    }
  },
  acceptsModelName: true,
  // @ts-expect-error
  getRecordFilterValues(item: Cell | MergedCell) {
    return {
      isNew: true,
      isModified: true,
      isClean: true,
    };
  },
  getRecordColor(item: Cell | MergedCell) {
    if (item instanceof Cell) {
      return 'red';
    } else {
      if (item.isConst) {
        return 'yellow';
      } else if (item.isDestroyed) {
        return 'gray';
      } else {
        return 'green';
      }
    }
  },
  getRecordColumnValues(item: Cell | MergedCell) {
    if (item instanceof Cell) {
      return {
        id: guidFor(item),
        value: item.value,
        name: item._debugName ?? '',
      };
    }
    return {
      id: guidFor(item),
      isConst: item.isConst,
      isRemoved: item.isDestroyed,
      name: item._debugName ?? '',
      value: item.value,
    };
  },
  getRecordSearchKeywords(item: Cell | MergedCell) {
    if (item instanceof Cell) {
      return [item.value, item._debugName ?? '', 'cell'];
    } else {
      return [item.value, item._debugName ?? '', 'merged-cell'];
    }
  },
  toRecord(item: Cell | MergedCell) {
    const result = {
      object: item,
      columnValues: this.getRecordColumnValues(item),
      searchKeywords: this.getRecordSearchKeywords(item),
      filterValues: this.getRecordFilterValues(item),
      color: this.getRecordColor(item),
    };
    return result;
  },
  watchRecords(
    modelName: string,
    recordsAdded: (arg: any[]) => void,
    recordsUpdated: (arg: any[]) => void,
    recordsRemoved: (arg: any[]) => void,
  ) {
    if (modelName === 'Cell') {
      recordsAdded(getCells().map((c) => this.toRecord(c)));
    } else if (modelName === 'MergedCell') {
      recordsAdded(
        getMergedCells()
          .filter((c) => {
            return !c.isDestroyed;
          })
          .map((c) => this.toRecord(c)),
      );
    }

    console.log('watchRecords', recordsUpdated, recordsRemoved);
  },
  getFilters() {
    return [
      { name: 'isNew', desc: 'New' },
      { name: 'isModified', desc: 'Modified' },
      { name: 'isClean', desc: 'Clean' },
    ];
  },
};

let guid = 0;
let guidObjects: WeakMap<any, string> = new WeakMap();
function guidFor(obj: unknown) {
  if (guidObjects.has(obj)) {
    return guidObjects.get(obj);
  }
  const id = String(++guid);
  guidObjects.set(obj, id);
  return id;
}

const router = {
  location: {
    formatURL(url: string) {
      return url;
    },
  },
  router: {
    // _routerMicrolib
    getRoute(routeName: string) {
      return {
        controllerName: routeName,
      };
    },
    recognizer: {
      names: {
        application: {
          segments: [
            {
              type: 4,
              value: '',
            },
            {
              type: 4,
              value: '',
            },
          ],
          handlers: [
            {
              handler: 'application',
              names: [],
              shouldDecodes: [],
            },
            {
              handler: 'index',
              names: [],
              shouldDecodes: [],
            },
          ],
        },
      },
    },
  },
  get currentUrl() {
    return window.location.href;
  },
  get currentPath() {
    return window.location.pathname;
  },
};

function proxyFor(parentKeyName: string) {
  return new Proxy({}, {
    get(_: any, key: string) {
      console.log(parentKeyName, key);
      return proxyFor(`${parentKeyName}.${key}`);
    },
  } as any);
}
class EmberApplication {
  __registry__: Record<string, unknown>;
  application: EmberApplication;
  constructor() {
    EmberApplication.apps.push(this);
    this.application = this;
    this.__registry__ = {
      resolver: {
        lookupDescription(name: string) {
          console.log('lookupDescription', name);
          return true;
        },
        describe(name: string) {
          console.log('describe', name);
        },
      },
    };
  }
  name = 'GlimmerNext';
  static apps: EmberApplication[] = [];
  _super() {
    console.log('_super');
  }
  static initializer(obj: {
    name: string;
    initialize: (app: EmberApplication) => void;
  }) {
    // console.log('initializer', obj);
    setTimeout(() => {
      obj.initialize(this.apps[0]);
    }, 100);
  }
  instanceInitializer(obj: {
    name: string;
    initialize: (app: EmberApplication) => void;
  }) {
    // console.log('instanceInitializer', obj);
    setTimeout(() => {
      // it's owner
      obj.initialize({
        // @ts-expect-error
        _lookupFactory(name: string) {
          // console.log('_lookupFactory', name);
          return proxyFor(name);
        },
        resolveRegistration(key: string) {
          // console.log('resolveRegistration', key);
          return proxyFor(key);
        },
        application: this,
        router: router,
        lookup(key: string) {
          if (key === 'router:main') {
            return router;
          } else if (key === 'data-adapter:main') {
            // https://github.com/emberjs/data/blob/5abe3c88b01c85b31e6dcc10e062b57df339bb03/packages/debug/addon/index.js#L91
            return dataAdapter;
          }
          console.log('lookup', key);
          return proxyFor(key);
        },
        reopen(obj: any) {
          // console.log('reopen', obj);
          Object.keys(obj).forEach((key) => {
            // @ts-ignore
            this[key as keyof typeof this] = obj[key];
          });
        },
      });
    }, 10);
  }
  reopen(obj: any) {
    Object.keys(obj).forEach((key) => {
      this[key as keyof typeof this] = obj[key];
    });
  }
  didBecomeReady() {
    console.log('didBecomeReady');
  }
}

class CoreObject {}
class EmberObject {}
class ObjectProxy {}
class ArrayProxy {}
class Service {}
class EmberComponent {}
class ComputedProperty {}

const objectMeta = new WeakMap();

const EmberProxy: any = new Proxy(
  {},
  {
    get(_, key) {
      if (key === 'get') {
        return function () {
          debugger;
        };
      } else if (key === 'set') {
        return function () {
          debugger;
        };
      } else if (key === 'computed') {
        return proxyFor('Ember.computed');
      } else if (key === 'cacheFor') {
        return function (obj: Record<string, unknown>, key: string) {
          // https://github.com/emberjs/ember.js/blob/main/packages/%40ember/-internals/metal/lib/computed_cache.ts#L3
          return obj[key];
        };
      } else if (key === 'Debug') {
        return {
          // @ts-expect-error
          registerDeprecationHandler(fn) {
            // console.log('Debug.registerDeprecationHandler', fn);
          },
          isComputed: false, // (0, _loader.emberSafeRequire)('@ember/-internals/metal')
          //  descriptorForDecorator,
          // descriptorForProperty
        };
      } else if (key === 'inspect') {
        return inspect;
      } else if (key === 'meta') {
        return function (obj: Record<string, unknown>) {
          if (objectMeta.has(obj)) {
            return objectMeta.get(obj);
          }
          objectMeta.set(obj, {
            _debugReferences: 0,
            peekDescriptors() {
              // console.log('peekDescriptors', arguments);
              return false;
            },
            forEachMixins() {
              // console.log('forEachMixins', arguments);
            },
            forEachDescriptors() {
              // console.log('forEachDescriptors', arguments);
            },
          });
          return objectMeta.get(obj);
        };
      } else if (key === 'ComputedProperty') {
        return ComputedProperty;
      }
      if (key === 'Component') {
        return EmberComponent;
      } else if (key === 'Service') {
        return Service;
      } else if (key === 'ObjectProxy') {
        return ObjectProxy;
      } else if (key === 'Object') {
        return EmberObject;
      } else if (key === 'ArrayProxy') {
        return ArrayProxy;
      } else if (key === 'PromiseProxyMixin') {
        return proxyFor('Ember.PromiseProxyMixin');
      } else if (key === 'Evented') {
        return proxyFor('Ember.Evented');
      } else if (key === 'Observable') {
        return proxyFor('Ember.Observable');
      } else if (key === 'Component') {
        return proxyFor('Ember.Component');
      } else if (key === 'NativeArray') {
        return proxyFor('Ember.NativeArray');
      } else if (key === 'MutableEnumerable') {
        return proxyFor('Ember.MutableEnumerable');
      } else if (key === 'MutableArray') {
        return proxyFor('Ember.MutableArray');
      } else if (key === 'CoreObject') {
        return CoreObject;
      } else if (key === 'ControllerMixin') {
        return proxyFor('Ember.ControllerMixin');
      } else if (key === 'ActionHandler') {
        return proxyFor('Ember.ActionHandler');
      } else if (key === 'ENV') {
        return {
          ENABLE_OPTIONAL_FEATURES: false,
          EXTEND_PROTOTYPES: {
            Array: false,
            Function: false,
            String: false,
          },
          LOG_STACKTRACE_ON_DEPRECATION: true,
          LOG_VERSION: true,
          RAISE_ON_DEPRECATION: false,
          STRUCTURED_PROFILE: false,
          _APPLICATION_TEMPLATE_WRAPPER: false,
          _TEMPLATE_ONLY_GLIMMER_COMPONENTS: true,
          _DEBUG_RENDER_TREE: true,
          _JQUERY_INTEGRATION: false,
          _DEFAULT_ASYNC_OBSERVERS: true,
          _RERENDER_LOOP_LIMIT: 1000,
          _DISABLE_PROPERTY_FALLBACK_DEPRECATION: false,
          EMBER_LOAD_HOOKS: {},
          FEATURES: {},
        };
      } else if (key === '_captureRenderTree') {
        function componentToRenderTree(component: Component<any>): any {
          const childs = Array.from(CHILD[component[COMPONENT_ID_PROPERTY]]).map((el) => TREE[el]);
          const componentName = component
            ? component.constructor.name
            : '(unknown)';
          const hasArgs = component && $args in component;
          const hasDebugArgs = component && $_debug_args in component;
          const hasArgsOrDebugArgs = hasArgs || hasDebugArgs;
          // const isUnstableChildWrapper = component && component.debugName && component.debugName.startsWith('UnstableChildWrapper');
          // if (component && !isUnstableChildWrapper && !hasArgs && !hasDebugArgs) {
          //   debugger;
          // }
          const possibleBounds = component ? getBounds(component) : [];
          let bounds: null | {
            firstNode: Node;
            lastNode: Node;
            parentElement: Node;
          } = null;
          if (possibleBounds.length === 1) {
            bounds = {
              firstNode: possibleBounds[0],
              lastNode: possibleBounds[0],
              parentElement: possibleBounds[0].parentNode!,
            };
          } else if (possibleBounds.length > 1) {
            bounds = {
              firstNode: possibleBounds[0],
              lastNode: possibleBounds[possibleBounds.length - 1],
              parentElement: possibleBounds[0].parentNode!,
            };
          }

          return {
            id: Math.random().toString(36).substr(2, 9),
            args: {
              named:
                component && hasArgsOrDebugArgs
                  ? {
                      get __ARGS__() {
                        if ($_debug_args in component) {
                          return component[$_debug_args] ?? {};
                        } else {
                          return component[$args] ?? {};
                        }
                      },
                    }
                  : {},
              positional: [],
            },
            instance: component,
            name: componentName,
            type: 'component',
            isInRemote: false,
            children:
              childs?.map((child) => componentToRenderTree(child)) ?? [],
            bounds,
            template: 'string',
          };
        }

        return function () {
          const root = getRoot();
          // @ts-expect-error typings error
          return [componentToRenderTree(root!)];
        };
      } else if (key === 'guidFor') {
        return guidFor;
      } else if (key === 'Application') {
        return EmberApplication;
      } else if (key === 'A') {
        return function () {
          // console.log('A', arguments);
          return [new EmberApplication()];
        };
      } else if (key === 'Namespace') {
        return {
          NAMESPACES: {},
        };
      } else if (key === 'libraries') {
        return {
          _registry: [
            { name: 'glimmer-next', version: 'latest' },
            { name: 'Ember', version: '3.16.0' },
          ],
        };
      } else if (key === 'VERSION') {
        return '3.16.0';
      } else if (key === 'default') {
        return EmberProxy;
      } else if (key === 'RSVP') {
        return {
          on() {
            // console.log('RSVP.on', arguments);
          },
          Promise: Promise,
          // @ts-expect-error
          configure(name: string, fn: () => void) {
            // console.log('RSVP.configure', name, fn);
          },
          default: {
            default: {
              Promise: Promise,
              configure(name: string, fn: () => void) {
                console.log('RSVP.configure', name, fn);
              },
            },
            Promise: Promise,
            configure(name: string, fn: () => void) {
              console.log('RSVP.configure', name, fn);
            },
          },
        };
      }
      // console.log('EmberProxy', key);
      return new Proxy(
        {},
        {
          // @ts-expect-error
          get(_, key1) {
            // backburner
            // console.log('EmberProxy', key, key1);
          },
        },
      );
    },
  },
);

let define = undefined;
// @ts-expect-error
let requireModule = undefined;

(function () {
  const registry: Record<string, unknown> = {
    ember: EmberProxy,
  };
  const seen = {};

  define = function (name: string, deps: unknown[], callback: () => void) {
    if (arguments.length < 3) {
      // @ts-expect-error
      callback = deps;
      deps = [];
    }
    registry[name] = { deps, callback };
    // @ts-expect-error
    return window.define;
  };

  requireModule = function (name: string) {
    if (name === '@ember/object/computed') {
      debugger;
      return genericProxy;
    } else if (name === '@ember/runloop') {
      return {
        // @ts-expect-error
        _backburner: new backburner.default(),
      };
    } else if (name === '@ember/-internals/metal') {
      return {
        // @ts-expect-error
        tagForProperty(obj: Record<string, unknown>, key: string) {
          if (obj instanceof Cell || obj instanceof MergedCell) {
            return obj;
          }
          // console.log('tagForProperty', obj, key);
        },
      };
    } else if (name === '@ember/instrumentation') {
      return {
        subscribe(
          // @ts-expect-error
          name: string,
          // @ts-expect-error
          {
            before,
            after,
          }: {
            before: (name: string, timestamp: number, payload: unknown) => void;
            after: (
              name: string,
              timestamp: number,
              payload: unknown,
              beganIndex: number,
            ) => void;
          },
        ) {
          // console.log('instrumentation.subscribe', name, before, after);
        },
      };
    } else if (name === '@ember/-internals/views') {
      return {
        ViewStateSupport: proxyFor('ViewStateSupport'),
        ViewMixin: proxyFor('ViewMixin'),
        ActionSupport: proxyFor('ActionSupport'),
        ClassNamesSupport: proxyFor('ClassNamesSupport'),
        ChildViewsSupport: proxyFor('ChildViewsSupport'),
        CoreView: proxyFor('CoreView'),
      };
    } else if (name === '@glimmer/runtime') {
      // debugger;
      // return genericProxy;
    } else if (name === '@glimmer/reference') {
      debugger;
      return genericProxy;
    } else if (name === '@glimmer/validator') {
      return {
        valueForTag(tag: Record<string, unknown>) {
          if (tag instanceof Cell || tag instanceof MergedCell) {
            return tag.value;
          }
          // if (tag && tag.value) {
          //   return tag.value;
          // }
          // console.log('valueForTag', tag);
          // return undefined;
        },
        validateTag() {
          debugger;
        },
        track(cb: () => void) {
          // executeInAutotrackingTransaction
          // debugger;
          cb();
        },
        tagFor() {
          debugger;
        },
        trackedData() {
          debugger;
        },
      };
    } else if (name === 'ember') {
      return {
        default: EmberProxy,
      };
    }

    // @ts-expect-error
    if (seen[name]) {
      // @ts-expect-error
      return seen[name];
    }

    const mod = registry[name];
    if (!mod) {
      throw new Error(`Module: '${name}' not found.`);
    }

    // @ts-expect-error
    seen[name] = {};

    // @ts-expect-error
    const deps = mod.deps;
    // @ts-expect-error
    const callback = mod.callback;
    const reified = [];
    let exports;

    for (let i = 0, l = deps.length; i < l; i++) {
      if (deps[i] === 'exports') {
        reified.push((exports = {}));
      } else {
        // @ts-expect-error
        reified.push(requireModule(deps[i]));
      }
    }

    // @ts-expect-error
    const value = callback.apply(this, reified);
    // @ts-expect-error
    seen[name] = exports || value;
    // @ts-expect-error
    return seen[name];
  };

  // @ts-expect-error
  requireModule.has = function (name) {
    if (name !== 'ember' && name !== '@glimmer/runtime') {
      console.log('requireModule.has', name);
    }
    return true;
  };

  // @ts-expect-error
  define.registry = registry;
  // @ts-expect-error
  define.seen = seen;
})();

// @ts-expect-error
requireModule.entries = define.registry;

// @ts-expect-error
window.define = define;

// @ts-expect-error
window.requireModule = requireModule;
