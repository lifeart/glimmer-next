//gist.github.com/lifeart/b6fc9ec2e111a12bb78a0558ef5afa11

// one of possible signals implementations

let USED_SIGNALS: Set<$Signal> | null = null;
const RELATED_WATCHERS: WeakMap<Computed, Set<Watcher>> = new WeakMap();
const COMPUTED_SIGNALS: WeakMap<$Signal, Set<Computed>> = new WeakMap();

class $Signal {
  value: any;
  constructor(value: any) {
    this.value = value;
  }
  get() {
    USED_SIGNALS?.add(this);
    return this.value;
  }
  set(value: any) {
    this.value = value;
    const Watchers: Set<Watcher> = new Set();
    COMPUTED_SIGNALS.get(this)?.forEach((computed) => {
      computed.isValid = false;
      computed.relatedSignals.forEach((signal) => {
        COMPUTED_SIGNALS.get(signal)!.delete(computed);
      });
      computed.relatedSignals = new Set();
      RELATED_WATCHERS.get(computed)!.forEach((watcher) => {
        if (watcher.isWatching) {
          watcher.pending.add(computed);
          Watchers.add(watcher);
        }
      });
    });
    Watchers.forEach((watcher) => {
      watcher.callback();
    });
  }
}

class Computed {
  fn: Function;
  relatedSignals: Set<$Signal> = new Set();
  isValid = false;
  result: any;
  constructor(fn = () => {}) {
    this.fn = fn;
  }
  get() {
    if (this.isValid) {
      return this.result;
    }
    const oldSignals = USED_SIGNALS;
    USED_SIGNALS = new Set();
    try {
      this.result = this.fn();
      this.isValid = true;
      return this.result;
    } finally {
      this.relatedSignals = new Set(USED_SIGNALS);
      USED_SIGNALS = oldSignals;
      this.relatedSignals.forEach((signal) => {
        if (!COMPUTED_SIGNALS.has(signal)) {
          COMPUTED_SIGNALS.set(signal, new Set());
        }
        COMPUTED_SIGNALS.get(signal)!.add(this);
      });
    }
  }
}
class Watcher {
  constructor(callback: Function) {
    this.callback = callback;
  }
  watched: Set<Computed> = new Set();
  pending: Set<Computed> = new Set();
  callback: Function;
  isWatching = true;
  watch(computed?: Computed) {
    if (!computed) {
      this.isWatching = true;
      return;
    }
    if (!RELATED_WATCHERS.has(computed)) {
      RELATED_WATCHERS.set(computed, new Set());
    }
    RELATED_WATCHERS.get(computed)!.add(this);
    this.watched.add(computed);
  }
  unwatch(computed: Computed) {
    this.watched.delete(computed);
    RELATED_WATCHERS.get(computed)!.delete(this);
  }
  getPending() {
    try {
      return Array.from(this.pending);
    } finally {
      this.pending.clear();
      this.isWatching = false;
    }
  }
}

export const Signal = {
  State: $Signal,
  Computed,
  subtle: {
    Watcher,
  },
};
