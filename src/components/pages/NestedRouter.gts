import { Component } from '@lifeart/gxt';

interface DefaultRouteArgs {
  hasChildren?: boolean;
}

class DefaultRoute extends Component<{ Args: DefaultRouteArgs; Blocks: { default: [] } }> {
  <template>
    {{#if @hasChildren}}
      {{yield}}
    {{/if}}
  </template>
}

type RouterArgs = {
  stack: { name: string; data: null | unknown }[];
  params?: Record<string, unknown>;
  components?: Record<string, any>;
};
export class NestedRouter extends Component<{ Args: RouterArgs }> {
  get tail() {
    return this.parts.tail;
  }
  get parts() {
    const [head, ...tail] = this.args.stack;
    return {
      head,
      tail,
    };
  }
  get components() {
    return this.args.components ?? {};
  }
  get Component(): typeof Component<any> {
    return this.model?.component || this.components[this.route] || DefaultRoute;
  }
  get route() {
    return this.parts.head.name;
  }
  get model() {
    return (this.parts.head.data || {}) as Record<string, unknown>;
  }
  <template>
    {{#if @stack.length}}
      <this.Component
        @route={{this.route}}
        @hasChildren={{this.tail.length}}
        @model={{this.model}}
        @params={{@params}}
      >
        <NestedRouter
          @components={{this.components}}
          @stack={{this.tail}}
          @params={{@params}}
        />
      </this.Component>
    {{/if}}
  </template>
}
