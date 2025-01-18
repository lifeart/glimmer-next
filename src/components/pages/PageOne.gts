import { type Cell, cell } from '@lifeart/gxt';
import { Smile } from './page-one/Smile';
import { Table } from './page-one/Table.gts';
import { CanvasRenderer } from '@/utils/renderers/canvas';

function QuoteHeader() {
  const color = cell('rgb(59, 130, 246)');

  const intervalId = setInterval(() => {
    color.update(Math.random() > 0.5 ? 'rgb(59, 130, 246)' : 'rgb(139, 92, 246)');
  }, 2000);

  function onDestroy(_?: any) {
    return () => {
      clearInterval(intervalId);
    };
  }

  return <template>
    <div class="mb-8">
      <h1 class="text-4xl md:text-5xl font-bold mb-3 leading-tight">
        <span {{onDestroy}} class="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent transition-all duration-1000" style.filter="drop-shadow(0 0 20px {{color}})">
          Compilers are the New Frameworks
        </span>
      </h1>
      <p class="text-slate-400 text-lg">
        — Tom Dale
      </p>
    </div>
  </template>;
}

function FeatureCard({ icon, title, description, iconClass }: { icon: string; title: string; description: string; iconClass: string }) {
  return <template>
    <div class="group relative bg-slate-800/40 backdrop-blur rounded-2xl p-5 border border-slate-700/50 hover:border-slate-600 transition-all duration-300">
      <div class="flex items-start gap-4">
        <div class={{iconClass}}>
          {{icon}}
        </div>
        <div>
          <h3 class="font-semibold text-white mb-1">{{title}}</h3>
          <p class="text-slate-400 text-sm leading-relaxed">{{description}}</p>
        </div>
      </div>
    </div>
  </template>;
}

const tx = cell('hello');
const x = cell(10);
const y = cell(50);
const font = cell('48px serif');
const fillStyle = cell('red');
const isVisible = cell(false);
const list = cell([1, 2, 3]);

// setInterval(() => {
//   // shuffle list
//   list.update(list.value.slice().reverse());
// }, 3000);

function update(el: Cell<any>, e: InputEvent & { target: HTMLInputElement }) {
  if (e.target.type === 'number') {
    el.update(e.target.valueAsNumber);
  } else if (e.target.type === 'checkbox') {
    el.update(e.target.checked);
  } else {
    el.update(e.target.value);
  }
}

const add = (v1: number, v2: number) => {
  return v1 + v2;
};
const mult = (v1: number, v2: number) => {
  return v1 * v2;
};

function Controls() {
  return <template>
    <div class="space-y-2 p-4 bg-slate-800/40 rounded-lg">
      <div class="flex flex-wrap gap-2">
        <input
          style.color='black'
          value={{tx.value}}
          {{on 'input' (fn update tx)}}
          placeholder="Text"
          class="px-2 py-1 rounded"
        />
        <input
          style.color='black'
          value={{font.value}}
          {{on 'input' (fn update font)}}
          placeholder="Font"
          class="px-2 py-1 rounded"
        />
        <input
          style.color='black'
          value={{fillStyle.value}}
          {{on 'input' (fn update fillStyle)}}
          placeholder="Color"
          class="px-2 py-1 rounded"
        />
        <input
          style.color='black'
          value={{x.value}}
          type='number'
          {{on 'input' (fn update x)}}
          placeholder="X"
          class="px-2 py-1 rounded w-20"
        />
        <input
          style.color='black'
          value={{y.value}}
          type='number'
          {{on 'input' (fn update y)}}
          placeholder="Y"
          class="px-2 py-1 rounded w-20"
        />
        <label class="flex items-center gap-2 text-white">
          <input
            type='checkbox'
            checked={{isVisible.value}}
            {{on 'change' (fn update isVisible)}}
          />
          Show list
        </label>
      </div>
    </div>
  </template>;
}

export function PageOne() {
  return <template>
    <div class='text-white p-6 lg:p-8 max-w-7xl mx-auto'>
      <QuoteHeader />

      {{! Hero Section }}
      <div class="relative mb-10">
        <div class="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10 rounded-3xl blur-3xl"></div>
        <div class="relative bg-slate-800/60 backdrop-blur-sm rounded-2xl p-6 md:p-8 border border-slate-700/50">
          <p class="text-lg md:text-xl text-slate-200 leading-relaxed">
            Imagine a world where the robust, mature ecosystems of development
            tools meet the cutting-edge performance of modern compilers. That's what
            we're building here — a platform that takes the best of established
            technologies and infuses them with a new, state-of-the-art compiler.
          </p>
        </div>
      </div>

      {{! Canvas Renderer Demo }}
      <div class="mb-10">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <span class="text-sm">🎨</span>
          </div>
          <h2 class="text-xl font-semibold">Canvas Renderer Demo</h2>
        </div>
        <div class="bg-slate-800/40 backdrop-blur rounded-2xl border border-slate-700/50 p-4">
          <Controls />
          <div class="mt-4">
            <CanvasRenderer>
              <text
                x={{x.value}}
                y={{y.value}}
                font={{font.value}}
                fillStyle={{fillStyle.value}}
              >{{tx.value}}</text>

              {{#if isVisible}}
                {{#each list sync=true as |n i|}}
                  <text
                    x={{add 40 (mult (mult n i) 8)}}
                    y={{add 70 (mult (mult n i) 8)}}
                  >{{n}}</text>
                {{/each}}
              {{else}}
                <text x={{30}} y={{60}}>foo</text>
              {{/if}}
            </CanvasRenderer>
          </div>
        </div>
      </div>

      {{! Benchmark Table }}
      <div class="mb-10">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <span class="text-sm">📊</span>
          </div>
          <h2 class="text-xl font-semibold">Performance Benchmarks</h2>
        </div>
        <div class="bg-slate-800/40 backdrop-blur rounded-2xl border border-slate-700/50 overflow-hidden">
          <div class="overflow-x-auto">
            <Table />
          </div>
        </div>
        <p class="text-xs text-slate-500 mt-2 text-center">
          Lower is better. All times in milliseconds. Memory in MB.
        </p>
      </div>

      {{! Features Grid }}
      <div class="mb-10">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
            <span class="text-sm">✨</span>
          </div>
          <h2 class="text-xl font-semibold">Why GXT?</h2>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FeatureCard
            @icon="⚡"
            @title="Blazing Fast Performance"
            @description="Our modern compiler accelerates your code, achieving near-vanilla JavaScript speeds."
            @iconClass="flex-shrink-0 w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-400 text-xl"
          />
          <FeatureCard
            @icon="🧠"
            @title="Optimized Memory"
            @description="Efficient memory management keeps your applications running smooth and responsive."
            @iconClass="flex-shrink-0 w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center text-green-400 text-xl"
          />
          <FeatureCard
            @icon="🔌"
            @title="Seamless Integration"
            @description="Works with your favorite tools and frameworks from the mature Ember ecosystem."
            @iconClass="flex-shrink-0 w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400 text-xl"
          />
          <FeatureCard
            @icon="🚀"
            @title="Future-Proof"
            @description="Stay ahead with a platform that evolves with the latest compiler advancements."
            @iconClass="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 text-xl"
          />
        </div>
      </div>

      {{! CTA Section }}
      <div class="relative">
        <div class="absolute inset-0 bg-gradient-to-r from-blue-600/5 to-purple-600/5 rounded-2xl"></div>
        <div class="relative bg-slate-800/30 rounded-2xl p-6 border border-slate-700/30">
          <p class="text-slate-300 mb-6 text-center md:text-left">
            Join us in shaping the future of development, where power meets efficiency.
          </p>
          <div class="flex flex-wrap justify-center md:justify-start gap-3">
            <a
              href='/pageTwo'
              class="group inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white font-medium rounded-xl transition-all shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40"
            >
              Explore Goals
              <span class="group-hover:translate-x-1 transition-transform">→</span>
            </a>
            <a
              href='/renderers'
              class="group inline-flex items-center gap-2 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-all border border-slate-600"
            >
              <span class="text-purple-400">🎨</span>
              Custom Renderers
            </a>
            <a
              href='/benchmark'
              class="group inline-flex items-center gap-2 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-all border border-slate-600"
            >
              <span class="text-amber-400">⚡</span>
              Run Benchmark
            </a>
          </div>
        </div>
      </div>
    </div>
  </template>;
}
