// @ts-expect-error unused args
export function action(klass, field, descriptor) {
  // console.log('action', klass, field, descriptor);
  // if (field === 'hideToolTip') {
  // debugger;
  // }
  // @ts-expect-error
  let bindedValue = null;
  return {
    get() {
      // @ts-expect-error
      if (!bindedValue) {
        bindedValue = descriptor.value.bind(this);
      }
      return bindedValue;
    },
  };
}
