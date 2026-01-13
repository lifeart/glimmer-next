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

type LazyState<T> =
  | { loading: true; component: null }
  | { loading: false; component: T };

export function lazy<T>(factory: () => Promise<{ default: T }>): T {
  class LazyComponent extends Component {
    constructor(params: Record<string, unknown>) {
      super(params);
      this.params = params;
      // @ts-expect-error args types
      this[$template] = this._template;
      this.load();
    }
    params: Record<string, unknown> = {};
    @tracked state: LazyState<T> = { loading: true, component: null };
    get isLoading(): boolean {
      return this.state.loading;
    }
    get contentComponent(): T {
      return this.state.component as T;
    }
    @context(SUSPENSE_CONTEXT) suspense?: SuspenseContext;
    async load(): Promise<void> {
      const { default: component } = await factory();
      if (isDestroyed(this)) {
        return;
      }
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
                  this.contentComponent as unknown as typeof Component,
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
  return LazyComponent as unknown as T;
}

/**
 * Props for the Suspense component
 */
export type SuspenseArgs = {
  Args: {
    /** Component to render while async content is loading */
    fallback: ComponentReturnType;
  };
  Blocks: {
    /** Default block containing async content */
    default: [];
  };
};

/**
 * Suspense boundary component that shows a fallback while async children are loading.
 * Implements SuspenseContext to track pending async operations.
 */
export class Suspense extends Component<SuspenseArgs> implements SuspenseContext {
  constructor() {
    // @ts-expect-error args types
    super(...arguments);
    provideContext(this, SUSPENSE_CONTEXT, this);
    // @ts-expect-error args types
    this[$template] = this._template;
  }
  @tracked pendingAmount = 0;
  isReleased = false;

  start(): void {
    if (isDestroyed(this)) {
      return;
    }
    if (this.isReleased) {
      console.error('Suspense is already released');
      return;
    }
    this.pendingAmount++;
  }

  end(): void {
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
