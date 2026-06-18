/**
 * Shared helpers for the list perf harness and its derived benches/tests
 * (list-perf.bench.test.ts, list-perf.recycle.bench.test.ts,
 * control-flow/list.recycle.test.ts).
 *
 * The perf-harness contract is "identical methodology across variants" —
 * timing, item shape, the root component and the mount ritual live HERE so
 * the files can't drift apart silently. Variants differ only in the each key
 * and their scenario list.
 */
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree, $template } from '../shared';
import { $_c, $_args, $_edp } from '../dom';
import { cellFor } from '../reactive';
import { renderElement } from '../render-core';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../../plugins/runtime-compiler';
// The recycle entry points ($_eachRecycled / $_eachSyncRecycled) are no longer
// part of the runtime compiler's default global symbol set — they live in the
// tree-shakable '@lifeart/gxt/recycle' entry. The recycling harness/tests
// (key="@recycle") opt them onto globalThis via registerRecycleRuntime().
import { registerRecycleRuntime } from '../recycle';
import type { DOMFixture } from './index';

export interface HarnessItem {
  id: number;
  label: string;
}

let nextItemId = 1;

/**
 * Build benchmark items. Each gets a cell-backed `label` accessor
 * (replicating the Krausest Row's `cellFor(item,'label')` getter) so
 * `item.label = x` routes through `Cell.update`.
 */
export function buildItems(count: number, labelFor?: (i: number) => string): HarnessItem[] {
  const data: HarnessItem[] = [];
  for (let i = 0; i < count; i++) {
    const id = nextItemId++;
    const item: HarnessItem = {
      id,
      label: labelFor ? labelFor(i) : `item ${id} body`,
    };
    cellFor(item, 'label');
    data.push(item);
  }
  return data;
}

/**
 * The Krausest-shaped bench root: one static-ish <tr> per item, a reactive
 * text binding (per-item label cell) and two bindings on the shared
 * `_selected` cell (the select fan-out path). `eachKey` is the only variant
 * knob — `"id"` for the keyed harness, `"@recycle"` for the recycling one.
 */
export function defineBenchRoot(eachKey: string): new (args: any) => Component<any> & {
  _items: HarnessItem[];
  _selected: number;
  readonly items: HarnessItem[];
} {
  const LIST_TEMPLATE = `
    <table><tbody>
      {{#each this.items key="${eachKey}" as |item|}}
        <tr class={{this.rowClass item.id}}>
          <td>{{item.id}}</td>
          <td><a class={{this.rowClass item.id}}>{{item.label}}</a></td>
          <td><span>x</span></td>
        </tr>
      {{/each}}
    </tbody></table>
  `;
  class BenchRoot extends Component {
    _items: HarnessItem[] = [];
    _selected = 0;
    constructor(args: any) {
      super(args);
      cellFor(this as any, '_items');
      cellFor(this as any, '_selected');
    }
    get items() {
      return this._items;
    }
    rowClass = (id: number) => (this._selected === id ? 'danger' : '');
    [$template] = template(LIST_TEMPLATE);
  }
  return BenchRoot as any;
}

/** Drain the microtask-scheduled syncDom. */
export const settle = () => new Promise<void>((r) => setTimeout(r, 0));

export async function timed(fn: () => void | Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  await settle();
  return performance.now() - start;
}

export const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * Install the runtime-compiler globals. Call from beforeEach (after
 * createDOMFixture) — `template()`-compiled classes resolve `$_tag` & co.
 * from globalThis at render time.
 */
export function setupRuntimeTemplateGlobals(): void {
  setupGlobalScope();
  const g = globalThis as Record<string, unknown>;
  Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
    g[name] = value;
  });
  // key="@recycle" rows resolve $_eachRecycled / $_eachSyncRecycled from
  // globalThis at render time; install them from the dedicated recycle entry.
  registerRecycleRuntime();
}

/**
 * Mount a `template()`-based root component into the fixture container and
 * return the instance. Encapsulates the instance-capture trick: `$_c` returns
 * the render output, not the instance, so we capture `this` via a subclass.
 */
export function mountRoot<T extends Component<any>>(
  fixture: DOMFixture,
  RootClass: new (args: any) => T,
): T {
  const parentComponent = new Component({});
  (parentComponent as any)[RENDERED_NODES_PROPERTY] = [];
  addToTree(fixture.root, parentComponent);
  let instance!: T;
  class Probe extends (RootClass as new (args: any) => Component<any>) {
    constructor(args: any) {
      super(args);
      instance = this as unknown as T;
    }
  }
  const rendered = $_c(
    Probe as any,
    $_args({}, false, $_edp as any),
    parentComponent,
  );
  renderElement(fixture.api, parentComponent, fixture.container, rendered);
  return instance;
}
