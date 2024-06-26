import { Component } from './component';
import { context, provideContext } from './context';
import { $_fin, $_if, $_c, $_GET_SLOTS, $_slot, $_GET_ARGS } from './dom';
import { tracked } from './reactive';
import { $template } from './shared';

const SUSPENSE_CONTEXT = Symbol('suspense');

export function lazy(factory: () => Promise<{ default: Component<any> }>) {
  class LazyComponent extends Component {
    constructor(params: any) {
      super(params);
      this.params = params;
        // @ts-ignore args types
      this[$template] = this._template;
      setTimeout(() => this.load(), 100);
    }
    params = {};
    @tracked state = { loading: true, component: null };
    get isLoading() {
      return this.state.loading;
    }
    get contentComponent() {
      return this.state.component as unknown as Component<any>;
    }
    @context(SUSPENSE_CONTEXT) fallback!: Component<any>;
    async load() {
      const { default: component } = await factory();
      // @ts-ignore component type
      this.state = { loading: false, component };
    }
    _template() {
      // @ts-ignore
      return $_fin(
        [
          $_if(
            // @ts-ignore this type
            () => this.isLoading,
            () => this.fallback ? $_c(this.fallback, this.params, this) : null,
            // @ts-ignore this type
            () => $_c(this.contentComponent, this.params, this),
            this,
          ),
        ],
        // @ts-ignore
        this,
      );
    }
  }
  return LazyComponent as unknown as Awaited<ReturnType<typeof factory>>['default'];
}

export class Suspense extends Component {
  constructor() {
    // @ts-ignore args types
    super(...arguments);
    // @ts-ignore this type
    provideContext(this, SUSPENSE_CONTEXT, () => this.args.fallback);
    // @ts-ignore args types
    this[$template] = this._template;
  }
  _template() {
    $_GET_ARGS(this, arguments);
    const $slots = $_GET_SLOTS(this, arguments);
    const roots = [$_slot('default', () => [], $slots, this)];
    // @ts-ignore this type
    return $_fin(roots, this);
  }
}
