import { Component } from '@lifeart/gxt';
import { Clock } from './page-two/Clock';

function GoalCard({ icon, title, description, iconBgClass }: {
  icon: string;
  title: string;
  description: string;
  iconBgClass: string;
}) {
  return <template>
    <div class="group relative bg-slate-800/40 backdrop-blur rounded-2xl p-6 border border-slate-700/50 hover:border-slate-600/80 transition-all duration-300 hover:bg-slate-800/60">
      <div class="flex items-start gap-4">
        <div class={{iconBgClass}}>
          {{icon}}
        </div>
        <div>
          <h3 class="font-semibold text-white text-lg mb-2">{{title}}</h3>
          <p class="text-slate-400 text-sm leading-relaxed">{{description}}</p>
        </div>
      </div>
    </div>
  </template>;
}

function ObjectiveItem({ text }: { text: string }) {
  return <template>
    <li class="flex items-start gap-3 py-3">
      <span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center mt-0.5">
        <span class="text-emerald-400 text-sm">✓</span>
      </span>
      <span class="text-slate-300 leading-relaxed">{{text}}</span>
    </li>
  </template>;
}

export class PageTwo extends Component {
  get nextLink() {
    if (import.meta.env.SSR) {
      return '/';
    }
    if (window.location.pathname === '/') {
      return '/pageOne';
    } else {
      return '/';
    }
  }
  <template>
    <div class='text-white p-6 lg:p-8 max-w-6xl mx-auto'>
      {{! Header }}
      <div class="mb-10">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <span class="text-xl">🎯</span>
          </div>
          <h1 class="text-3xl md:text-4xl font-bold">
            <span class="bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
              Project Goals
            </span>
          </h1>
        </div>
        <p class="text-slate-400 text-lg max-w-3xl">
          Discover the vision behind GXT and how we're shaping the future of web development.
        </p>
      </div>

      {{! Main Goals Grid }}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-10">
        <GoalCard
          @icon="⚡"
          @title="Modern Compiler Technology"
          @description="GXT is the evolution of GlimmerVM, designed to integrate seamlessly with cutting-edge compiler technology. We harness modern compilers to deliver unprecedented performance improvements and efficient memory usage."
          @iconBgClass="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-2xl"
        />
        <GoalCard
          @icon="🔄"
          @title="Backward Compatibility"
          @description="A key focus is ensuring backward compatibility with the entire Ember community's infrastructure and tooling. We prioritize smooth transitions and effortless integration for developers."
          @iconBgClass="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 flex items-center justify-center text-2xl"
        />
        <GoalCard
          @icon="🤝"
          @title="Community-Driven Development"
          @description="We believe in the power of community collaboration. GXT is committed to working closely with developers, gathering feedback, and continuously improving to meet evolving needs."
          @iconBgClass="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center text-2xl"
        />
        <GoalCard
          @icon="🚀"
          @title="Future-Ready Platform"
          @description="A robust platform that evolves with technological advancements, maintaining the forefront position in web development while preserving developer experience."
          @iconBgClass="flex-shrink-0 w-12 h-12 rounded-xl bg-gradient-to-br from-pink-500/20 to-rose-500/20 flex items-center justify-center text-2xl"
        />
      </div>

      {{! Key Objectives Section }}
      <div class="mb-10">
        <div class="relative">
          <div class="absolute inset-0 bg-gradient-to-r from-emerald-600/10 to-teal-600/10 rounded-2xl blur-xl"></div>
          <div class="relative bg-slate-800/60 backdrop-blur-sm rounded-2xl p-6 border border-slate-700/50">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
                <span class="text-sm">📋</span>
              </div>
              <h2 class="text-xl font-semibold">Key Objectives</h2>
            </div>
            <ul class="divide-y divide-slate-700/50">
              <ObjectiveItem @text="Leverage cutting-edge compiler technology to optimize performance and memory management" />
              <ObjectiveItem @text="Ensure GXT works harmoniously with existing Ember tools and ecosystems" />
              <ObjectiveItem @text="Provide a robust platform that evolves with technological advancements" />
              <ObjectiveItem @text="Maintain developer experience while pushing performance boundaries" />
              <ObjectiveItem @text="Foster an open-source community around modern rendering techniques" />
            </ul>
          </div>
        </div>
      </div>

      {{! Live Clock Demo }}
      <div class="mb-10">
        <div class="bg-slate-800/40 backdrop-blur rounded-2xl p-6 border border-slate-700/50">
          <div class="flex items-center justify-between flex-wrap gap-4">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center">
                <span class="text-sm">🕐</span>
              </div>
              <div>
                <h3 class="font-semibold text-white">Live Reactivity Demo</h3>
                <p class="text-slate-400 text-sm">Real-time updates powered by GXT's reactive system</p>
              </div>
            </div>
            <div class="px-4 py-2 bg-slate-700/50 rounded-xl border border-slate-600/50">
              <span class="text-cyan-400 font-mono text-lg"><Clock /></span>
            </div>
          </div>
        </div>
      </div>

      {{! Navigation }}
      <div class="flex flex-wrap justify-center gap-3">
        <a
          href='/pageOne'
          class="group inline-flex items-center gap-2 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-all border border-slate-600"
        >
          <span class="group-hover:-translate-x-1 transition-transform">←</span>
          Back to Overview
        </a>
        <a
          href='/renderers'
          class="group inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40"
        >
          <span class="text-white">🎨</span>
          Explore Renderers
          <span class="group-hover:translate-x-1 transition-transform">→</span>
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
  </template>
}
