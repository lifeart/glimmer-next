import {
  Component,
  type ComponentReturnType,
  renderElement,
} from './component';
import { context, provideContext, initDOM } from './context';
import {
  $_fin,
  $_if,
  $_c,
  $_GET_SLOTS,
  $_slot,
  $_GET_ARGS,
  $_ucw,
} from './dom';
import { tracked } from './reactive';
import { $template, RENDERED_NODES_PROPERTY } from './shared';
import { isDestroyed } from './glimmer/destroyable';
import type { IfCondition } from './control-flow/if';

// Re-export utilities from suspense-utils for backwards compatibility
export { SUSPENSE_CONTEXT, followPromise, type SuspenseContext } from './suspense-utils';
import { SUSPENSE_CONTEXT, type SuspenseContext } from './suspense-utils';

let i = 0;

export function lazy<T>(factory: () => Promise<{ default: T }>) {
  class LazyComponent extends Component {
    constructor(params: any) {
      super(params);
      this.params = params;
      // @ts-expect-error args types
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
      // @ts-expect-error component type
      this.state = { loading: false, component };
    }
    _template() {
      Promise.resolve().then(() => {
        this.suspense?.start();
      });

      return $_fin(
        [
          $_if(
            () => this.isLoading,
            () => {
              return null;
            },
            (c: IfCondition) => {
              try {
                if (isDestroyed(c)) {
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
          ) as unknown as ComponentReturnType,
        ],
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
    // @ts-expect-error args types
    super(...arguments);
    provideContext(this, SUSPENSE_CONTEXT, this);
    // @ts-expect-error args types
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
    const api = initDOM(this);
    let fragment = api.fragment();

    return $_fin(
      [
        $_if(
          () => this.pendingAmount === 0,
          (c: IfCondition) => {
            if (trueBranch === null) {
              trueBranch = $_ucw((ctx) => {
                if (isDestroyed(ctx)) {
                  debugger;
                }
                return (
                  $_slot('default', () => [], $slots, ctx) as ComponentReturnType
                )[RENDERED_NODES_PROPERTY];
              }, c as unknown as Component<any>);
              renderElement(api, trueBranch, fragment, trueBranch, null);
              return $_c(this.fallback, {}, c as unknown as Component<any>);
            } else {
              return {
                [RENDERED_NODES_PROPERTY]: Array.from(fragment.childNodes),
              };
            }
          },
          (c: IfCondition) => {
            return $_c(this.fallback, {}, c as unknown as Component<any>);
          },
          this,
        ) as unknown as ComponentReturnType,
      ],
      this,
    );
  }
}
