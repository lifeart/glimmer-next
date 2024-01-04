import { opsForTag, type AnyCell, type tagOp, asyncOpcodes, setIsRendering, isRendering, formula, opsFor } from './reactive';

type maybeDestructor = undefined | (() => void);
type maybePromise = undefined | Promise<void>;

function runEffectDestructor(destructor: maybeDestructor) {
  if (destructor !== undefined) {
    const result = destructor() as unknown as maybePromise;
    if (import.meta.env.DEV) {
      if (result && result instanceof Promise) {
        throw new Error(`Effect destructor can't be a promise: ${destructor.toString()}`);
      }
    }
  }
}

export function effect(cb: () => void): () => void {
  const sourceTag = formula(cb); // we have binded tracking chain for tag
  let destructor: maybeDestructor;
  let isDestroyCalled = false;
  const tag = formula(() => {
    runEffectDestructor(destructor);
    destructor = undefined;
    return sourceTag.value;
  }, 'effect');
  const destroyOpcode = bindUpdatingOpcode(tag, (value: unknown) => {
    if (import.meta.env.DEV) {
      if (value instanceof Promise) {
        throw new Error(`Effect can't be a promise: ${cb.toString()}`);
      }
    }
    if (typeof value === 'function') {
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

// this function creates opcode for a tag, it's called when we need to update DOM for a specific tag
export function bindUpdatingOpcode(tag: AnyCell, op: tagOp) {
  // we set initial ops in the constructor
  const ops = opsFor(tag)!;
  // apply the op to the current value
  if (isRendering()) {
    const value = op(tag.value) as unknown as void | Promise<void>;
    if (value !== undefined) {
      // console.info(`Adding Async Updating Opcode for ${tag._debugName}`);
      asyncOpcodes.add(op);
    }
  } else {
    setIsRendering(true);
    const value = op(tag.value)  as unknown as void | Promise<void>;
    if (value !== undefined) {
      // console.info(`Adding Async Updating Opcode for ${tag._debugName}`);
      asyncOpcodes.add(op);
    }
    setIsRendering(false);
  }
  ops.push(op);
  return () => {
    // console.info(`Removing Updating Opcode for ${tag._debugName}`, tag);
    const index = ops.indexOf(op);
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
