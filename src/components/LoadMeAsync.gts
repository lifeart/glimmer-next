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

// Staggered delays for one-by-one loading effect
const delays: Record<string, number> = {
  'User Profile': 0,
  'Dashboard': 150,
  'Settings': 300,
  'Analytics': 450,
  'Messages': 600,
  'Notifications': 750,
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

  get animationDelay() {
    return delays[this.args.name] ?? 0;
  }

  get cardStyle() {
    return `animation-delay: ${this.animationDelay}ms`;
  }

  get iconStyle() {
    return `animation-delay: ${this.animationDelay + 100}ms`;
  }

  get textStyle() {
    return `animation-delay: ${this.animationDelay + 150}ms`;
  }

  <template>
    <div
      class="bg-gradient-to-br {{this.gradientClass}} rounded-xl p-4 border border-slate-600/30 animate-[fadeSlideIn_0.5s_ease-out_forwards] opacity-0"
      style={{this.cardStyle}}
    >
      <div class="flex items-center gap-3">
        <div
          class="w-10 h-10 rounded-lg bg-gradient-to-br {{this.iconGradientClass}} flex items-center justify-center text-lg shadow-lg animate-[scaleIn_0.3s_ease-out_forwards] scale-0"
          style={{this.iconStyle}}
        >
          {{this.icon}}
        </div>
        <div
          class="animate-[slideRight_0.3s_ease-out_forwards] opacity-0 -translate-x-2"
          style={{this.textStyle}}
        >
          <h3 class="font-medium text-white text-sm">{{@name}}</h3>
          <p class="text-xs text-slate-400">Module loaded</p>
        </div>
      </div>
    </div>
    <style>
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes scaleIn {
        from { transform: scale(0) rotate(-10deg); }
        to { transform: scale(1) rotate(0deg); }
      }
      @keyframes slideRight {
        from { opacity: 0; transform: translateX(-12px); }
        to { opacity: 1; transform: translateX(0); }
      }
    </style>
  </template>
}
