import { Component, tracked } from '@lifeart/gxt';
import { TodoItem as Item } from './TodoItem.gts';
import { type ToDoItem as IToDoItem, repo } from './repo';

export class TodoList extends Component<{
  Args: {
    todos: IToDoItem[];
  };
}> {
  get stack() {
    return new Error('todo-list').stack;
  }
  <template>
    <section class='main'>
      {{log 'rendering todo-list' this.stack globalThis.activeTag}}
      {{#if @todos.length}}
        {{#if this.canToggle}}
          <input
            id='toggle-all'
            class='toggle-all'
            type='checkbox'
            checked={{this.areViewableCompleted}}
            {{on 'change' this.toggleAll}}
          />
          <label for='toggle-all'>Mark all as complete</label>
        {{/if}}
        <ul class='todo-list'>
          {{#each @todos as |todo|}}
            <Item
              @todo={{todo}}
              @onStartEdit={{this.disableToggle}}
              @onEndEdit={{this.enableToggle}}
            />
          {{/each}}
        </ul>
      {{/if}}
    </section>
  </template>

  repo = repo;

  @tracked canToggle = true;

  get areViewableCompleted() {
    return (
      this.args.todos.filter((todo) => todo.completed).length ===
      this.args.todos.length
    );
  }

  toggleAll = () => {
    let allCompleted = this.areViewableCompleted;

    this.args.todos.forEach((todo) => (todo.completed = !allCompleted));
    this.repo.persist();
  };

  enableToggle = () => (this.canToggle = true);
  disableToggle = () => (this.canToggle = false);
}
