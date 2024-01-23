import { Component } from '@lifeart/gxt';
import { Filters } from './Filters.gts';
import { repo } from './repo';

function itemLabel(count: number) {
  if (count === 0 || count > 1) {
    return 'items';
  }

  return 'item';
}

export class Footer extends Component {
  <template>
    <footer class='footer'>
      <span class='todo-count'>
        <strong>{{repo.remaining.length}}</strong>&nbsp;{{itemLabel
          repo.remaining.length
        }}
        left
      </span>

      <Filters />

      {{#if repo.completed.length}}
        <button
          class='clear-completed'
          type='button'
          {{on 'click' repo.clearCompleted}}
        >
          Clear completed
        </button>
      {{/if}}
    </footer>
  </template>
}
