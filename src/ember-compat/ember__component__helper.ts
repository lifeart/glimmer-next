export const EmberFunctionalHelpers = new Set();

export function helper(
  fn: (args: unknown[], hash: Record<string, unknown>) => unknown,
) {
  EmberFunctionalHelpers.add(fn);
  return fn;
}
export default class Helper {
  compute() {
    // noop;
  }
  static helperType = 'ember';
}
