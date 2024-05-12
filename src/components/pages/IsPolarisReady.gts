// SOURCE: https://github.com/NullVoxPopuli/is-polaris-ready-yet/
import data from './is-polaris-ready/services/issue-data.json';
import { Component } from '@lifeart/gxt';

// import { Filters } from './is-polaris-ready/filters';
import { Header } from './is-polaris-ready/Header.gts';
import { Section } from './is-polaris-ready/Section.gts';
import { getDocument } from '@/utils/dom-api';

const GetStarted = <template>
  To get started with a Polaris App:
  <br />Clone this
  <a href='https://github.com/NullVoxPopuli/polaris-starter'>starter template</a>.

  <br /><br />

  To get started with a Polaris Library:
  <br />use the
  <a href='https://github.com/embroider-build/addon-blueprint'>
    @embroider/addon-blueprint</a>.
</template>;

function pageTitle(text: string) {
  getDocument().title = text;
}

export class IsPolarisReady extends Component {
  <template>
    <div shadowrootmode='closed'>
      <style>
        @import url('./is-polaris-ready.css');
      </style>
      {{pageTitle 'is Polaris ready yet?'}}

      <div class='inner'>
        <Header />

        <p class='get-started'>
          <GetStarted />
        </p>

        <div class='filters'>
          {{! <Filters /> }}
        </div>

        <main>
          <h2>Authoring Experience</h2>
          <Section @title='<template>' @data={{data.templateTag}} />
          <Section @title='Vite' @data={{data.vite}} />
          <Section @title='CSS' @data={{data.css}} />
          <Section @title='Routing' @data={{data.routing}} />
          <Section @title='Reactivity' @data={{data.reactivity}} />
          <Section @title='Intellisense' @data={{data.intellisense}} />
          <Section
            @title='Removing Old Patterns'
            @data={{data.removingOldPatterns}}
          />

          <h2>Tooling</h2>
          <Section
            @title='Shrinking the Build'
            @data={{data.shrinkingTheBuild}}
          />
          <Section @title='Compatibility' @data={{data.compatibility}} />
          <Section @title='Glint' @data={{data.glint}} />
          <Section @title='Linting' @data={{data.linting}} />
          <br /><br />
          <Section @title='Other' @data={{data.other}} />
        </main>
      </div>

    </div>
  </template>
}
