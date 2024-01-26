import {
  opsForTag,
  type AnyCell,
  type tagOp,
  asyncOpcodes,
  setIsRendering,
  isRendering,
  formula,
  opsFor,
  inNewTrackingFrame,
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

export function effect(cb: () => void): () => void {
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
    cb();
    setIsRendering(false);
  }
}

const executeOpcode = (tag: AnyCell, op: tagOp) => {
  const value = op(tag.value) as unknown as void | Promise<void>;
  if (value !== undefined) {
    // console.info(`Adding Async Updating Opcode for ${tag._debugName}`);
    asyncOpcodes.add(op);
  }
};

export function checkOpcode(tag: AnyCell, op: tagOp) {
  trackingTransaction(() => {
    inNewTrackingFrame(() => {
      executeOpcode(tag, op);
    });
  });
}
export function evaluateOpcode(tag: AnyCell, op: tagOp) {
  trackingTransaction(() => {
    executeOpcode(tag, op);
  });
}

export function opcodeFor(tag: AnyCell, op: tagOp) {
  const wrappedOpcode = (value: any) => {
    globalThis.activeTag = op;
    try {
      return op(value);
    } finally {
    }
  }
  evaluateOpcode(tag, wrappedOpcode);
  const ops = opsFor(tag)!;
  ops.push(wrappedOpcode);
  return () => {
    // console.info(`Removing Updating Opcode for ${tag._debugName}`, tag);
    const index = ops.indexOf(wrappedOpcode);
    if (index > -1) {
      ops.splice(index, 1);
    }
    if (ops.length === 0) {
      opsForTag.delete(tag);
      if ('destroy' in tag) {
        tag.destroy();
      }
    }
  };
}
