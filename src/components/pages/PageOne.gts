import { cell } from '@lifeart/gxt';
import { Smile } from './page-one/Smile';
import { Table } from './page-one/Table.gts';
import { Suspense, lazy } from '@/utils/suspense';
import Fallback from '@/components/Fallback';

const LoadMeAsync = lazy(() => import('@/components/LoadMeAsync'));

function Controls() {
  const color = cell('red');

  const intervalId = setInterval(() => {
    color.update(Math.random() > 0.5 ? 'red' : 'blue');
  }, 1000);

  function onDestroy(_?: any) {
    return () => {
      console.log('destroying interval');
      clearInterval(intervalId);
    };
  }

  return <template>
    <h1><q {{onDestroy}} style.background-color={{color}}>Compilers are the New
        Frameworks</q>
      - Tom Dale &copy;</h1>
  </template>;
}

export function PageOne() {
  return <template>
    <div class='text-white p-3'>
      <Controls />
      <br />
      <Suspense @fallback={{Fallback}}>
        <LoadMeAsync @name='foo' />
        <Suspense @fallback={{Fallback}}>
          <LoadMeAsync @name='bar' />
          <Suspense @fallback={{Fallback}}>
            <LoadMeAsync @name='baz' />
            <Suspense @fallback={{Fallback}}>
              <LoadMeAsync @name='boo' />
              <Suspense @fallback={{Fallback}}>
                <LoadMeAsync @name='doo' />
              </Suspense>
            </Suspense>
          </Suspense>
        </Suspense>
      </Suspense>
      <div>Imagine a world where the robust, mature ecosystems of development
        tools meet the cutting-edge performance of modern compilers. That's what
        we're building here! Our platform takes the best of established
        technologies and infuses them with a new, state-of-the-art compiler.</div>
      <br />

      <div class='overflow-x-auto relative'>
        <Table />
      </div>
      <br />
      <h2>This means:</h2><br />
      <ul class='list-disc list-inside text-slate-900 dark:text-slate-200'>
        <li><b>Increased Performance:</b>
          Our modern compiler accelerates your code, making it run faster than
          ever.</li>
        <li><b>Optimized Memory Usage:</b>
          Experience more efficient memory management, allowing your
          applications to run smoother and more reliably.</li>
        <li><b>Seamless Integration:</b>
          Enjoy the ease of integrating with your favorite tools and frameworks
          from the mature ecosystem.</li>
        <li><b>Future-Proof Technology:</b>
          Stay ahead with a platform that evolves with the latest advancements
          in compiler technology.</li>

      </ul><br />
      <i>Join us in shaping the future of development, where power meets
        efficiency. Get ready to elevate your coding experience!</i>
      <br /><br />
      <a href='/pageTwo'>Go to page two <Smile /></a></div>
  </template>;
}
