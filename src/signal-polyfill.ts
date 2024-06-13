//gist.github.com/lifeart/b6fc9ec2e111a12bb78a0558ef5afa11

// one of possible signals implementations

let USED_SIGNALS: Set<$Signal> | null = null;
let inUntrackCall = false;
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
      for (const watcher of RELATED_WATCHERS.get(computed)!) {
        Watchers.add(watcher);
      }
    });
    Watchers.forEach((watcher) => {
      watcher.callback();
    });
  }
}

function untrack(fn = () => {}) {
  inUntrackCall = true;
  try {
    fn();
  } catch(e) {
    // EOL
  } finally {
    inUntrackCall = false;
  }
};

class Computed {
  fn: Function;
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
    USED_SIGNALS = inUntrackCall ? USED_SIGNALS : new Set();
    try {
      this.result = this.fn();
      this.isValid = true;
      return this.result;
    } finally {
      if (!inUntrackCall) {
        USED_SIGNALS?.forEach((signal) => {
          if (!COMPUTED_SIGNALS.has(signal)) {
            COMPUTED_SIGNALS.set(signal, new Set());
          }
          COMPUTED_SIGNALS.get(signal)!.add(this);
        });
        USED_SIGNALS = oldSignals;
      }
    }
  }
}
class Watcher {
  constructor(callback: Function) {
    this.callback = callback;
  }
  watched: Set<Computed> = new Set();
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
    if (!this.isWatching) {
      return [];
    }
    try {
      return Array.from(this.watched).filter((computed) => !computed.isValid);
    } finally {
      this.isWatching = false;
    }
  }
}

export const Signal = {
  State: $Signal,
  Computed,
  untrack,
  subtle: {
    Watcher,
  },
};
