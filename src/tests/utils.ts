import { type ComponentReturnType, Component } from '@/core/component-class';
import { renderComponent, resetNodeCounter, createRoot, $_c, $_fin } from '@/core/dom';
import { runDestructors } from '@/core/destroy';
import { Root } from '@/core/root';
import { withRehydration } from '@/core/ssr/rehydration';
import { renderInBrowser } from '@/core/ssr/ssr';
import { addToTree, PARENT, RENDERED_NODES_PROPERTY, TREE } from '@/core/shared';
import { cleanupFastContext } from '@/core/context';
import { setResolveRender, flushRevalidation } from '@/core/runtime';
import { HOST_HOOKS } from '@/core/host-hooks';
import { tagsToRevalidate } from '@/core/reactive';

let ROOT: null | Root = null;

let $doc =
  typeof document !== 'undefined'
    ? document
    : (undefined as unknown as Document);
export function setDocument(newDocument: Document) {
  $doc = newDocument;
}
export function getDocument() {
  return $doc;
}

export function resetRoot() {
  ROOT = null;
}
export function setRoot(root: Root) {
  if (IS_DEV_MODE) {
    if (ROOT) {
      throw new Error('Root already exists');
    }
  }
  ROOT = root;
}
export function getRoot() {
  return ROOT;
}

export async function cleanupRender() {
  const rootIds: number[] = [];
  PARENT.forEach((ref, id) => {
    if (ref === null) {
      rootIds.push(id);
    }
  });
  const roots = rootIds.map((id) => TREE.get(id)!);
  for (const root of roots) {
    await Promise.all(runDestructors(root));
  }
  resetNodeCounter();
  resetRoot();
}

export function rehydrate(component: typeof Component, args: Record<string, unknown> = {}) {
  withRehydration(component, args, renderTarget());
}
export async function ssr(component: typeof Component) {
  resetNodeCounter();
  let root = createRoot();
  setRoot(root);
  const content = await renderInBrowser(component, {}, root);
  renderTarget().innerHTML = content;
  await Promise.all(runDestructors(root));
  resetNodeCounter();
  resetRoot();
}

export function renderTarget() {
  return getDocument().getElementById('ember-testing')!;
}

export function createTestComponent(component: ComponentReturnType, owner: Root): typeof Component {
  const debugName = `${QUnit.config.current.moduleName}::${QUnit.config.current.testName}`;

  class TestComponentContainer extends Component {
    [RENDERED_NODES_PROPERTY] = [];
    constructor() {
      // @ts-expect-error
      super(...arguments);
      // @ts-expect-error
      this.debugName = debugName;
    }
    // @ts-expect-error
    template(args: Record<string, unknown>) {
      addToTree(owner, this);
      return $_fin([$_c(component, {
        ...args,
        // @ts-expect-error
      }, this)], this);
    }
  }

  TestComponentContainer.prototype.toString = () => debugName;
  return TestComponentContainer as unknown as typeof Component;
}

export async function render(component: ComponentReturnType) {
  cleanupFastContext();
  const targetElement = getDocument().getElementById('ember-testing')!;
  await cleanupRender();
  if (targetElement.childNodes.length) {
    console.warn('testing container not empty, force cleanup');
    console.info(targetElement.innerHTML);
    targetElement.innerHTML = '';
  }
  const owner = createRoot();
  setRoot(owner);

  let renderResult = renderComponent(
    createTestComponent(component, owner),
    {
      element: targetElement,
      owner,
    }
  );
  await rerender();
  return renderResult;
}

/**
 * A test scheduler that applies cell writes only when the test says so.
 *
 * Installed through the `scheduleRevalidate` host hook (set directly, not via
 * `registerHostHooks`, whose host sentinel would switch list frame mode off):
 * a cell write only marks the UI dirty instead of queueing the microtask
 * flush.
 *   - `flush()` applies every pending write synchronously, re-running passes
 *     while a pass dirties more cells (`flushRevalidation`). No timer, no
 *     await: `value.update('x'); scheduler.flush(); assert…`.
 *   - `settled()` flushes, then lets async teardown run (the promise chains
 *     of an `{{#if}}` branch swap or an async list's row removal) and
 *     flushes again until nothing is pending. `rerender()` and `render()`
 *     use it while the scheduler is installed, so they stop relying on
 *     `rerender`'s 16 ms timeout fallback.
 * Work a test starts on a timer of its own (an animation that awaits a
 * `setTimeout`) is not tracked.
 */
export interface ManualScheduler {
  /** A cell was written since the last flush. */
  readonly pending: boolean;
  flush(): void;
  settled(): Promise<void>;
  uninstall(): void;
}

const MAX_FLUSH_PASSES = 100;
const MAX_SETTLE_ROUNDS = 50;
let MANUAL_SCHEDULER: ManualScheduler | null = null;

export function installManualScheduler(): ManualScheduler {
  if (MANUAL_SCHEDULER !== null) {
    throw new Error('installManualScheduler: a manual scheduler is already installed');
  }
  const previous = HOST_HOOKS.scheduleRevalidate;
  let pending = false;
  const flush = () => {
    pending = false;
    for (let pass = 0; tagsToRevalidate.size > 0; pass++) {
      if (pass === MAX_FLUSH_PASSES) {
        throw new Error(
          `manual scheduler: cells still dirty after ${MAX_FLUSH_PASSES} passes (a render writes what it reads)`,
        );
      }
      flushRevalidation();
    }
    pending = false;
  };
  const scheduler: ManualScheduler = {
    get pending() {
      return pending;
    },
    flush,
    async settled() {
      for (let round = 0; round < MAX_SETTLE_ROUNDS; round++) {
        flush();
        // async teardown runs on promise chains: one macrotask drains them
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!pending && tagsToRevalidate.size === 0) return;
      }
      throw new Error(`manual scheduler: not settled after ${MAX_SETTLE_ROUNDS} rounds`);
    },
    uninstall() {
      if (MANUAL_SCHEDULER !== scheduler) return;
      // nothing queued may outlive the scheduler: the default one only
      // schedules a flush on the NEXT write
      flush();
      MANUAL_SCHEDULER = null;
      HOST_HOOKS.scheduleRevalidate = previous;
    },
  };
  HOST_HOOKS.scheduleRevalidate = () => {
    pending = true;
  };
  MANUAL_SCHEDULER = scheduler;
  return scheduler;
}

/** Settle the installed manual scheduler (see installManualScheduler). */
export function settled(): Promise<void> {
  if (MANUAL_SCHEDULER === null) {
    throw new Error('settled(): no manual scheduler is installed');
  }
  return MANUAL_SCHEDULER.settled();
}

export async function rerender(timeout = 16) {
  if (MANUAL_SCHEDULER !== null) {
    return MANUAL_SCHEDULER.settled();
  }
  // First, wait for any pending microtask (DOM sync) to complete
  await new Promise<void>((resolve) => {
    // Set up a callback to be called when DOM sync completes
    let resolved = false;
    setResolveRender(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    });
    // Also set a timeout as a fallback in case no revalidation was scheduled
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    }, timeout);
  });
  // Give a small additional delay for any final DOM operations
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function find<T extends Element>(selector: string): T {
  const element = getDocument()
    .getElementById('ember-testing')!
    .querySelector(selector);
  return element as T;
}

export function findAll<T extends Element>(selector: string): NodeListOf<T> {
  const element = getDocument()
    .getElementById('ember-testing')!
    .querySelectorAll(selector);
  return element as NodeListOf<T>;
}


export async function click(selector: string) {
  const element = find(selector);
  if (!element) {
    throw new Error(
      `Unable to find DOM element matching selector: ${selector}`,
    );
  }
  const event = new MouseEvent('click', {
    view: window,
    bubbles: true,
    cancelable: true,
  });
  element!.dispatchEvent(event);
  await rerender();
}

export function step(message: string) {
  QUnit.assert.pushResult({
    message: `[Step] ${message}`,
    result: true,
    expected: true,
    actual: true,
  });
}
