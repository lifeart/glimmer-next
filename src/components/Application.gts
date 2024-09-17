import {
  renderComponent,
  runDestructors,
  Component,
  tracked,
  getRoot,
} from '@lifeart/gxt';
import { PageOne } from './pages/PageOne.gts';
import { PageTwo } from './pages/PageTwo.gts';
import { PageThree } from './pages/PageThree.gts';
import { Benchmark } from './pages/Benchmark.gts';
import { NestedRouter } from './pages/NestedRouter.gts';
import { router } from './../services/router';

let version = 0;
export class Application extends Component {
  router = router;
  version = version++;
  @tracked
  now = Date.now();
  rootNode!: HTMLElement;
  components = {
    pageOne: PageOne,
    pageTwo: PageTwo,
    main: PageThree,
    benchmark: Benchmark,
  };
  async destroy() {
    await Promise.all(runDestructors(getRoot()!));
    this.rootNode.innerHTML = '';
    this.rootNode = null!;
  }
  constructor(rootNode: HTMLElement) {
    super({});
    this.rootNode = rootNode;
    // @ts-ignore
    renderComponent(this, this.rootNode);
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
