import {
  opsForTag,
  type AnyCell,
  type tagOp,
  markOpcodeAsync,
  setIsRendering,
  isRendering,
  formula,
  opsFor,
  getTracker,
  setTracker,
  releaseOpArray,
  MergedCell,
  type Cell,
} from './reactive';
import { isFn } from './shared';
import { isNativeRuntime } from './native-content';
import { registerDestructor } from './glimmer/destroyable';

type maybeDestructor = undefined | (() => void);
type maybePromise = undefined | Promise<void>;

function runEffectDestructor(destructor: maybeDestructor) {
  if (destructor !== undefined) {
    const result = destructor() as unknown as maybePromise;
    if (IS_DEV_MODE) {
      if (result && result instanceof Promise) {
        throw new Error(
          `Effect destructor can't be a promise: ${destructor.toString()}`,
        );
      }
    }
  }
}

export function effect(cb: () => void, owner?: object): () => void {
  const sourceTag = formula(cb, 'effect.internal'); // we have binded tracking chain for tag
  let destructor: maybeDestructor;
  let isDestroyCalled = false;
  const tag = formula(() => {
    runEffectDestructor(destructor);
    destructor = undefined;
    return sourceTag.value;
  }, 'effect');
  const destroyOpcode = opcodeFor(tag, (value: unknown) => {
    if (IS_DEV_MODE) {
      if (value instanceof Promise) {
        throw new Error(`Effect can't be a promise: ${cb.toString()}`);
      }
    }
    if (isFn(value)) {
      destructor = value as unknown as () => void;
    }
    // tag is computed here;
  });
  const cleanup = () => {
    if (isDestroyCalled) {
      return;
    }
    isDestroyCalled = true;
    runEffectDestructor(destructor);
    // remove sourceTag and tag from tracking chain
    sourceTag.destroy();
    tag.destroy();
    destroyOpcode();
  };
  if (owner !== undefined) {
    registerDestructor(owner, cleanup);
  }
  return cleanup;
}

/**
 * Ember native runtime (Glimmer parity): the tracking frame the current render
 * runs in. Glimmer consumes every reference a render reads into the frame that
 * is current when the render starts — a `renderComponent` called inside a
 * `@cached` getter (or a helper) makes that getter depend on everything the
 * render read. gxt evaluates each binding in an isolated frame (its own
 * formula tracker), so under the native runtime a binding evaluated while a
 * tracker is active forwards its dependencies to that tracker, and the frame
 * stays the render's frame for the nested blocks / components the binding's
 * opcode renders (which gxt runs with no tracker). `null` everywhere else —
 * standalone gxt and the Ember compat bridge never set it.
 */
let renderFrame: Set<Cell> | null = null;

/**
 * Evaluates an opcode in an isolated tracking context.
 *
 * Combines trackingTransaction + inNewTrackingFrame + executeOpcode inline
 * to avoid allocating 2 closures per opcode evaluation. The semantics are:
 * 1. Ensure we're in a rendering transaction
 * 2. Save and null the current tracker (isolation)
 * 3. Execute the opcode
 * 4. Restore tracker and rendering state
 * Under the native runtime, inside a render frame (see `renderFrame`), the
 * tag's dependencies are then added to that frame.
 */
export function evaluateOpcode(tag: AnyCell, op: tagOp) {
  const previousTracker = getTracker();
  if (renderFrame !== null || (previousTracker !== null && isNativeRuntime())) {
    const frame = previousTracker ?? renderFrame!;
    inRenderFrame(frame, () => evaluateIsolated(tag, op, previousTracker));
    if (tag instanceof MergedCell) {
      tag.relatedCells?.forEach((cell) => frame.add(cell));
    } else {
      frame.add(tag as Cell);
    }
    return;
  }
  evaluateIsolated(tag, op, previousTracker);
}

function evaluateIsolated(
  tag: AnyCell,
  op: tagOp,
  previousTracker: Set<Cell> | null,
) {
  const wasRendering = isRendering();
  if (!wasRendering) {
    setIsRendering(true);
  }
  setTracker(null);
  try {
    if (ASYNC_COMPILE_TRANSFORMS) {
      const value = op(tag.value) as unknown as void | Promise<void>;
      if (value !== undefined) {
        markOpcodeAsync(op);
      }
    } else {
      op(tag.value);
    }
  } finally {
    setTracker(previousTracker);
    if (!wasRendering) {
      setIsRendering(false);
    }
  }
}

function applyIsolated(
  op: tagOp,
  value: unknown,
  previousTracker: Set<Cell> | null,
) {
  const wasRendering = isRendering();
  if (!wasRendering) {
    setIsRendering(true);
  }
  setTracker(null);
  try {
    op(value);
  } finally {
    setTracker(previousTracker);
    if (!wasRendering) {
      setIsRendering(false);
    }
  }
}

function inRenderFrame(frame: Set<Cell>, fn: () => void) {
  const previousFrame = renderFrame;
  renderFrame = frame;
  try {
    fn();
  } finally {
    renderFrame = previousFrame;
  }
}

/**
 * Alias for evaluateOpcode - both functions now have identical behavior.
 * Kept for backwards compatibility.
 */
export const checkOpcode = evaluateOpcode;

/**
 * `opcodeFor` for a binding whose CURRENT value was just computed by a
 * `checkOpcode` read of the same tag (which also subscribed the tag to its
 * cells): applies `op` to that value in the same frame `evaluateOpcode` uses
 * (rendering, no tracker) instead of re-reading the tag, then registers `op`
 * for updates. Used by the EMBER_NATIVE dynamic-content binding
 * (native-content.ts), where the second create-time read would run a
 * side-effecting getter twice (Glimmer reads once).
 */
export function opcodeForValue(tag: AnyCell, op: tagOp, value: unknown) {
  const previousTracker = getTracker();
  if (renderFrame !== null || (previousTracker !== null && isNativeRuntime())) {
    // the `checkOpcode` read already forwarded the tag's dependencies; what
    // `op` renders (a content unit) still belongs to the render frame
    inRenderFrame(previousTracker ?? renderFrame!, () =>
      applyIsolated(op, value, previousTracker),
    );
  } else {
    applyIsolated(op, value, previousTracker);
  }
  const ops = opsFor(tag)!;
  ops.push(op);
  return () => {
    const index = ops.indexOf(op);
    if (index > -1) {
      ops.splice(index, 1);
    }
    if (ops.length === 0) {
      opsForTag.delete(tag.id);
      releaseOpArray(ops);
      if ('destroy' in tag) {
        tag.destroy();
      }
    }
  };
}

export function opcodeFor(tag: AnyCell, op: tagOp) {
  evaluateOpcode(tag, op);
  const ops = opsFor(tag)!;
  ops.push(op);
  return () => {
    const index = ops.indexOf(op);
    if (index > -1) {
      ops.splice(index, 1);
    }
    if (ops.length === 0) {
      opsForTag.delete(tag.id);
      releaseOpArray(ops);
      if ('destroy' in tag) {
        tag.destroy();
      }
    }
  };
}
