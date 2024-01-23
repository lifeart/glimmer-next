import { tracked } from '@lifeart/gxt';

function uniqueId() {
  return Math.random().toString(36).slice(2);
}

export type ToDoItem = {
  id: string;
  title: string;
  completed: boolean;
};

function load() {
  // localStorage has to be an array (required by the todomvc repo),
  // so let's convert to an object on id.
  const list = JSON.parse(window.localStorage.getItem('todos') || '[]');
  const result = list.reduce(
    (indexed: Record<string, ToDoItem>, todo: ToDoItem) => {
      indexed[todo.id] = todo;
      return indexed;
    },
    {} as Record<string, ToDoItem>,
  );
  return result;
}

function save(indexedData: Record<string, ToDoItem>) {
  let data = Object.values(indexedData);

  window.localStorage.setItem('todos', JSON.stringify(data));
}

class Repo {
  @tracked
  data: Record<string, ToDoItem> = load();

  load = () => {
    this.data = load();
  };

  get all() {
    return Object.values(this.data);
  }

  get completed() {
    return this.all.filter((todo) => todo.completed);
  }

  get active() {
    return this.all.filter((todo) => !todo.completed);
  }

  get remaining() {
    // This is an alias
    return this.active;
  }

  clearCompleted = () => {
    this.completed.forEach(this.delete);
  };

  add = (attrs: Omit<ToDoItem, 'id'>) => {
    let newId = uniqueId();

    this.data = {
      ...this.data,
      [newId]: { ...attrs, id: newId },
    };
    this.persist();
  };

  delete = (todo: ToDoItem) => {
    const newData = this.data;
    delete newData[todo.id];
    this.data = { ...newData };
    this.persist();
  };

  persist = () => {
    save(this.data);
  };
}

export const repo = new Repo();
