import { runDestructors, Component, tracked } from '@lifeart/gxt';
import { PageOne } from './pages/PageOne.gts';
import { PageTwo } from './pages/PageTwo.gts';
import { PageThree } from './pages/PageThree.gts';
import { Benchmark } from './pages/Benchmark.gts';
import { NestedRouter } from './pages/NestedRouter.gts';
import { router } from './../services/router';

export class Application extends Component {
  declare router: typeof router;
  constructor(args: { router?: typeof router }) {
    super(args);
    this.router = args.router || router;
  }
  @tracked
  now = Date.now();
  components = {
    pageOne: PageOne,
    pageTwo: PageTwo,
    main: PageThree,
    benchmark: Benchmark,
  };
  async destroy() {
    await Promise.all(runDestructors(this));
  }
  <template>
    {{#if IS_GLIMMER_COMPAT_MODE}}
      <NestedRouter
        @components={{this.components}}
        @stack={{this.router.stack}}
      />
    {{else}}
      <Benchmark />
    {{/if}}
  </template>
}
