import {
  $__hash,
  $__fn,
  $__array,
} from '@/utils/helpers/index';
import { EmberFunctionalHelpers } from './ember__component__helper';

// Register built-in helpers as Ember functional helpers
// so they go through helperManager and receive (args, hash) correctly
EmberFunctionalHelpers.add($__hash);
EmberFunctionalHelpers.add($__fn);
EmberFunctionalHelpers.add($__array);

export { $__hash as hash, $__fn as fn, $__array as array };

export function get(obj: Record<string, any>, key: string) {
  return key.split('.').reduce((acc, key) => {
    return acc[key];
  }, obj);
}
export function concat(...args: any[]) {
  args.pop();
  return args.join('');
}
