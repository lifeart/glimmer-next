import {
  Component,
  type ComponentReturnType,
  renderElement,
} from './component';
import { provideContext, getContext, initDOM } from './context';
import {
  $_fin,
  $_if,
  $_c,
  $_GET_SLOTS,
  $_slot,
  $_GET_ARGS,
  $_ucw,
} from './dom';
import { cell, type Cell } from './reactive';
import { $template, RENDERED_NODES_PROPERTY } from './shared';
import { isDestroyed } from './glimmer/destroyable';
import type { IfCondition } from './control-flow/if';

// Re-export utilities from suspense-utils for backwards compatibility
export {
  SUSPENSE_CONTEXT,
  followPromise,
  type SuspenseContext,
} from './suspense-utils';
import { SUSPENSE_CONTEXT, type SuspenseContext } from './suspense-utils';

type LazyState<T> =
  | { loading: true; error: null; component: null }
  | { loading: false; error: null; component: T }
  | { loading: false; error: Error; component: null };

export function lazy<T>(factory: () => Promise<{ default: T }>): T {
  class LazyComponent extends Component {
    suspenseContext: SuspenseContext | null = null;
    suspenseStarted = false;

    constructor(params: Record<string, unknown>) {
      super(params);
      this.params = params;
      // @ts-expect-error args types
      this[$template] = this._template;
      this.load();
    }
    params: Record<string, unknown> = {};
    stateCell: Cell<LazyState<T>> = cell({ loading: true, error: null, component: null });
    get isLoading(): boolean {
      return this.stateCell.value.loading;
    }
    get error(): Error | null {
      return this.stateCell.value.error;
    }
    get contentComponent(): T {
      return this.stateCell.value.component as T;
    }
    async load(): Promise<void> {
      try {
        const { default: component } = await factory();
        if (isDestroyed(this)) {
          return;
        }
        this.stateCell.update({ loading: false, error: null, component });
        this.suspenseContext?.end();
      } catch (err) {
        if (isDestroyed(this)) {
          return;
        }
        this.stateCell.update({ loading: false, error: err as Error, component: null });
        this.suspenseContext?.end();
      }
    }
    _template() {
      // Get context here when component is in tree, defer start() to avoid rehydration issues
      if (!this.suspenseStarted) {
        this.suspenseStarted = true;
        this.suspenseContext = getContext<SuspenseContext>(this, SUSPENSE_CONTEXT);
        queueMicrotask(() => {
          if (!isDestroyed(this) && this.isLoading) {
            this.suspenseContext?.start();
          }
        });
      }

      return $_fin(
        [
          $_if(
            () => this.isLoading,
            () => {
              return null;
            },
            (c: IfCondition) => {
              if (this.error) {
                throw this.error;
              }
              return $_c(
                this.contentComponent as unknown as typeof Component,
                this.params,
                c as unknown as Component<any>,
              );
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
export class Suspense
  extends Component<SuspenseArgs>
  implements SuspenseContext
{
  constructor() {
    // @ts-expect-error args types
    super(...arguments);
    provideContext(this, SUSPENSE_CONTEXT, this);
    // @ts-expect-error args types
    this[$template] = this._template;
  }
  pendingAmountCell: Cell<number> = cell(0);
  isReleased = false;

  get pendingAmount(): number {
    return this.pendingAmountCell.value;
  }

  start(): void {
    if (isDestroyed(this) || this.isReleased) {
      IS_DEV_MODE && this.isReleased && console.warn('Suspense is already released');
      return;
    }
    this.pendingAmountCell.update(this.pendingAmountCell.value + 1);
  }

  end(): void {
    if (isDestroyed(this) || this.isReleased) {
      IS_DEV_MODE && this.isReleased && console.warn('Suspense is already released');
      return;
    }
    const currentValue = this.pendingAmountCell.value;
    if (currentValue <= 0) {
      IS_DEV_MODE && console.warn('Suspense.end() called more times than start()');
      return;
    }
    const newValue = currentValue - 1;
    this.pendingAmountCell.update(newValue);
    this.isReleased = newValue === 0;
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
              trueBranch = $_ucw(
                (ctx) => {
                  return (
                    $_slot(
                      'default',
                      () => [],
                      $slots,
                      ctx,
                    ) as ComponentReturnType
                  )[RENDERED_NODES_PROPERTY];
                },
                c as unknown as Component<any>,
              );
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
