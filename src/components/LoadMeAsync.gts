import { Component } from '@lifeart/gxt';

const icons: Record<string, string> = {
  'User Profile': '👤',
  'Dashboard': '📊',
  'Settings': '⚙️',
  'Analytics': '📈',
  'Messages': '💬',
  'Notifications': '🔔',
};

const colors: Record<string, string> = {
  'User Profile': 'from-blue-500 to-cyan-500',
  'Dashboard': 'from-purple-500 to-pink-500',
  'Settings': 'from-slate-500 to-slate-600',
  'Analytics': 'from-green-500 to-emerald-500',
  'Messages': 'from-amber-500 to-orange-500',
  'Notifications': 'from-red-500 to-rose-500',
};

export default class LoadMeAsync extends Component<{
  Args: { name: string };
}> {
  get icon() {
    return icons[this.args.name] || '📦';
  }

  get gradientClass() {
    return colors[this.args.name] || 'from-slate-500 to-slate-600';
  }

  <template>
    <div class="group bg-slate-700/50 hover:bg-slate-700 rounded-xl p-4 border border-slate-600/50 hover:border-slate-500 transition-all duration-300 cursor-pointer">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br {{this.gradientClass}} flex items-center justify-center text-lg shadow-lg">
          {{this.icon}}
        </div>
        <div>
          <h3 class="font-medium text-white group-hover:text-cyan-300 transition-colors">{{@name}}</h3>
          <p class="text-xs text-slate-400">Loaded</p>
        </div>
      </div>
    </div>
  </template>
}
