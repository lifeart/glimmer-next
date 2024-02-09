import { EmberFunctionalHelpers } from '../../ember-compat/ember__component__helper';

export function needManagerForHelper(helper: any) {
  return EmberFunctionalHelpers.has(helper) || helper.helperType === 'ember';
}

export function canCarryHelper(helper: any) {
  return needManagerForHelper(helper);
}

export function carryHelper(
  helperFn: any,
  params: any,
  hash: any,
  $_maybeHelper: (
    value: any,
    args: any[],
    _hash: Record<string, unknown>,
  ) => any,
) {
  if (EmberFunctionalHelpers.has(helperFn)) {
    function wrappedHelper(_params: any, _hash: any) {
      console.log('callingWrapperHelper', {
        params,
        _params,
        hash,
        _hash,
      });
      return $_maybeHelper(helperFn, [...params, ..._params], {
        ...hash,
        ..._hash,
      });
    }
    EmberFunctionalHelpers.add(wrappedHelper);
    return wrappedHelper;
  } else if (helperFn.helperType) {
    // TODO: implement class based helpers carry?
  }
}

export function helperManager(
  value: any,
  args: any[],
  hash: Record<string, unknown>,
) {
  if (EmberFunctionalHelpers.has(value)) {
    return value(args, hash);
  } else if (value.helperType === 'ember') {
    const helper = new value();
    return helper.compute.call(helper, args, hash);
  }
}
