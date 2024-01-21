import { data } from './services/data';
export const Header = <template>
  <h1>
    <span class='title'>
      Is Polaris ready yet?
    </span>
    <!-- <span class="answer">Yes!</span> -->
    <span class='answer-no'>Almost!, we're getting there.</span>
    <span class='progress'>
      {{data.percent}}% of the way there.
      {{data.finished}}
      of
      {{data.total}}
      tasks finished.
    </span>
  </h1>
</template>;
