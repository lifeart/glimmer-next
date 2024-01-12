export default function optional(fn?: Function) {
  if (typeof fn === 'function') {
    return fn;
  } else {
    return () => {};
  }
}
