import { Component, cell } from '@lifeart/gxt';

const colors: Record<string, string> = {
  'User Profile': 'from-blue-500/20 to-cyan-500/20',
  'Dashboard': 'from-purple-500/20 to-pink-500/20',
  'Settings': 'from-slate-500/20 to-slate-600/20',
  'Analytics': 'from-green-500/20 to-emerald-500/20',
  'Messages': 'from-amber-500/20 to-orange-500/20',
  'Notifications': 'from-red-500/20 to-rose-500/20',
};

const delays: Record<string, number> = {
  'User Profile': 0,
  'Dashboard': 150,
  'Settings': 300,
  'Analytics': 450,
  'Messages': 600,
  'Notifications': 750,
};

// Mini interactive widgets for each card
function UserProfileWidget() {
  const statusIndex = cell(0);
  const statuses = ['online', 'away', 'busy'] as const;
  const statusColors = ['bg-green-500', 'bg-yellow-500', 'bg-red-500'];

  const getStatus = () => statuses[statusIndex.value];
  const getStatusColor = () => statusColors[statusIndex.value];
  const cycleStatus = () => statusIndex.update((statusIndex.value + 1) % 3);

  return <template>
    <div class="flex items-center gap-3">
      <div class="relative">
        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center text-lg">👤</div>
        <button
          class="absolute -bottom-0.5 -right-0.5 w-4 h-4 {{getStatusColor}} rounded-full border-2 border-slate-800 cursor-pointer hover:scale-110 transition-transform"
          title="Click to change status"
          {{on 'click' cycleStatus}}
        ></button>
      </div>
      <div>
        <h3 class="font-medium text-white text-sm">User Profile</h3>
        <p class="text-xs text-slate-400">Status: {{getStatus}}</p>
      </div>
    </div>
  </template>;
}

function DashboardWidget() {
  const bars = [
    { height: 65, delay: 0 },
    { height: 40, delay: 50 },
    { height: 80, delay: 100 },
    { height: 55, delay: 150 },
    { height: 90, delay: 200 },
    { height: 45, delay: 250 },
    { height: 70, delay: 300 },
  ];
  return <template>
    <div class="flex items-center gap-3">
      <div class="flex items-end gap-0.5 h-10 px-1">
        {{#each bars as |bar|}}
          <div
            class="w-1.5 bg-gradient-to-t from-purple-500 to-pink-400 rounded-sm animate-[barGrow_0.5s_ease-out_forwards] hover:from-purple-400 hover:to-pink-300 transition-colors cursor-pointer origin-bottom"
            style="height: {{bar.height}}%; animation-delay: {{bar.delay}}ms"
            title="{{bar.height}}%"
          ></div>
        {{/each}}
      </div>
      <div>
        <h3 class="font-medium text-white text-sm">Dashboard</h3>
        <p class="text-xs text-slate-400">Weekly stats</p>
      </div>
    </div>
  </template>;
}

function SettingsWidget() {
  const darkMode = cell(true);
  const sounds = cell(false);

  const toggleDarkMode = () => darkMode.update(!darkMode.value);
  const toggleSounds = () => sounds.update(!sounds.value);

  return <template>
    <div class="flex items-center gap-3">
      <div class="flex flex-col gap-1">
        <button
          class="w-8 h-4 rounded-full transition-colors {{if darkMode.value 'bg-blue-500' 'bg-slate-600'}} relative cursor-pointer"
          {{on 'click' toggleDarkMode}}
        >
          <div class="absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all {{if darkMode.value 'left-4' 'left-0.5'}}"></div>
        </button>
        <button
          class="w-8 h-4 rounded-full transition-colors {{if sounds.value 'bg-green-500' 'bg-slate-600'}} relative cursor-pointer"
          {{on 'click' toggleSounds}}
        >
          <div class="absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all {{if sounds.value 'left-4' 'left-0.5'}}"></div>
        </button>
      </div>
      <div>
        <h3 class="font-medium text-white text-sm">Settings</h3>
        <p class="text-xs text-slate-400">Dark: {{if darkMode.value 'On' 'Off'}}, Sound: {{if sounds.value 'On' 'Off'}}</p>
      </div>
    </div>
  </template>;
}

function AnalyticsWidget() {
  const points = [20, 45, 30, 60, 40, 75, 55, 85];
  const pathD = points.map((y, i) => `${i === 0 ? 'M' : 'L'} ${i * 14} ${100 - y}`).join(' ');

  return <template>
    <div class="flex items-center gap-3">
      <svg class="w-12 h-10" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          d="{{pathD}}"
          fill="none"
          stroke="url(#analyticsGradient)"
          stroke-width="3"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="animate-[drawLine_1s_ease-out_forwards]"
          style="stroke-dasharray: 200; stroke-dashoffset: 200"
        />
        <defs>
          <linearGradient id="analyticsGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#22c55e" />
            <stop offset="100%" stop-color="#10b981" />
          </linearGradient>
        </defs>
      </svg>
      <div>
        <h3 class="font-medium text-white text-sm">Analytics</h3>
        <p class="text-xs text-green-400">↑ 23% this week</p>
      </div>
    </div>
  </template>;
}

function MessagesWidget() {
  const messages = cell(3);
  const addMessage = () => messages.update(messages.value + 1);

  return <template>
    <div class="flex items-center gap-3">
      <button
        class="relative w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-lg shadow-lg hover:scale-105 transition-transform cursor-pointer active:scale-95"
        {{on 'click' addMessage}}
        title="Click to add message"
      >
        💬
        {{#if messages.value}}
          <span class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs text-white flex items-center justify-center font-bold animate-[popIn_0.2s_ease-out]">
            {{messages.value}}
          </span>
        {{/if}}
      </button>
      <div>
        <h3 class="font-medium text-white text-sm">Messages</h3>
        <p class="text-xs text-slate-400">{{messages.value}} unread</p>
      </div>
    </div>
  </template>;
}

function NotificationsWidget() {
  const isShaking = cell(false);
  const shake = () => {
    isShaking.update(true);
    setTimeout(() => isShaking.update(false), 500);
  };

  return <template>
    <div class="flex items-center gap-3">
      <button
        class="w-10 h-10 rounded-lg bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center text-lg shadow-lg cursor-pointer hover:shadow-red-500/30 transition-shadow {{if isShaking.value 'animate-[bellShake_0.5s_ease-in-out]'}}"
        {{on 'click' shake}}
        title="Ring the bell!"
      >
        🔔
      </button>
      <div>
        <h3 class="font-medium text-white text-sm">Notifications</h3>
        <p class="text-xs text-slate-400">Click to ring!</p>
      </div>
    </div>
  </template>;
}

const widgets: Record<string, unknown> = {
  'User Profile': UserProfileWidget,
  'Dashboard': DashboardWidget,
  'Settings': SettingsWidget,
  'Analytics': AnalyticsWidget,
  'Messages': MessagesWidget,
  'Notifications': NotificationsWidget,
};

export default class LoadMeAsync extends Component<{
  Args: { name: string };
}> {
  get gradientClass() {
    return colors[this.args.name] || 'from-slate-500/20 to-slate-600/20';
  }

  get animationDelay() {
    return delays[this.args.name] ?? 0;
  }

  get cardStyle() {
    return `animation-delay: ${this.animationDelay}ms`;
  }

  get Widget() {
    return widgets[this.args.name];
  }

  <template>
    <div
      class="bg-gradient-to-br {{this.gradientClass}} rounded-xl p-4 border border-slate-600/30 animate-[fadeSlideIn_0.5s_ease-out_forwards] opacity-0"
      style={{this.cardStyle}}
    >
      {{#let this.Widget as |Widget|}}
        {{#if Widget}}
          <Widget />
        {{else}}
          <div class="text-white">{{@name}}</div>
        {{/if}}
      {{/let}}
    </div>
    <style>
      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes barGrow {
        from { transform: scaleY(0); }
        to { transform: scaleY(1); }
      }
      @keyframes drawLine {
        to { stroke-dashoffset: 0; }
      }
      @keyframes popIn {
        0% { transform: scale(0); }
        70% { transform: scale(1.2); }
        100% { transform: scale(1); }
      }
      @keyframes bellShake {
        0%, 100% { transform: rotate(0deg); }
        20% { transform: rotate(15deg); }
        40% { transform: rotate(-15deg); }
        60% { transform: rotate(10deg); }
        80% { transform: rotate(-10deg); }
      }
    </style>
  </template>
}
