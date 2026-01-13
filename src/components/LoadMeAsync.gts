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
  'User Profile': 'from-blue-500/20 to-cyan-500/20',
  'Dashboard': 'from-purple-500/20 to-pink-500/20',
  'Settings': 'from-slate-500/20 to-slate-600/20',
  'Analytics': 'from-green-500/20 to-emerald-500/20',
  'Messages': 'from-amber-500/20 to-orange-500/20',
  'Notifications': 'from-red-500/20 to-rose-500/20',
};

const iconColors: Record<string, string> = {
  'User Profile': 'from-blue-500 to-cyan-500',
  'Dashboard': 'from-purple-500 to-pink-500',
  'Settings': 'from-slate-400 to-slate-500',
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
    return colors[this.args.name] || 'from-slate-500/20 to-slate-600/20';
  }

  get iconGradientClass() {
    return iconColors[this.args.name] || 'from-slate-400 to-slate-500';
  }

  <template>
    <div class="bg-gradient-to-br {{this.gradientClass}} rounded-xl p-4 border border-slate-600/30 animate-[fadeSlideIn_0.4s_ease-out_forwards] opacity-0">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br {{this.iconGradientClass}} flex items-center justify-center text-lg shadow-lg animate-[scaleIn_0.3s_ease-out_0.1s_forwards] scale-0">
          {{this.icon}}
        </div>
        <div class="animate-[slideRight_0.3s_ease-out_0.15s_forwards] opacity-0 -translate-x-2">
          <h3 class="font-medium text-white text-sm">{{@name}}</h3>
          <p class="text-xs text-slate-400">Module loaded</p>
        </div>
      </div>
    </div>
    <style>
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes scaleIn {
        from { transform: scale(0); }
        to { transform: scale(1); }
      }
      @keyframes slideRight {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }
    </style>
  </template>
}
