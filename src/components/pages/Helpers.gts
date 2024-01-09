export const Helpers = <template>
  {{log (hash foo=1 bar='2' baz=null book=undefined) (array 1 2 3 4 5)}}
</template>;
