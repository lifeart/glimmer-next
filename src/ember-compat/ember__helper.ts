export {
  $__hash as hash,
  $__fn as fn,
  $__array as array,
} from '@/utils/helpers/index';
export function get(obj: Record<string, any>, key: string) {
  return key.split('.').reduce((acc, key) => {
    return acc[key];
  }, obj);
}
export function concat(...args: any[]) {
  args.pop();
  return args.join('');
}
