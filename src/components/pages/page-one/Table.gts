const originalValue = (value: string) => {
  return value.split(' ')[0];
};

const colorForDiff = (diff: string) => {
  if (diff.includes('+')) {
    return 'text-red-400';
  } else if (diff.includes('-')) {
    return 'text-emerald-400';
  } else {
    return 'text-slate-500';
  }
};

const withDiff = (gxtValue: string, glimmerValue: string) => {
  const gxt = parseFloat(gxtValue.split(' ')[0]);
  const glimmer = parseFloat(glimmerValue.split(' ')[0]);
  const diff = gxt - glimmer;
  const diffPercent = -1 * (diff / glimmer) * 100;
  const diffPercentString = diffPercent.toFixed(0);
  let diffString = diffPercentString + '%';
  if (!diffString.startsWith('-')) {
    diffString = '+' + diffString;
  }
  if (diffString === '+0%' || diffString === '-0%') {
    return '';
  }
  return diffString;
};

const Row = <template>
  <tr class='border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors'>
    <td class='py-2.5 px-3 font-medium text-slate-200 text-xs'>{{@label}}</td>
    <td class='py-2.5 px-2 text-center'>
      <span class='text-slate-300 text-xs'>{{originalValue @vanila}}</span>
      <span class='text-xs ml-1 {{colorForDiff (withDiff @gxt @vanila)}}'>{{withDiff @gxt @vanila}}</span>
    </td>
    <td class='py-2.5 px-2 text-center'>
      <span class='text-slate-300 text-xs'>{{originalValue @svelte}}</span>
      <span class='text-xs ml-1 {{colorForDiff (withDiff @gxt @svelte)}}'>{{withDiff @gxt @svelte}}</span>
    </td>
    <td class='py-2.5 px-2 text-center'>
      <span class='text-slate-300 text-xs'>{{originalValue @react}}</span>
      <span class='text-xs ml-1 {{colorForDiff (withDiff @gxt @react)}}'>{{withDiff @gxt @react}}</span>
    </td>
    <td class='py-2.5 px-2 text-center'>
      <span class='text-slate-300 text-xs'>{{originalValue @vue}}</span>
      <span class='text-xs ml-1 {{colorForDiff (withDiff @gxt @vue)}}'>{{withDiff @gxt @vue}}</span>
    </td>
    <td class='py-2.5 px-2 text-center bg-blue-500/10'>
      <span class='text-blue-400 font-semibold text-xs'>{{originalValue @gxt}}</span>
    </td>
    <td class='py-2.5 px-2 text-center'>
      <span class='text-slate-300 text-xs'>{{originalValue @glimmer}}</span>
      <span class='text-xs ml-1 {{colorForDiff (withDiff @gxt @glimmer)}}'>{{withDiff @gxt @glimmer}}</span>
    </td>
  </tr>
</template>;

export const Table = <template>
  <table class='w-full text-sm'>
    <thead>
      <tr class='border-b border-slate-600'>
        <th class='py-2.5 px-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider'>Benchmark</th>
        <th class='py-2.5 px-2 text-center text-xs font-semibold text-slate-400'>Vanilla</th>
        <th class='py-2.5 px-2 text-center text-xs font-semibold text-slate-400'>Svelte</th>
        <th class='py-2.5 px-2 text-center text-xs font-semibold text-slate-400'>React</th>
        <th class='py-2.5 px-2 text-center text-xs font-semibold text-slate-400'>Vue</th>
        <th class='py-2.5 px-2 text-center text-xs font-semibold text-blue-400 bg-blue-500/10'>GXT</th>
        <th class='py-2.5 px-2 text-center text-xs font-semibold text-slate-400'>Glimmer</th>
      </tr>
    </thead>
    <tbody>
      <Row
        @label='Create rows'
        @vanila='39.0 ± 0.3'
        @svelte='39.4 ± 0.4'
        @react='45.6 ± 0.3'
        @vue='44.4 ± 0.5'
        @gxt='48.3 ± 0.6'
        @glimmer='69.1 ± 1.4'
      />
      <Row
        @label='Replace all rows'
        @vanila='42.5 ± 0.4'
        @svelte='45.3 ± 0.4'
        @react='59.2 ± 0.3'
        @vue='52.6 ± 0.3'
        @gxt='59.2 ± 0.4'
        @glimmer='86.4 ± 0.4'
      />

      <Row
        @label='Partial update'
        @vanila='18.3 ± 0.2'
        @svelte='18.4 ± 0.3'
        @react='23.3 ± 0.3'
        @vue='21.7 ± 0.3'
        @gxt='18.5 ± 0.3'
        @glimmer='26.0 ± 4.1'
      />
      <Row
        @label='Select row'
        @vanila='3.2 ± 0.2'
        @svelte='4.0 ± 0.3'
        @react='6.1 ± 0.2'
        @vue='4.9 ± 0.2'
        @gxt='5.7 ± 0.2'
        @glimmer='22.5 ± 0.2'
      />

      <Row
        @label='Swap rows'
        @vanila='21.6 ± 0.2'
        @svelte='22.7 ± 0.6'
        @react='181.3 ± 1.5'
        @vue='23.2 ± 0.6'
        @gxt='21.8 ± 0.4'
        @glimmer='30.7 ± 5.1'
      />

      <Row
        @label='Remove row'
        @vanila='17.4 ± 0.3'
        @svelte='17.8 ± 0.3'
        @react='19.3 ± 0.4'
        @vue='20.8 ± 0.3'
        @gxt='17.8 ± 0.3'
        @glimmer='28.4 ± 0.8'
      />

      <Row
        @label='Create many rows'
        @vanila='397.0 ± 1.6'
        @svelte='396.2 ± 1.8'
        @react='631.7 ± 2.9'
        @vue='464.7 ± 2.5'
        @gxt='514.9 ± 3.1'
        @glimmer='636.9 ± 4.2'
      />

      <Row
        @label='Append rows to large table'
        @vanila='44.3 ± 0.4'
        @svelte='46.6 ± 0.3'
        @react='55.4 ± 0.6'
        @vue='53.0 ± 0.3'
        @gxt='57.3 ± 0.4'
        @glimmer='84.8 ± 0.4'
      />

      <Row
        @label='Clear rows'
        @vanila='13.2 ± 0.2'
        @svelte='14.3 ± 0.3'
        @react='29.5 ± 0.4'
        @vue='16.0 ± 0.3'
        @gxt='23.3 ± 0.3'
        @glimmer='30.7 ± 0.8'
      />

      <Row
        @label='Ready memory'
        @vanila='0.5'
        @svelte='0.5'
        @react='1.0'
        @vue='0.7'
        @gxt='0.5'
        @glimmer='5.2'
      />

      <Row
        @label='Run memory'
        @vanila='1.8'
        @svelte='2.7'
        @react='4.4'
        @vue='3.7'
        @gxt='4.2'
        @glimmer='11.5'
      />

      <Row
        @label='Update row memory'
        @vanila='1.7'
        @svelte='2.6'
        @react='4.9'
        @vue='3.7'
        @gxt='4.2'
        @glimmer='11.6'
      />

      <Row
        @label='Create/Clear 1k rows memory'
        @vanila='0.6'
        @svelte='0.9'
        @react='1.8'
        @vue='1.1'
        @gxt='1.2'
        @glimmer='6.6'
      />

      <Row
        @label='Run memory 10k'
        @vanila='12.2'
        @svelte='19.3'
        @react='32.2'
        @vue='28.2'
        @gxt='34.1'
        @glimmer='61.2'
      />

      <Row
        @label='Compressed size'
        @vanila='2kb'
        @svelte='6.4kb'
        @react='40.1kb'
        @vue='21.1kb'
        @gxt='4.6kb'
        @glimmer='27.9kb'
      />

      {{! <Row
        @label='Weighted geometric mean'
        @vanila='1.04'
        @svelte='1.08'
        @gxt='1.46'
        @glimmer='1.95'
      /> }}

      <!-- More rows should be added here -->
    </tbody>
  </table>
</template>;
