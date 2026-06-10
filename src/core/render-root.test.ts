import {
  describe,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { Window } from 'happy-dom';
import { withRenderRoot, createRenderRootState } from './render-root';
import {
  getNodeCounter,
  setNodeCounter,
  resetNodeCounter,
  renderComponent,
  Root,
} from './dom';
import { snapshotParentContext, restoreParentContext } from './tracking';
import {
  snapshotRenderingContext,
  restoreRenderingContext,
  cleanupFastContext,
} from './context';
import { TREE, PARENT, CHILD, $template } from './shared';
import { Component } from './component';
import {
  template,
  setupGlobalScope,
  GXT_RUNTIME_SYMBOLS,
} from '../../plugins/runtime-compiler';

describe('RenderRootState / withRenderRoot (synchronous state isolation)', () => {
  afterEach(() => {
    // Leave the ambient module-globals in a cold-load state between tests.
    setNodeCounter(0);
    restoreParentContext([]);
    cleanupFastContext();
  });

  test('createRenderRootState() returns a cold-load state', () => {
    expect(createRenderRootState()).toEqual({
      nodeCounter: 0,
      parentContextStack: [],
      renderingContext: { fast: null, root: null },
    });
    // Each call is a fresh object (no shared mutable references).
    const a = createRenderRootState();
    const b = createRenderRootState();
    expect(a).not.toBe(b);
    expect(a.parentContextStack).not.toBe(b.parentContextStack);
    expect(a.renderingContext).not.toBe(b.renderingContext);
  });

  test('seeds the counter from state, restores the outer counter, checkpoints the mutation', () => {
    setNodeCounter(7); // outer ambient counter
    const state = createRenderRootState();

    withRenderRoot(state, () => {
      // swapped in: counter starts at state.nodeCounter (0)
      expect(getNodeCounter()).toBe(0);
      setNodeCounter(123); // mint some nodes
    });

    // outer restored
    expect(getNodeCounter()).toBe(7);
    // this root's mutated counter was checkpointed onto the state
    expect(state.nodeCounter).toBe(123);

    // re-entering the SAME state resumes exactly where it left off
    withRenderRoot(state, () => {
      expect(getNodeCounter()).toBe(123);
    });
    expect(getNodeCounter()).toBe(7);
  });

  test('rendering-context (fast/root) is saved and restored as a pair across the boundary', () => {
    // Establish an ambient (outer) rendering context.
    restoreRenderingContext({ fast: 'OUTER_FAST', root: 'OUTER_ROOT' });
    const state = createRenderRootState();

    withRenderRoot(state, () => {
      // swapped in: createRenderRootState defaults both to null (≡ cold load)
      expect(snapshotRenderingContext()).toEqual({ fast: null, root: null });
      restoreRenderingContext({ fast: 'INNER_FAST', root: 'INNER_ROOT' });
    });

    // outer pair restored exactly
    expect(snapshotRenderingContext()).toEqual({
      fast: 'OUTER_FAST',
      root: 'OUTER_ROOT',
    });
    // inner mutation checkpointed onto the state
    expect(state.renderingContext).toEqual({
      fast: 'INNER_FAST',
      root: 'INNER_ROOT',
    });
  });

  test('restores the outer state when fn throws (error-path safety)', () => {
    setNodeCounter(42);
    restoreParentContext([7, 8]);
    restoreRenderingContext({ fast: 'OUTER', root: 'OUTER' });
    const outerParent = snapshotParentContext();
    const state = createRenderRootState();

    expect(() =>
      withRenderRoot(state, () => {
        setNodeCounter(99);
        restoreParentContext([1, 2, 3]);
        restoreRenderingContext({ fast: 'INNER', root: 'INNER' });
        throw new Error('boom');
      }),
    ).toThrow('boom');

    // every outer global restored, even on the throw path
    expect(getNodeCounter()).toBe(42);
    expect(snapshotParentContext()).toEqual(outerParent);
    expect(snapshotRenderingContext()).toEqual({ fast: 'OUTER', root: 'OUTER' });
    // pre-throw mutations were still checkpointed
    expect(state.nodeCounter).toBe(99);
    expect(state.parentContextStack).toEqual([1, 2, 3]);
  });

  test('parent-context stack is isolated across the boundary', () => {
    restoreParentContext([10, 20]); // outer stack has entries
    const outer = snapshotParentContext();
    const state = createRenderRootState();

    withRenderRoot(state, () => {
      // swapped in: the stack is empty (createRenderRootState → [])
      expect(snapshotParentContext()).toEqual([]);
      restoreParentContext([1, 2, 3]); // mutate the stack inside the root
    });

    // outer stack restored; the dev-mode window.parentContext reference (the
    // `const` binding) stays valid because restore mutates in place.
    expect(snapshotParentContext()).toEqual(outer);
    // inner stack checkpointed
    expect(state.parentContextStack).toEqual([1, 2, 3]);
  });
});

describe('withRenderRoot — two sequential isolated roots produce identical node-id sequences', () => {
  let window: Window;
  let document: Document;

  beforeAll(() => {
    // Runtime-compiled templates need the global GXT symbol table.
    setupGlobalScope();
    const g = globalThis as any;
    Object.entries(GXT_RUNTIME_SYMBOLS).forEach(([name, value]) => {
      g[name] = value;
    });
  });

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    resetNodeCounter();
    window.close();
  });

  // Synchronous render-to-string (mirrors ssr.ts `renderInBrowser`, which has no
  // `await` before it mints nodes — so it is safe inside the synchronous swap).
  function renderToHTMLSync(
    Comp: typeof Component<any>,
    args: Record<string, unknown>,
  ): string {
    const root = new Root(document);
    const host = document.createElement('div');
    renderComponent(Comp, { args, element: host, owner: root });
    return host.innerHTML;
  }

  function nodeIds(html: string): string[] {
    return [...html.matchAll(/data-node-id="(\d+)"/g)].map((m) => m[1]!);
  }

  test('identical sequences despite a corrupted ambient counter between roots', () => {
    const tmpl = '<div class="a"><span>hi</span><i>x</i></div>';
    class App extends Component {
      [$template] = template(tmpl);
    }

    const stateA = createRenderRootState();
    const htmlA = withRenderRoot(stateA, () => renderToHTMLSync(App, {}));
    const idsA = nodeIds(htmlA);

    // Corrupt the ambient counter to a wildly different value: a non-isolated
    // second render would continue from here and produce a DIFFERENT sequence.
    setNodeCounter(9999);

    const stateB = createRenderRootState();
    const htmlB = withRenderRoot(stateB, () => renderToHTMLSync(App, {}));
    const idsB = nodeIds(htmlB);

    // Under SSR (IN_SSR_ENV), every element carries a data-node-id marker.
    expect(idsA.length).toBeGreaterThan(0);
    // The two isolated roots minted the SAME node-id sequence (both started at 0).
    expect(idsB).toEqual(idsA);
    expect(htmlB).toBe(htmlA);
    // The corrupted ambient counter was restored after the second root exited.
    expect(getNodeCounter()).toBe(9999);
  });
});
