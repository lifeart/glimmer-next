import { tracked, Component, cellFor } from '@lifeart/gxt';
import { repo, type ToDoItem } from './repo';

function isBlank(el: string) {
  return el.trim().length === 0;
}

export class TodoItem extends Component<{
  element: HTMLLIElement;
  Args: {
    todo: ToDoItem;
    onStartEdit: () => void;
    onEndEdit: () => void;
  };
}> {
  <template>
    <li
      class={{if (cellFor @todo 'completed') 'completed'}}
      class={{if this.editing 'editing'}}
      ...attributes
    >
      <div class='view'>
        <input
          class='toggle'
          type='checkbox'
          aria-label='Toggle the completion state of this todo'
          checked={{@todo.completed}}
          {{on 'change' this.toggleCompleted}}
        />
        <label {{on 'dblclick' this.startEditing}}>{{cellFor
            @todo
            'title'
          }}</label>
        <button
          class='destroy'
          {{on 'click' this.removeTodo}}
          type='button'
          aria-label='Delete this todo'
        ></button>
      </div>
      <input
        class='edit'
        value={{@todo.title}}
        {{on 'blur' this.doneEditing}}
        {{on 'keydown' this.handleKeydown}}
        autofocus
      />
    </li>
  </template>

  repo = repo;

  @tracked editing = false;

  removeTodo = () => this.repo.delete(this.args.todo);

  toggleCompleted = (event) => {
    this.args.todo.completed = event.target.checked;
    this.repo.persist();
  };

  handleKeydown = (event) => {
    if (event.keyCode === 13) {
      event.target.blur();
    } else if (event.keyCode === 27) {
      this.editing = false;
    }
  };

  startEditing = (event) => {
    this.args.onStartEdit();
    this.editing = true;

    event.target.closest('li')?.querySelector('input.edit').focus();
  };

  doneEditing = (event) => {
    if (!this.editing) {
      return;
    }

    let todoTitle = event.target.value.trim();

    if (isBlank(todoTitle)) {
      this.removeTodo();
    } else {
      this.args.todo.title = todoTitle;
      this.editing = false;
      this.args.onEndEdit();
    }
  };
}
