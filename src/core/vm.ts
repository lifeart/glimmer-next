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
} from './reactive';
import { isFn } from './shared';

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

export function effect(cb: () => void, debugName?: string): () => void {
  const label = debugName ? `effect:${debugName}` : 'effect';
  const internalLabel = debugName ? `effect.internal:${debugName}` : 'effect.internal';
  const sourceTag = formula(cb, internalLabel); // we have binded tracking chain for tag
  let destructor: maybeDestructor;
  let isDestroyCalled = false;
  const tag = formula(() => {
    runEffectDestructor(destructor);
    destructor = undefined;
    return sourceTag.value;
  }, label);
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
  return () => {
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
}

/**
 * Evaluates an opcode in an isolated tracking context.
 *
 * Combines trackingTransaction + inNewTrackingFrame + executeOpcode inline
 * to avoid allocating 2 closures per opcode evaluation. The semantics are:
 * 1. Ensure we're in a rendering transaction
 * 2. Save and null the current tracker (isolation)
 * 3. Execute the opcode
 * 4. Restore tracker and rendering state
 */
export function evaluateOpcode(tag: AnyCell, op: tagOp) {
  const wasRendering = isRendering();
  const previousTracker = getTracker();
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

/**
 * Alias for evaluateOpcode - both functions now have identical behavior.
 * Kept for backwards compatibility.
 */
export const checkOpcode = evaluateOpcode;

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
