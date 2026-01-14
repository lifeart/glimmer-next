import { EmberFunctionalModifiers } from '../../ember-compat/ember-modifier';
import { modifierManagers } from '../../ember-compat/ember__modifier';
import { runDestructors } from '../component';
import { Destructors } from '../glimmer/destroyable';
import { formula } from '../reactive';
import { isFn } from '../shared';
import { opcodeFor } from '../vm';

type Fn = () => unknown;

export function needManagerForModifier(modifier: any) {
  return (
    modifierManagers.has(modifier) ||
    EmberFunctionalModifiers.has(modifier) ||
    'emberModifier' in modifier
  );
}

export function canCarryModifier(modifier: any) {
  return needManagerForModifier(modifier);
}

export function carryModifier(
  modifierFn: any,
  params: any,
  hash: any,
  $_maybeModifier: (
    modifier: any,
    element: HTMLElement,
    props: any[],
    hashArgs: Record<string, unknown>,
  ) => any,
) {
  if (EmberFunctionalModifiers.has(modifierFn)) {
    function wrappedModifier(node: any, _params: any, _hash: any) {
      console.log('callingWrapperModifier', {
        params,
        _params,
        hash,
        _hash,
      });
      return $_maybeModifier(modifierFn, node, [...params, ..._params], {
        ...hash,
        ..._hash,
      });
    }
    EmberFunctionalModifiers.add(wrappedModifier);
    return wrappedModifier;
  } else {
    if (modifierManagers.has(modifierFn)) {
      let manager = modifierManagers.get(modifierFn);
      const state = {};
      if (isFn(manager)) {
        manager = manager();
      }
      console.log(manager);
      // debugger;
      return (
        element: HTMLElement,
        args: any[] = [],
        hash: Record<string, unknown> = {},
      ) => {
        return manager.installModifier(state, element, {
          positional: args,
          named: hash,
        });
      };
    } else if (modifierFn.emberModifier) {
      class Modifier extends modifierFn {
        modify(
          element: Fn,
          named: Record<string, unknown> = {},
          positional: any[] = [],
        ) {
          super.modify(element, { ...hash, ...named }, [
            ...params,
            ...positional,
          ]);
        }
      }
      return Modifier;
    } else {
      return function wrappedModifier(node: HTMLElement, ...args: unknown[]) {
        return modifierFn(node, ...[...params, ...args]);
      };
    }
  }
}

export function modifierManager(
  modifier: any,
  element: HTMLElement,
  props: any[],
  hashArgs: Record<string, unknown>,
) {
  if (modifierManagers.has(modifier)) {
    debugger;
  }
  if ('emberModifier' in modifier) {
    const instance = new modifier();
    instance.modify = instance.modify.bind(instance);
    const destructors: Destructors = [];
    console.log('running class-based  modifier');
    requestAnimationFrame(() => {
      const f = formula(() => {
        instance.modify(element, props, hashArgs);
      }, 'class-based modifier');
      destructors.push(
        opcodeFor(f, () => {
          console.log('opcode executed for modifier');
        }),
      );
    });
    return () => {
      destructors.forEach((fn: () => void) => fn());
      console.log('destroing class-based modifier');
      if ('willDestroy' in instance) {
        instance.willDestroy();
      }
      runDestructors(instance);
    };
  } else {
    // console.log(modifier);
    if (EmberFunctionalModifiers.has(modifier)) {
      console.log('ember-functional-modifier', props, hashArgs);
      const args = hashArgs;
      const newArgs = {};
      Object.keys(args).forEach((key) => {
        Object.defineProperty(newArgs, key, {
          enumerable: true,
          get() {
            if (typeof args[key] === 'function') {
              return (args[key] as () => unknown)();
            } else {
              return args[key];
            }
          },
        });
      });
      return modifier(element, props, newArgs);
    }
  }
}
