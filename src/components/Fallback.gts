import { Component } from '@lifeart/gxt';

export default class Fallback extends Component {
  <template>
    <div class="bg-slate-700/30 rounded-xl p-4 border border-slate-600/30 animate-pulse">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-slate-600/50"></div>
        <div class="flex-1">
          <div class="h-4 bg-slate-600/50 rounded w-24 mb-2"></div>
          <div class="h-3 bg-slate-600/30 rounded w-16"></div>
        </div>
      </div>
    </div>
  </template>
}
