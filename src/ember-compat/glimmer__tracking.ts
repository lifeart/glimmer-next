export { tracked } from '@lifeart/gxt';
const symbolEmpty = Symbol('empty');

// let cnt = 0;
export function cached(
  // @ts-expect-error unused
  target: any,
  // @ts-expect-error unused
  key: string,
  descriptor: PropertyDescriptor,
) {
  let oldValue = symbolEmpty;
  return {
    get() {
      // cnt++;
      // console.log('cached-access', target, key, descriptor, oldValue);
      if (oldValue === symbolEmpty) {
        oldValue = descriptor.get!.call(this);
        return oldValue;
      } else {
        return oldValue;
      }
    },
  };
}
