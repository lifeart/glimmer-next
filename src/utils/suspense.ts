import { Component, renderComponent } from './component';
import { context, provideContext } from './context';
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
import { $template } from './shared';
import { isDestroyed } from './glimmer/destroyable';

const SUSPENSE_CONTEXT = Symbol('suspense');

let i = 0;
export function lazy(factory: () => Promise<{ default: Component<any> }>) {
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
    @context(SUSPENSE_CONTEXT) suspense!: {
      fallback: Component<any>;
      pendingAmount: number;
    };
    async load() {
      const { default: component } = await factory();
      if (isDestroyed(this)) {
        return;
      }
      // @ts-ignore component type
      this.state = { loading: false, component };
      this.suspense.pendingAmount--;
    }
    _template() {
      Promise.resolve().then(() => {
        this.suspense.pendingAmount++;
      });
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
            () => {
              return $_c(this.contentComponent, this.params, this);
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
  get fallback() {
    return this.args.fallback;
  }
  _template() {
    $_GET_ARGS(this, arguments);
    const $slots = $_GET_SLOTS(this, arguments);
    let trueBranch: any = null;
    let fragment = document.createDocumentFragment();
    return $_fin(
      [
        $_if(
          // @ts-ignore this type
          () => this.pendingAmount === 0,
          (c: any) => {
            if (trueBranch === null) {
              trueBranch = $_ucw((c) => {
                return $_slot('default', () => [], $slots, c).nodes;
              }, c);
              renderComponent(trueBranch, fragment, c, true);
              return $_c(this.fallback, {}, c);
            } else {
              return {
                ctx: trueBranch.ctx,
                nodes: Array.from(fragment.childNodes),
              };
            }
          },
          // @ts-ignore this type
          (c) => {
            return $_c(this.fallback, {}, c);
          },
          this,
        ),
      ],
      // @ts-ignore
      this,
    );
  }
}
