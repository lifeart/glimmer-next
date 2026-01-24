import { Component } from '@lifeart/gxt';

interface Issue {
  isPending: boolean;
  text: string;
  href: string;
}

interface QueryParams {
  hideDone?: boolean;
  without?: string;
  with?: string;
  displayAsList?: boolean;
}

function filtered(issues: Issue[], qps: QueryParams): Issue[] {
  let result = issues;

  if (qps.hideDone) {
    result = result.filter((issue: Issue) => issue.isPending);
  }

  if (qps.without) {
    let lower = qps.without
      .toLowerCase()
      .split(',')
      .map((term) => term.trim())
      .filter(Boolean);

    result = result.filter(
      (issue) => !lower.some((l) => issue.text.toLowerCase().includes(l)),
    );
  }

  if (qps.with) {
    let lower = qps.with.toLowerCase();

    result = result.filter((issue) => issue.text.toLowerCase().includes(lower));
  }

  return result;
}

export class Section extends Component {
  <template>
    <section>
      <header>
        <h3>{{@title}}</h3>
      </header>

      <ul
        class={{if this.qps.displayAsList 'display-as-list' 'display-as-boxes'}}
      >
        {{#each this.filtered sync=true as |issue|}}
          <li>
            <a
              href={{issue.href}}
              class={{if issue.isPending 'not-done' 'done'}}
              title={{issue.text}}
            >
              {{issue.text}}
            </a>
          </li>
        {{/each}}
      </ul>

    </section>
  </template>

  qps = {
    displayAsList: false,
  };

  get filtered() {
    return filtered(this.args.data.issues, this.qps);
  }
}
