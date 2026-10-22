/**
 * @vitest-environment happy-dom
 *
 * Differential render tests: one seeded template (generator.ts), one tape of
 * state writes and clicks, rendered through every {{#each}} runtime path gxt
 * has. After every tape step the normalized DOM and the click log must be
 * identical across paths; after teardown the reactive/tree registries must be
 * back to their pre-mount sizes.
 *
 * Paths (the compiled code resolves `$_each` / `$_eachSync` from
 * globalThis, so each path is forced by wrapping those globals):
 *   plain   — the block args are dropped: rows come from the compiled body
 *             callback (`$_tag` & co.), the generic path;
 *   block   — static-block v1 (`$_blk` cloneNode + per-binding formulas):
 *             the list is told the body reads `{{index}}`, which keeps it off
 *             frames (the rows never read it);
 *   frames  — as compiled: frame mode where the body qualifies, else v1;
 * each in the async (`$_each`) and the sync (`$_eachSync`) list flavour.
 *
 * Normalization: comments are dropped (row/list markers differ per path by
 * design) and attributes are compared sorted by name (the block path bakes
 * static attributes into its HTML chunk ahead of the dynamic ones).
 *
 * Known divergence (pinned by the last test below, excluded from the
 * generated tapes unless GXT_FUZZ_REFSWAP=1): a new object under an existing
 * key. Frame mode re-binds the row to it; the other paths re-bind only
 * through a host's `rebindEachItem` hook (each-append-rebind.test.ts:
 * "without a host hook nothing is re-bound"), so standalone they keep
 * rendering the old object.
 *
 * Not covered: SSR / rehydration vs client render. `IN_SSR_ENV` is fixed
 * when shared.ts loads, so the SSR path needs its own module graph (a node
 * environment test file), which this harness does not set up.
 *
 * The suite runs 40 seeds by default (~6 s):
 *   GXT_FUZZ_SEEDS=1000 npx vitest run src/core/__fuzz__   — more seeds
 *   GXT_FUZZ_SEED=123  npx vitest run src/core/__fuzz__    — one seed
 *   GXT_FUZZ_REFSWAP=1 npx vitest run src/core/__fuzz__    — tapes with ref-swaps
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createDOMFixture, type DOMFixture } from '../__test-utils__';
import { settle, setupRuntimeTemplateGlobals } from '../__test-utils__/list-harness';
import { Component } from '../component';
import {
  $template,
  RENDERED_NODES_PROPERTY,
  addToTree,
  TREE,
  CHILD,
  PARENT,
} from '../shared';
import { $_c, $_args, $_edp } from '../dom';
import { renderElement } from '../render-core';
import { destroyElementSync } from '../destroy';
import { cellFor, opsForTag, relatedTags } from '../reactive';
import { GXT_RUNTIME_SYMBOLS, template } from '../../../plugins/runtime-compiler';
import { generateTemplate, generateTape, type Step } from './generator';

type Path = 'plain' | 'block' | 'frames';
type Flavour = 'async' | 'sync';
interface Mode {
  path: Path;
  flavour: Flavour;
}
const MODES: Mode[] = [];
for (const path of ['plain', 'block', 'frames'] as const) {
  for (const flavour of ['async', 'sync'] as const) MODES.push({ path, flavour });
}
const modeName = (m: Mode) => `${m.path}/${m.flavour}`;

const DEFAULT_SEEDS = 40;
function seeds(): number[] {
  const one = process.env.GXT_FUZZ_SEED;
  if (one !== undefined && one !== '') return [Number(one)];
  const count = Number(process.env.GXT_FUZZ_SEEDS ?? DEFAULT_SEEDS);
  return Array.from({ length: count }, (_, i) => i + 1);
}

// ---------------------------------------------------------------- path forcing
type EachFn = (...args: unknown[]) => unknown;
const ORIGINAL = GXT_RUNTIME_SYMBOLS as unknown as Record<string, EachFn>;

function installMode(mode: Mode): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const target = mode.flavour === 'sync' ? ORIGINAL.$_eachSync : ORIGINAL.$_each;
  const each: EachFn =
    mode.path === 'plain'
      ? (items, fn, key, ctx, inverseFn, hasIndex) =>
          target(items, fn, key, ctx, inverseFn, hasIndex)
      : mode.path === 'block'
        ? // frame mode needs `hasIndex === false`; the rows never read it
          (items, fn, key, ctx, inverseFn, _hasIndex, block, blockValues) =>
            target(items, fn, key, ctx, inverseFn, true, block, blockValues)
        : (...args) => target(...args);
  g.$_each = each;
  g.$_eachSync = each;
}

function restoreGlobals(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.$_each = ORIGINAL.$_each;
  g.$_eachSync = ORIGINAL.$_eachSync;
}

// ---------------------------------------------------------------- the app
interface Item {
  id: number;
  label: string;
  n: boolean;
}

function makeItem(id: number, label: string): Item {
  const item: Item = { id, label, n: id % 2 === 0 };
  cellFor(item, 'label');
  return item;
}

const Badge = template('<span class="badge">{{@v}}{{yield}}</span>');

function defineRoot(source: string) {
  const compiled = template(source, { scope: { Badge } });
  class FuzzRoot extends Component {
    a = 'alpha';
    b = 0;
    flag = false;
    sel = 0;
    nil = null;
    items: Item[] = [];
    log: string[] = [];
    nextId = 1;
    constructor(args: any) {
      super(args);
      for (const key of ['a', 'b', 'flag', 'sel', 'items']) cellFor(this as any, key);
    }
    // `{{on}}` calls its handler as `($e, $n)` with `$n` undefined: the
    // event is not necessarily the last argument `fn` passes on
    hit = (site: string, ...rest: unknown[]) => {
      const isEvent = (x: unknown) => typeof (x as Event | null)?.type === 'string';
      const event = rest.find(isEvent) as Event | undefined;
      const id = rest.length > 0 && !isEvent(rest[0]) ? String(rest[0]) : '-';
      const current = event?.currentTarget as Element | null | undefined;
      this.log.push(
        `${site}:${id}:${event?.type}:${current?.getAttribute?.('data-hit') ?? String(current)}`,
      );
    };
    [$template] = compiled;
  }
  return FuzzRoot;
}
type FuzzRoot = InstanceType<ReturnType<typeof defineRoot>>;

function applyStep(root: FuzzRoot, step: Step, container: HTMLElement): void {
  const items = root.items;
  const at = (i: number) => (items.length === 0 ? -1 : i % items.length);
  switch (step.op) {
    case 'setA':
      root.a = step.value;
      break;
    case 'setB':
      root.b = step.value;
      break;
    case 'toggleFlag':
      root.flag = !root.flag;
      break;
    case 'select':
      root.sel = items.length === 0 ? 0 : items[at(step.at)].id;
      break;
    case 'push': {
      const next = items.slice();
      for (let i = 0; i < step.count; i++) {
        const id = root.nextId++;
        next.push(makeItem(id, `L${id}`));
      }
      root.items = next;
      break;
    }
    case 'remove':
      if (items.length > 0) root.items = items.filter((_, i) => i !== at(step.at));
      break;
    case 'swap':
      if (items.length > 1) {
        const next = items.slice();
        const i = at(step.i);
        const j = at(step.j);
        [next[i], next[j]] = [next[j], next[i]];
        root.items = next;
      }
      break;
    case 'reverse':
      root.items = items.slice().reverse();
      break;
    case 'replaceAll': {
      const next: Item[] = [];
      for (let i = 0; i < step.count; i++) {
        const id = root.nextId++;
        next.push(makeItem(id, `L${id}`));
      }
      root.items = next;
      break;
    }
    case 'clear':
      root.items = [];
      break;
    case 'relabel':
      if (items.length > 0) items[at(step.at)].label = step.word;
      break;
    case 'refSwap':
      // a new object under an existing key
      if (items.length > 0) {
        const i = at(step.at);
        const next = items.slice();
        next[i] = makeItem(items[i].id, `${items[i].label}*`);
        root.items = next;
      }
      break;
    case 'click': {
      const targets = container.querySelectorAll('[data-hit]');
      if (targets.length > 0) {
        (targets[step.at % targets.length] as HTMLElement).click();
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- DOM normalization
function normalize(node: Node): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (node.nodeType !== 1) return '';
  const el = node as Element;
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .sort()
    .join(' ');
  let inner = '';
  for (let c = el.firstChild; c !== null; c = c.nextSibling) inner += normalize(c);
  const tag = el.tagName.toLowerCase();
  return `<${tag}${attrs ? ' ' + attrs : ''}>${inner}</${tag}>`;
}

function registrySizes() {
  return {
    TREE: TREE.size,
    CHILD: CHILD.size,
    PARENT: PARENT.size,
    opsForTag: opsForTag.size,
    relatedTags: relatedTags.size,
  };
}

/** What a registry mismatch left behind (for the failure message). */
function leftovers(baseKeys: Set<number>): string[] {
  const out: string[] = [];
  for (const [id, subs] of relatedTags) {
    if (baseKeys.has(id)) continue;
    const names = [...subs].map((t) => (t as { _debugName?: string })._debugName ?? String((t as unknown as { fn: unknown }).fn).slice(0, 120));
    out.push(`relatedTags[${id}] = {${names.join(', ')}}`);
  }
  for (const [id, ops] of opsForTag) {
    if (!baseKeys.has(-id - 1)) out.push(`opsForTag[${id}]: ${ops.length} op(s)`);
  }
  return out;
}

function registryKeys(): Set<number> {
  const keys = new Set<number>(relatedTags.keys());
  for (const id of opsForTag.keys()) keys.add(-id - 1);
  return keys;
}

interface RunResult {
  snapshots: string[];
  log: string[];
  baseline: ReturnType<typeof registrySizes>;
  after: ReturnType<typeof registrySizes>;
  left: string[];
}

async function run(
  fixture: DOMFixture,
  source: string,
  tape: Step[],
  mode: Mode,
): Promise<RunResult> {
  installMode(mode);
  const Root = defineRoot(source);
  const parent = new Component({});
  (parent as any)[RENDERED_NODES_PROPERTY] = [];
  const baseline = registrySizes();
  const baseKeys = registryKeys();
  addToTree(fixture.root, parent);
  let root!: FuzzRoot;
  class Probe extends Root {
    constructor(args: any) {
      super(args);
      root = this as FuzzRoot;
    }
  }
  const rendered = $_c(Probe as any, $_args({}, false, $_edp as any), parent);
  renderElement(fixture.api, parent, fixture.container, rendered);
  await settle();
  const snapshots: string[] = [normalize(fixture.container)];
  for (const step of tape) {
    applyStep(root, step, fixture.container);
    await settle();
    snapshots.push(normalize(fixture.container));
  }
  destroyElementSync(parent, false, fixture.api);
  await settle();
  const after = registrySizes();
  return { snapshots, log: root.log.slice(), baseline, after, left: leftovers(baseKeys) };
}

describe('differential: {{#each}} paths render identically (seeded)', () => {
  let fixture: DOMFixture;

  beforeEach(() => {
    fixture = createDOMFixture();
    setupRuntimeTemplateGlobals();
  });

  afterEach(() => {
    restoreGlobals();
    fixture.cleanup();
  });

  for (const seed of seeds()) {
    test(`seed ${seed}`, async () => {
      const source = generateTemplate(seed);
      const tape = generateTape(seed, 14, process.env.GXT_FUZZ_REFSWAP === '1');
      const results: Array<[Mode, RunResult]> = [];
      for (const mode of MODES) {
        // a fresh container per mode; registries are global and shared
        fixture.container.innerHTML = '';
        results.push([mode, await run(fixture, source, tape, mode)]);
      }
      const [refMode, ref] = results[0];
      const context = `seed ${seed}\ntemplate: ${source}\ntape: ${JSON.stringify(tape)}`;
      // first step where any path disagrees: report every path's DOM there
      for (let step = 0; step < ref.snapshots.length; step++) {
        const differs = results.some(([, r]) => r.snapshots[step] !== ref.snapshots[step]);
        if (differs) {
          const what = step === 0 ? 'first render' : JSON.stringify(tape[step - 1]);
          const table = results
            .map(([m, r]) => `  ${modeName(m).padEnd(13)} ${r.snapshots[step]}`)
            .join('\n');
          expect.fail(`paths disagree after step ${step} (${what})\n${table}\n${context}`);
        }
      }
      for (const [mode, result] of results) {
        expect(result.log, `${modeName(mode)} vs ${modeName(refMode)} click log\n${context}`).toEqual(ref.log);
        expect(
          result.after,
          `${modeName(mode)} registries after teardown\n  ${result.left.join('\n  ')}\n${context}`,
        ).toEqual(
          result.baseline,
        );
      }
    });
  }

  test('known divergence: a new object under an existing key', async () => {
    const source =
      '<ul>{{#each this.items key="id" as |item|}}<li>{{item.label}}</li>{{/each}}</ul>';
    const tape: Step[] = [
      { op: 'push', count: 2 },
      { op: 'refSwap', at: 1 },
    ];
    const rendered: Record<string, string> = {};
    for (const mode of MODES) {
      fixture.container.innerHTML = '';
      const result = await run(fixture, source, tape, mode);
      rendered[modeName(mode)] = result.snapshots[2];
      expect(result.after).toEqual(result.baseline);
    }
    const stale = '<div><ul><li>L1</li><li>L2</li></ul></div>';
    const rebound = '<div><ul><li>L1</li><li>L2*</li></ul></div>';
    expect(rendered).toEqual({
      'plain/async': stale,
      'plain/sync': stale,
      'block/async': stale,
      'block/sync': stale,
      'frames/async': rebound,
      'frames/sync': rebound,
    });
  });
});
