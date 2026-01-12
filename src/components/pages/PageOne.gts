import { cell } from '@lifeart/gxt';
import { Table } from './page-one/Table.gts';

function Controls() {
  const color = cell('red');

  const intervalId = setInterval(() => {
    color.update(Math.random() > 0.5 ? 'red' : 'blue');
  }, 1000);

  function onDestroy(_?: any) {
    return () => {
      clearInterval(intervalId);
    };
  }

  return <template>
    <h1 class="text-2xl font-bold mb-4">
      <q {{onDestroy}} class="px-2 py-1 rounded transition-colors duration-300" style.background-color={{color}}>
        Compilers are the New Frameworks
      </q>
      <span class="text-slate-400 font-normal ml-2">- Tom Dale</span>
    </h1>
  </template>;
}

export function PageOne() {
  return <template>
    <div class='text-white p-6 max-w-4xl mx-auto'>
      <Controls />

      <div class="bg-slate-800/50 rounded-xl p-6 mb-6">
        <p class="text-slate-300 leading-relaxed">
          Imagine a world where the robust, mature ecosystems of development
          tools meet the cutting-edge performance of modern compilers. That's what
          we're building here! Our platform takes the best of established
          technologies and infuses them with a new, state-of-the-art compiler.
        </p>
      </div>

      <div class="overflow-x-auto rounded-xl mb-6">
        <Table />
      </div>

      <div class="bg-slate-800/50 rounded-xl p-6 mb-6">
        <h2 class="text-xl font-semibold mb-4 text-white">This means:</h2>
        <ul class="space-y-3">
          <li class="flex items-start gap-3">
            <span class="text-blue-400 text-lg">✓</span>
            <div>
              <strong class="text-white">Increased Performance:</strong>
              <span class="text-slate-400 ml-1">Our modern compiler accelerates your code, making it run faster than ever.</span>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-green-400 text-lg">✓</span>
            <div>
              <strong class="text-white">Optimized Memory Usage:</strong>
              <span class="text-slate-400 ml-1">Experience more efficient memory management, allowing your applications to run smoother.</span>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-purple-400 text-lg">✓</span>
            <div>
              <strong class="text-white">Seamless Integration:</strong>
              <span class="text-slate-400 ml-1">Enjoy the ease of integrating with your favorite tools and frameworks.</span>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-amber-400 text-lg">✓</span>
            <div>
              <strong class="text-white">Future-Proof Technology:</strong>
              <span class="text-slate-400 ml-1">Stay ahead with a platform that evolves with the latest advancements.</span>
            </div>
          </li>
        </ul>
      </div>

      <p class="text-slate-400 italic mb-6">
        Join us in shaping the future of development, where power meets efficiency.
        Get ready to elevate your coding experience!
      </p>

      <div class="flex flex-wrap gap-3">
        <a
          href='/pageTwo'
          class="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
        >
          Go to page two →
        </a>
        <a
          href='/renderers'
          class="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition-colors"
        >
          Canvas Renderers →
        </a>
      </div>
    </div>
  </template>;
}
