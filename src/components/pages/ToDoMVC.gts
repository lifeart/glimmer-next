import { Component, Root } from '@lifeart/gxt';
import { Layout } from './todomvc/Layout.gts';
import { Attribution } from './todomvc/Attribution.gts';
import Page from './todomvc/page.gts';
import { repo } from './todomvc/repo';
import { getDocument } from '@/utils/context';

function pageTitle(ctx: Component<any>, text: string) {
  const document = getDocument(ctx);
  // TODO: solve SSR
  document.title = text;
}

export class ToDoMVC extends Component {
  <template>
    <div shadowrootmode='closed'>
      <style>
        @import url('/todomvc.css');
      </style>
      {{pageTitle this 'ToDoMVC'}}
      <Layout>
        {{#if @hasChildren}}
          {{yield}}
        {{else}}
          <Page @model={{hash model=repo.all}} />
        {{/if}}
      </Layout>
      <Attribution />
    </div>
  </template>
}
