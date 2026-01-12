import { cell } from '@lifeart/gxt';

let isMobileDialogVisible = false;
let isMobile = () => false;

if (!import.meta.env.SSR) {
  // @ts-ignore
  isMobileDialogVisible = cell(false, 'Header mobile layout visibility');
  isMobile = () => window.innerWidth < 1024;
}

const onClick = () => {
  if (isMobile()) {
    isMobileDialogVisible.update(!isMobileDialogVisible.value);
  }
};

export const Header = <template>
  <header class='bg-slate-900/80 backdrop-blur-md border-b border-slate-700/50 sticky top-0 z-50'>
    <nav
      class='mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8'
      aria-label='Global'
    >
      {{! Logo }}
      <div class='flex lg:flex-1'>
        <a href='#' class='-m-1.5 p-1.5 flex items-center gap-3' {{on 'click' onClick}}>
          <span class='sr-only'>GXT</span>
          <div class='w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20'>
            <img
              class='h-6 w-6'
              width='24'
              height='24'
              src='/logo.png'
              alt=''
            />
          </div>
          <span class='text-white font-bold text-lg hidden sm:block'>GXT</span>
        </a>
      </div>

      {{! Mobile menu button }}
      <div class='flex lg:hidden'>
        <button
          type='button'
          {{on 'click' onClick}}
          class='-m-2.5 inline-flex items-center justify-center rounded-lg p-2.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors'
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

      {{! Desktop navigation }}
      <div class='hidden lg:flex lg:gap-x-2'>
        {{yield to='desktop'}}
      </div>

      {{! GitHub link }}
      <div class='hidden lg:flex lg:flex-1 lg:justify-end'>
        <a
          target='_blank'
          href='https://github.com/lifeart/glimmer-next'
          class='group inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-all'
        >
          <svg class='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
            <path fill-rule='evenodd' clip-rule='evenodd' d='M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z' />
          </svg>
          GitHub
          <span class='group-hover:translate-x-0.5 transition-transform' aria-hidden='true'>→</span>
        </a>
      </div>
    </nav>

    {{! Mobile menu overlay }}
    <div
      class={{if isMobileDialogVisible 'opacity-100' 'opacity-0 pointer-events-none'}}
      class='fixed inset-0 z-40 transition-opacity duration-300'
      role='dialog'
      aria-modal='true'
    >
      {{! Backdrop }}
      <div
        class='fixed inset-0 bg-slate-900/80 backdrop-blur-sm'
        {{on 'click' onClick}}
      ></div>

      {{! Mobile menu panel }}
      <div
        class={{if isMobileDialogVisible 'translate-x-0' 'translate-x-full'}}
        class='fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-slate-800 border-l border-slate-700 shadow-2xl transition-transform duration-300 ease-in-out'
      >
        <div class='flex items-center justify-between px-6 py-4 border-b border-slate-700'>
          <a href='#' class='-m-1.5 p-1.5 flex items-center gap-3'>
            <span class='sr-only'>GXT</span>
            <div class='w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center'>
              <img
                class='h-6 w-6'
                src='/logo.png'
                width='24'
                height='24'
                alt=''
              />
            </div>
            <span class='text-white font-bold text-lg'>GXT</span>
          </a>
          <button
            type='button'
            class='-m-2.5 rounded-lg p-2.5 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors'
            {{on 'click' onClick}}
          >
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
        <div class='px-6 py-6'>
          <div class='space-y-1'>
            {{yield to='mobile'}}
          </div>
          <div class='mt-6 pt-6 border-t border-slate-700'>
            <a
              target='_blank'
              href='https://github.com/lifeart/glimmer-next'
              class='flex items-center gap-3 px-3 py-3 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors'
            >
              <svg class='w-5 h-5' fill='currentColor' viewBox='0 0 24 24'>
                <path fill-rule='evenodd' clip-rule='evenodd' d='M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z' />
              </svg>
              <span class='font-medium'>GitHub</span>
              <span class='ml-auto' aria-hidden='true'>→</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>;
