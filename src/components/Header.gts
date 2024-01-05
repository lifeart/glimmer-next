import { Component } from '@/utils/component';
import { ButtonWrapper } from './ButtonWrapper.gts';
import { Smile } from './Smile';
import { Clock } from './Clock';

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
          <h1>GlimmerC<a
              href='https://github.com/lifeart/glimmer-next'
              target='_blank'
            ><Smile /></a>re
            <Clock /></h1>
        </div>
        <div class='col-md-6'>
          <div class='row'>
            <ButtonWrapper
              class='btn-primary btn-block'
              type='button'
              @onClick={{@run}}
              id='run'
            >
              Create 1 000 items
            </ButtonWrapper>
            <ButtonWrapper
              class='btn-primary btn-block'
              type='button'
              @onClick={{@runlots}}
              id='runlots'
            >
              Create 5 000 items
            </ButtonWrapper>
            <ButtonWrapper
              class='btn-primary btn-block'
              type='button'
              @onClick={{@add}}
              id='add'
            >
              Append 1 000 rows
            </ButtonWrapper>
            <ButtonWrapper
              class='btn-primary btn-block'
              type='button'
              @onClick={{@update}}
              id='update'
            >
              Update every 10th row
            </ButtonWrapper>
            <ButtonWrapper
              class='btn-primary btn-block'
              type='button'
              @onClick={{@clear}}
              id='clear'
            >
              Clear
            </ButtonWrapper>
            <ButtonWrapper
              class='btn-primary btn-block'
              type='button'
              @onClick={{@swaprows}}
              id='swaprows'
            >
              Swap rows
            </ButtonWrapper>
          </div>
        </div>
      </div>
    </div>
  </template>
}
