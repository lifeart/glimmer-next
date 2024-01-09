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
    <div class='jumbotron'>
      <div class='row'>
        <div class='col-md-6'>
          <div class='flex'>
            <ButtonWrapper
              class='mr-1'
              type='button'
              @onClick={{@run}}
              id='run'
            >
              Create 1 000 items
            </ButtonWrapper>
            <ButtonWrapper
              class='mr-1'
              type='button'
              @onClick={{@runlots}}
              id='runlots'
            >
              Create 5 000 items
            </ButtonWrapper>
            <ButtonWrapper
              class='mr-1'
              type='button'
              @onClick={{@add}}
              id='add'
            >
              Append 1 000 rows
            </ButtonWrapper>
            <ButtonWrapper
              class='mr-1'
              type='button'
              @onClick={{@update}}
              id='update'
            >
              Update every 10th row
            </ButtonWrapper>

            <ButtonWrapper
              class='mr-1'
              type='button'
              @onClick={{@swaprows}}
              id='swaprows'
            >
              Swap rows
            </ButtonWrapper>
            <ButtonWrapper
              class='mr-1'
              type='button'
              @onClick={{@clear}}
              id='clear'
            >
              Clear
            </ButtonWrapper>

          </div>
        </div>
      </div>
    </div>
  </template>
}
