import {
  Component,
  type ComponentReturnType,
  renderComponent,
} from './component';
import { context, getAnyContext, provideContext } from './context';
import {
  $_fin,
  $_if,
  $_c,
  $_GET_SLOTS,
  $_slot,
  $_GET_ARGS,
  $_ucw,
  getRoot,
} from './dom';
import { tracked } from './reactive';
import { $nodes, $template } from './shared';
import { isDestroyed } from './glimmer/destroyable';
import { api } from './dom-api';
import type { IfCondition } from './control-flow/if';

export const SUSPENSE_CONTEXT = Symbol('suspense');

let i = 0;

type SuspenseContext = {
  start: () => void;
  end: () => void;
};

export function followPromise<T extends Promise<any>>(ctx: Component<any>, promise: T): T {
  getAnyContext<SuspenseContext>(ctx, SUSPENSE_CONTEXT)?.start();
  promise.finally(() => {
    Promise.resolve().then(() => {
      getAnyContext<SuspenseContext>(ctx, SUSPENSE_CONTEXT)?.end();
    });
  });
  return promise;
}

export function lazy<T>(factory: () => Promise<{ default: T }>) {
  class LazyComponent extends Component {
    constructor(params: any) {
      super(params);
      this.params = params;
      // @ts-ignore args types
      this[$template] = this._template;
      i++;
      // this.load();
      setTimeout(() => this.load(), 1000 * i + 500);
      if (i === 3) {
        i = 0;
      }
    }
    params = {};
    @tracked state = { loading: true, component: null };
    get isLoading() {
      return this.state.loading;
    }
    get contentComponent() {
      return this.state.component as unknown as Component<any>;
    }
    @context(SUSPENSE_CONTEXT) suspense?: SuspenseContext;
    async load() {
      const { default: component } = await factory();
      if (isDestroyed(this)) {
        return;
      }
      // @ts-ignore component type
      this.state = { loading: false, component };
    }
    _template() {
      Promise.resolve().then(() => {
        this.suspense?.start();
      });
      const root = getRoot()!;
      // @ts-expect-error
      console.log(`lazy: ${root.version}`);

      // @ts-ignore
      return $_fin(
        [
          $_if(
            // @ts-ignore this type
            () => this.isLoading,
            () => {
              return null;
            },
            // @ts-ignore this type
            (c) => {
              try {
                if (isDestroyed(c)) {
                  debugger;
                }
                if (isDestroyed(root)) {
                  debugger;
                }
                return $_c(
                  this.contentComponent,
                  this.params,
                  c as unknown as Component<any>,
                );
              } finally {
                this.suspense?.end();
              }
            },
            this,
          ),
        ],
        // @ts-ignore
        this,
      );
    }
  }
  return LazyComponent as unknown as Awaited<
    ReturnType<typeof factory>
  >['default'];
}

export class Suspense extends Component {
  constructor() {
    // @ts-ignore args types
    super(...arguments);
    // @ts-ignore this type
    provideContext(this, SUSPENSE_CONTEXT, this);
    // @ts-ignore args types
    this[$template] = this._template;
  }
  @tracked pendingAmount = 0;
  isReleased = false;
  start() {
    if (isDestroyed(this)) {
      return;
    }
    if (this.isReleased) {
      console.error('Suspense is already released');
      return;
    }
    this.pendingAmount++;
  }
  end() {
    if (isDestroyed(this)) {
      return;
    }
    if (this.isReleased) {
      console.error('Suspense is already released');
      return;
    }
    this.pendingAmount--;
    this.isReleased = this.pendingAmount === 0;
  }
  get fallback(): ComponentReturnType {
    return this.args.fallback;
  }
  _template() {
    $_GET_ARGS(this, arguments);
    const $slots = $_GET_SLOTS(this, arguments);
    let trueBranch: null | ComponentReturnType = null;
    let fragment = api.fragment();
    const root = getRoot()!;
    // @ts-expect-error
    console.log(`Suspense: ${root.version}`);

    return $_fin(
      [
        $_if(
          () => this.pendingAmount === 0,
          (c: IfCondition) => {
            if (trueBranch === null) {
              trueBranch = $_ucw((c) => {
                if (isDestroyed(c)) {
                  debugger;
                }
                if (isDestroyed(root)) {
                  debugger;
                }
                return (
                  $_slot('default', () => [], $slots, c) as ComponentReturnType
                )[$nodes];
              }, c);
              renderComponent(trueBranch, fragment, c, true);
              return $_c(this.fallback, {}, c as unknown as Component<any>);
            } else {
              return {
                ctx: trueBranch.ctx,
                nodes: Array.from(fragment.childNodes),
              };
            }
          },
          (c: IfCondition) => {
            return $_c(this.fallback, {}, c as unknown as Component<any>);
          },
          this,
        ),
      ],
      this,
    );
  }
}
