// @ts-expect-error
export function inject(klass: any, key: string, descriptor: any) {
  console.log('inject', ...arguments);
  return {
    ...descriptor,
    initializer() {
      return {
        getConfig(key: string) {
          console.log('getConfig', key);
          return false;
        },
      };
    },
  };
}
export const service = inject;
