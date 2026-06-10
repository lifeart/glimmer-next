/**
 * Shared helpers for the list perf harness and its derived benches/tests
 * (list-perf.bench.test.ts, list-perf.recycle.bench.test.ts,
 * control-flow/list.recycle.test.ts).
 *
 * The perf-harness contract is "identical methodology across variants" —
 * timing, item shape and the mount ritual live HERE so the files can't drift
 * apart silently. Variants differ only in their template string and scenario
 * list.
 */
import { Component } from '../component';
import { RENDERED_NODES_PROPERTY, addToTree } from '../shared';
import { $_c, $_args, $_edp } from '../dom';
import { cellFor } from '../reactive';
import { renderElement } from '../render-core';
import {
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../../plugins/runtime-compiler';
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
