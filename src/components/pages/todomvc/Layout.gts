import { Component } from '@lifeart/gxt';
import { Create } from './Create.gts';
import { Footer } from './Footer.gts';
import { repo, type ToDoItem } from './repo';

function hasTodos(todos: ToDoItem[]) {
  return todos.length > 0;
}

export class Layout extends Component {
  <template>
    <section class='todoapp'>
      <header class='header'>
        <h1>todos</h1>

        <Create />
      </header>

      {{yield}}

      {{#if (hasTodos repo.all)}}
        <Footer />
      {{/if}}
    </section>
  </template>
}
