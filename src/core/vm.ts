import {
  opsForTag,
  type AnyCell,
  type tagOp,
  markOpcodeAsync,
  setIsRendering,
  isRendering,
  formula,
  opsFor,
  inNewTrackingFrame,
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

function trackingTransaction(cb: () => void) {
  if (isRendering()) {
    cb();
  } else {
    setIsRendering(true);
    try {
      cb();
    } finally {
      setIsRendering(false);
    }
  }
}

const executeOpcode = (tag: AnyCell, op: tagOp) => {
  const value = op(tag.value) as unknown as void | Promise<void>;
  if (value !== undefined) {
    // console.info(`Adding Async Updating Opcode for ${tag._debugName}`);
    markOpcodeAsync(op);
  }
};

/**
 * Evaluates an opcode in an isolated tracking context.
 *
 * Uses `inNewTrackingFrame` to ensure that formulas created during opcode
 * evaluation get their own independent dependency tracking. Without this,
 * nested formulas (e.g., reactive attribute bindings created inside slot
 * content wrapped by resolveRenderable) would have their dependencies merged
 * into the parent formula's tracking, causing reactive updates to fail.
 */
export function evaluateOpcode(tag: AnyCell, op: tagOp) {
  trackingTransaction(() => {
    inNewTrackingFrame(() => {
      executeOpcode(tag, op);
    });
  });
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
    // console.info(`Removing Updating Opcode for ${tag._debugName}`, tag);
    const index = ops.indexOf(op);
    if (index > -1) {
      ops.splice(index, 1);
    }
    if (ops.length === 0) {
      opsForTag.delete(tag.id);
      releaseOpArray(ops); // Return to pool for reuse
      if ('destroy' in tag) {
        tag.destroy();
      }
    }
  };
}
