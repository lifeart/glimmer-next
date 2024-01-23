import { Component } from '@lifeart/gxt';
import { router } from '@/services/router';

class Link extends Component<{
  Args: {
    href: string;
  };
}> {
  onClick = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    router.open(this.args.href);
  };
  get isActive() {
    return router.activeRoute?.page.path === this.args.href;
  }
  <template>
    <a
      href={{@href}}
      class={{if this.isActive 'selected'}}
      {{on 'click' this.onClick}}
    >
      {{yield}}
    </a>
  </template>
}

export class Filters extends Component {
  <template>
    <ul class='filters'>
      <li>
        <Link @href='/todomvc'>All</Link>
      </li>
      <li>
        <Link @href='/todomvc/active'>Active</Link>
      </li>
      <li>
        <Link @href='/todomvc/completed'>Completed</Link>
      </li>
    </ul>
  </template>
}
