import { Component } from '@lifeart/gxt';
import { TodoList } from './TodoList.gts';

export default class Page extends Component {
  <template><TodoList @todos={{@model}} /></template>
}
