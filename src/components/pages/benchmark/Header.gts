import { Component } from '@lifeart/gxt';
import { ButtonWrapper } from './ButtonWrapper.gts';

type Cb = () => void;

type HeaderArgs = {
  run: Cb;
  add: Cb;
  update: Cb;
  clear: Cb;
  swaprows: Cb;
  runlots: Cb;
};

export class Header extends Component<{
  Args: HeaderArgs;
}> {
  <template>
    <div class='mb-6'>
      <div class='flex items-center gap-3 mb-4'>
        <div class='w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center'>
          <span class='text-xl'>⚡</span>
        </div>
        <div>
          <h1 class='text-2xl font-bold text-white'>Performance Benchmark</h1>
          <p class='text-slate-400 text-sm'>Test GXT's rendering performance with large lists</p>
        </div>
      </div>

      <div class='bg-slate-800/40 backdrop-blur rounded-xl p-4 border border-slate-700/50'>
        <div class='flex flex-wrap gap-2'>
          <ButtonWrapper
            type='button'
            @onClick={{@run}}
            id='run'
            class='bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 border-blue-500'
          >
            Create 1,000 rows
          </ButtonWrapper>
          <ButtonWrapper
            type='button'
            @onClick={{@runlots}}
            id='runlots'
            class='bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 border-purple-500'
          >
            Create 5,000 rows
          </ButtonWrapper>
          <ButtonWrapper
            type='button'
            @onClick={{@add}}
            id='add'
          >
            Append 1,000 rows
          </ButtonWrapper>
          <ButtonWrapper
            type='button'
            @onClick={{@update}}
            id='update'
          >
            Update every 10th
          </ButtonWrapper>
          <ButtonWrapper
            type='button'
            @onClick={{@swaprows}}
            id='swaprows'
          >
            Swap rows
          </ButtonWrapper>
          <ButtonWrapper
            type='button'
            @onClick={{@clear}}
            id='clear'
            class='bg-red-600/20 hover:bg-red-600/40 border-red-500/50 text-red-400 hover:text-red-300'
          >
            Clear
          </ButtonWrapper>
        </div>
      </div>
    </div>
  </template>
}
