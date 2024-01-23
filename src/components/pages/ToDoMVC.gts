import { Component } from '@lifeart/gxt';
import { Layout } from './todomvc/Layout.gts';
import { Attribution } from './todomvc/Attribution.gts';
import Page from './todomvc/page.gts';
import { repo } from './todomvc/repo';
function pageTitle(text: string) {
  document.title = text;
}

export class ToDoMVC extends Component {
  <template>
    <div shadowrootmode='closed'>
      <style>
        @import url('/todomvc.css');
      </style>
      {{pageTitle 'ToDoMVC'}}
      <Layout>
        {{#if @hasChildren}}
          {{yield}}
        {{else}}
          <Page @model={{repo.all}} />
        {{/if}}
      </Layout>
      <Attribution />
    </div>
  </template>
}
