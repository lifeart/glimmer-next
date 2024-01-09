import { cell } from '@lifeart/gxt';

const isMobileDialogVisible = cell(window.innerWidth < 1024);
const isMobile = () => window.innerWidth < 1024;

window.addEventListener('resize', () => {
  if (window.innerWidth < 1024) {
    if (isMobileDialogVisible.value !== true) {
      isMobileDialogVisible.update(true);
    }
  } else {
    if (isMobileDialogVisible.value !== false) {
      isMobileDialogVisible.update(false);
    }
  }
});

const onClick = () => {
  if (isMobile()) {
    isMobileDialogVisible.update(!isMobileDialogVisible.value);
  }
};

export const Header = <template>
  <header class='bg-white'>
    <nav
      class='mx-auto flex max-w-7xl items-center justify-between p-6 lg:px-8'
      aria-label='Global'
    >
      <div class='flex lg:flex-1'>
        <a href='#' class='-m-1.5 p-1.5' {{on 'click' onClick}}>
          <span class='sr-only'>GXT</span>
          <img class='h-8 w-auto' src='/logo.png' alt='' />
        </a>
      </div>
      <div class='flex lg:hidden'>
        <button
          type='button'
          class='-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700'
        >
          <span class='sr-only'>Open main menu</span>
          <svg
            class='h-6 w-6'
            fill='none'
            viewBox='0 0 24 24'
            stroke-width='1.5'
            stroke='currentColor'
            aria-hidden='true'
          >
            <path
              stroke-linecap='round'
              stroke-linejoin='round'
              d='M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5'
            />
          </svg>
        </button>
      </div>
      <div class='hidden lg:flex lg:gap-x-12'>
        {{yield to='desktop'}}

      </div>
      <div class='hidden lg:flex lg:flex-1 lg:justify-end'>
        <a
          target='_blank'
          href='https://github.com/lifeart/glimmer-next'
          class='text-sm font-semibold leading-6 text-gray-900'
        >Explore
          <span aria-hidden='true'>&rarr;</span></a>
      </div>
    </nav>
    {{! @todo - fix conditional slots }}
    <!-- Mobile menu, show/hide based on menu open state. -->
    <div
      class={{if isMobileDialogVisible '' 'hidden'}}
      role='dialog'
      aria-modal='true'
      {{on 'click' onClick}}
    >
      <!-- Background backdrop, show/hide based on slide-over state. -->
      <div class='fixed inset-0 z-10'></div>
      <div
        class='fixed inset-y-0 right-0 z-10 w-full overflow-y-auto bg-white px-6 py-6 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10'
      >
        <div class='flex items-center justify-between'>
          <a href='#' class='-m-1.5 p-1.5'>
            <span class='sr-only'>GXT</span>
            <img class='h-8 w-auto' src='/logo.png' alt='' />
          </a>
          <button type='button' class='-m-2.5 rounded-md p-2.5 text-gray-700'>
            <span class='sr-only'>Close menu</span>
            <svg
              class='h-6 w-6'
              fill='none'
              viewBox='0 0 24 24'
              stroke-width='1.5'
              stroke='currentColor'
              aria-hidden='true'
            >
              <path
                stroke-linecap='round'
                stroke-linejoin='round'
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        </div>
        <div class='mt-6 flow-root'>
          <div class='-my-6 divide-y divide-gray-500/10'>
            <div class='space-y-2 py-6'>
              {{yield to='mobile'}}
            </div>
            <div class='py-6'>
              <a
                target='_blank'
                href='https://github.com/lifeart/glimmer-next'
                class='-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50'
              >Explore</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>;
