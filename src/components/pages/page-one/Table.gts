const withDiff = (gxtValue: string, glimmerValue: string) => {
  const gxt = parseFloat(gxtValue.split(' ')[0]);
  const glimmer = parseFloat(glimmerValue.split(' ')[0]);
  const diff = gxt - glimmer;
  const diffPercent = -1 * (diff / glimmer) * 100;
  const diffPercentString = diffPercent.toFixed(1);
  let diffString = diffPercentString + '%';
  if (!diffString.startsWith('-')) {
    diffString = '+' + diffString;
  }
  let tail = `(${diffString})`;
  if (tail === '(+0.0%)') {
    tail = '';
  }

  const renderValue = glimmerValue.split(' ')[0];
  return `${renderValue} ${tail}`;
};

const Row = <template>
  <tr class='bg-white border-b dark:bg-gray-800 dark:border-gray-700'>
    <th
      scope='row'
      class='py-4 px-6 font-medium text-gray-900 whitespace-nowrap dark:text-white'
    >{{@label}}</th>
    <td class='bg-red-100 py-4 px-6'>
      {{withDiff @gxt @vanila}}
    </td>
    <td class='bg-red-100 py-4 px-6'>
      {{withDiff @gxt @svelte}}
    </td>
    <td class='bg-red-100 py-4 px-6 text-green-500'>{{withDiff @gxt @gxt}}</td>
    <td class='bg-red-100 py-4 px-6 text-red-500'>{{withDiff
        @gxt
        @glimmer
      }}</td>
  </tr>
</template>;
export const Table = <template>
  <table class='w-full text-sm text-left text-gray-500 dark:text-gray-400'>
    <thead
      class='text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400'
    >
      <tr>
        <th scope='col' class='py-3 px-6'>Name</th>
        <th scope='col' class='py-3 px-6'>vanillajs</th>
        <th scope='col' class='py-3 px-6'>svelte-v5</th>
        <th scope='col' class='py-3 px-6 text-yellow-500'><b
          >glimmer-next</b></th>
        <th scope='col' class='py-3 px-6'>glimmer-2</th>
      </tr>
    </thead>
    <tbody>
      <Row
        @label='Create rows'
        @vanila='39.0 ± 0.3'
        @svelte='39.4 ± 0.4'
        @gxt='48.3 ± 0.6'
        @glimmer='69.1 ± 1.4'
      />
      <Row
        @label='Replace all rows'
        @vanila='42.5 ± 0.4'
        @svelte='45.3 ± 0.4'
        @gxt='59.2 ± 0.4'
        @glimmer='86.4 ± 0.4'
      />

      <Row
        @label='Partial update'
        @vanila='18.3 ± 0.2'
        @svelte='18.4 ± 0.3'
        @gxt='19.5 ± 0.6'
        @glimmer='26.0 ± 4.1'
      />
      <Row
        @label='Select row'
        @vanila='3.2 ± 0.2'
        @svelte='4.0 ± 0.3'
        @gxt='6.4 ± 0.2'
        @glimmer='22.5 ± 0.2'
      />

      <Row
        @label='Swap rows'
        @vanila='21.6 ± 0.2'
        @svelte='22.7 ± 0.6'
        @gxt='22.5 ± 0.5'
        @glimmer='30.7 ± 5.1'
      />

      <Row
        @label='Remove row'
        @vanila='17.4 ± 0.3'
        @svelte='17.8 ± 0.3'
        @gxt='18.2 ± 0.3'
        @glimmer='28.4 ± 0.8'
      />

      <Row
        @label='Create many rows'
        @vanila='397.0 ± 1.6'
        @svelte='396.2 ± 1.8'
        @gxt='514.9 ± 3.1'
        @glimmer='636.9 ± 4.2'
      />

      <Row
        @label='Append rows to large table'
        @vanila='44.3 ± 0.4'
        @svelte='46.6 ± 0.3'
        @gxt='57.3 ± 0.4'
        @glimmer='84.8 ± 0.4'
      />

      <Row
        @label='Clear rows'
        @vanila='13.2 ± 0.2'
        @svelte='14.3 ± 0.3'
        @gxt='24.1 ± 0.5'
        @glimmer='30.7 ± 0.8'
      />

      <Row
        @label='Ready memory'
        @vanila='0.5'
        @svelte='0.5'
        @gxt='0.5'
        @glimmer='5.2'
      />

      <Row
        @label='Run memory'
        @vanila='1.8'
        @svelte='2.7'
        @gxt='4.2'
        @glimmer='11.5'
      />

      <Row
        @label='Update row memory'
        @vanila='1.7'
        @svelte='2.6'
        @gxt='4.2'
        @glimmer='11.6'
      />

      <Row
        @label='Create/Clear 1k rows memory'
        @vanila='0.6'
        @svelte='0.9'
        @gxt='1.2'
        @glimmer='6.6'
      />

      <Row
        @label='Run memory 10k'
        @vanila='12.2'
        @svelte='19.3'
        @gxt='34.1'
        @glimmer='61.2'
      />

      <Row
        @label='Compressed size'
        @vanila='2kb'
        @svelte='6.4kb'
        @gxt='4.7kb'
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
