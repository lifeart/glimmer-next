import { Component } from '@lifeart/gxt';
import { Clock } from './page-two/Clock';

export class PageTwo extends Component {
  get nextLink() {
    if (import.meta.env.SSR) {
      return '/';
    }
    if (window.location.pathname === '/') {
      return '/pageOne';
    } else {
      return '/';
    }
  }
  <template>
    <div class='container mx-auto px-4 bg-black text-white'>
      <div class='shadow-md rounded px-8 pt-6 pb-8 mb-4'>
        <h2 class='text-2xl font-semibold mb-4'>Embracing Modern Compiler
          Technology</h2>
        <p class='text-lg mb-4'>GlimmerNext is the evolution of GlimmerVM,
          designed to integrate seamlessly with the latest compiler technology.
          Our goal is to harness the power of modern compilers to bring
          unprecedented performance improvements and efficient memory usage to
          the Ember community.</p>

        <h2 class='text-2xl font-semibold mb-4'>Backward Compatibility</h2>
        <p class='text-lg mb-4'>A key focus of GlimmerNext is to ensure backward
          compatibility with the entire Ember community's infrastructure and
          tooling. We understand the importance of a smooth transition and aim
          to make the integration process as effortless as possible for
          developers.</p>

        <h2 class='text-2xl font-semibold mb-4'>Key Objectives</h2>
        <ul class='list-disc list-inside mb-4'>
          <li class='text-lg mb-2'>Leveraging cutting-edge compiler technology
            to optimize performance and memory management.</li>
          <li class='text-lg mb-2'>Ensuring that GlimmerNext works harmoniously
            with existing Ember tools and ecosystems.</li>
          <li class='text-lg mb-2'>Providing a robust platform that evolves with
            technological advancements, maintaining the forefront position in
            web development.</li>
        </ul>

        <h2 class='text-2xl font-semibold mb-4'>Community-Driven Development</h2>
        <p class='text-lg mb-4'>We believe in the power of community
          collaboration. GlimmerNext is committed to working closely with the
          Ember community, gathering feedback, and continuously improving to
          meet the evolving needs of developers.</p>
      </div>

      <a href={{this.nextLink}}>Go to root</a>

      <br /><br />
      <Clock />
    </div>
  </template>
}
