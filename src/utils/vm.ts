import { opsForTag, type AnyCell, type tagOp, asyncOpcodes, setIsRendering, isRendering } from './reactive';

// this function creates opcode for a tag, it's called when we need to update DOM for a specific tag
export function bindUpdatingOpcode(tag: AnyCell, op: tagOp) {
  // we set initial ops in the constructor
  const ops = opsForTag.get(tag)!;
  // apply the op to the current value
  if (isRendering()) {
    const value = op(tag.value) as unknown as void | Promise<void>;
    if (value instanceof Promise) {
      // console.info(`Adding Async Updating Opcode for ${tag._debugName}`);
      asyncOpcodes.add(op);
    }
  } else {
    setIsRendering(true);
    const value = op(tag.value)  as unknown as void | Promise<void>;
    if (value instanceof Promise) {
      // console.info(`Adding Async Updating Opcode for ${tag._debugName}`);
      asyncOpcodes.add(op);
    }
    setIsRendering(false);
  }
  ops.push(op);
  return () => {
    // console.info(`Removing Updating Opcode for ${tag._debugName}`);
    const index = ops.indexOf(op);
    if (index > -1) {
      ops.splice(index, 1);
    }
  };
}
