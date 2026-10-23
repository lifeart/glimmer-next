// Page-side driver for the budget harness (bench/budgets/run.mjs). The page
// renders ONE row kind (`?kind=inline|component|frames|text`) and exposes
// `window.__bench`, which the Playwright runner drives over CDP. Ops write the
// store, then flush gxt synchronously (`syncDom`) so the measured interval
// covers the whole render, not a microtask hop.
import { renderComponent, syncDom } from '@lifeart/gxt';
import { Store } from './store';
import { buildData, type Item } from './data';
import { InlineRows, FrameRows, ComponentRows, TextRows } from './kinds.gts';

const ROOTS = {
  inline: InlineRows,
  frames: FrameRows,
  component: ComponentRows,
  text: TextRows,
} as const;
type Kind = keyof typeof ROOTS;

const requested = new URLSearchParams(location.search).get('kind') ?? 'inline';
if (!(requested in ROOTS)) {
  throw new Error(`budget harness: unknown row kind "${requested}"`);
}
const kind = requested as Kind;
const store = new Store();
const main = document.getElementById('main')!;

renderComponent(ROOTS[kind] as never, { element: main, args: { store } });

// Rows built ahead of time (see `hold`): lets the runner take the heap
// baseline WITH the data alive, so the 10k-row delta is rendering cost only.
// `retained` keeps the data alive past `clear` until `release`, so the
// after-clear delta is the framework's residue, not freed row data.
let held: Item[] | null = null;
let retained: Item[] | null = null;

function flush(): void | Promise<void> {
  return syncDom();
}

/** One macrotask hop: every microtask (async list teardown, scheduled
 * revalidation) has drained when it resolves. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

function rowAt(index: number): HTMLTableRowElement {
  const row = main.querySelectorAll('tbody > tr')[index] as
    | HTMLTableRowElement
    | undefined;
  if (row === undefined) {
    throw new Error(`budget harness: no row at index ${index}`);
  }
  return row;
}

const ops: Record<string, (arg?: number) => void> = {
  run: (n = 1000) => store.run(n),
  add: (n = 1000) => store.add(n),
  update: () => store.update(),
  select: (index = 1) => store.select(store.items[index]),
  swap: () => store.swap(),
  remove: (index = 1) => store.remove(store.items[index]),
  clear: () => store.clear(),
  renderHeld: () => {
    if (held === null) throw new Error('budget harness: nothing held');
    store.items = held;
    held = null;
  },
};

const bench = {
  kind,
  hold(n: number) {
    held = retained = buildData(n);
  },
  release() {
    retained = null;
  },
  isRetaining(): boolean {
    return retained !== null;
  },
  /** Run an op to completion (no timing). */
  async op(name: string, arg?: number) {
    const fn = ops[name];
    if (fn === undefined) throw new Error(`budget harness: unknown op ${name}`);
    fn(arg);
    await flush();
    await macrotask();
  },
  /** Run an op and time it: `script` = write + synchronous gxt flush,
   * `total` = script + drained microtasks + forced style/layout. */
  async measure(name: string, arg?: number) {
    const fn = ops[name];
    if (fn === undefined) throw new Error(`budget harness: unknown op ${name}`);
    const t0 = performance.now();
    fn(arg);
    await flush();
    const t1 = performance.now();
    await macrotask();
    void document.body.offsetHeight;
    const t2 = performance.now();
    return { script: t1 - t0, total: t2 - t0 };
  },
  /** Click a row's select / remove link (event wiring check). */
  async click(index: number, which: 'select' | 'remove') {
    const links = rowAt(index).querySelectorAll('a');
    (which === 'select' ? links[0] : links[1]).click();
    await flush();
    await macrotask();
  },
  selectedRowIndex(): number {
    const rows = main.querySelectorAll('tbody > tr');
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i] as HTMLElement).className === 'danger') return i;
    }
    return -1;
  },
  rowCount(): number {
    return main.querySelectorAll('tbody > tr').length;
  },
  firstLabel(): string {
    return rowAt(0).querySelectorAll('a')[0].textContent ?? '';
  },
  /** DOM node census under the table body (by node type). */
  census() {
    const tbody = main.querySelector('tbody')!;
    const counts = { elements: 0, text: 0, comments: 0 };
    const walker = document.createTreeWalker(tbody, NodeFilter.SHOW_ALL);
    let node = walker.nextNode();
    while (node !== null) {
      if (node.nodeType === Node.ELEMENT_NODE) counts.elements++;
      else if (node.nodeType === Node.TEXT_NODE) counts.text++;
      else if (node.nodeType === Node.COMMENT_NODE) counts.comments++;
      node = walker.nextNode();
    }
    return counts;
  },
};

(window as unknown as { __bench: typeof bench }).__bench = bench;
document.title = `gxt budgets: ${kind}`;
