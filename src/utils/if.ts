import {
  type Component,
  destroyElement,
  type GenericReturnType,
  removeDestructor,
  renderElement,
} from '@/utils/component';
import {
  formula,
  type Cell,
  type MergedCell,
  deepFnValue,
} from '@/utils/reactive';
import { opcodeFor } from '@/utils/vm';
import { associateDestroyable } from './component';
import { api } from '@/utils/dom-api';
import {
  $DEBUG_REACTIVE_CONTEXTS,
  $_debug_args,
  addToTree,
  isFn,
  isPrimitive,
  IFS_FOR_HMR,
} from './shared';

export function ifCondition(
  ctx: Component<any>,
  cell: Cell<boolean> | MergedCell,
  outlet: DocumentFragment | HTMLElement,
  trueBranch: (ifContext: Component<any>) => GenericReturnType,
  falseBranch: (ifContext: Component<any>) => GenericReturnType,
  placeholder: Comment,
) {
  const target = outlet;
  let prevComponent: GenericReturnType = null;
  let isDestructorRunning = false;
  const runExistingDestructors = async () => {
    isDestructorRunning = true;
    if (prevComponent) {
      await destroyElement(prevComponent);
      prevComponent = null;
    }
  };
  const originalCell = cell;
  if (isFn(originalCell)) {
    cell = formula(() => deepFnValue(originalCell), 'if-condition-wrapper-fn');
  } else if (isPrimitive(originalCell)) {
    cell = formula(() => originalCell, 'if-condition-primitive-wrapper');
  }
  let runNumber = 0;
  let throwedError: Error | null = null;
  let lastValue: unknown = undefined;

  if (IS_DEV_MODE) {
    // @ts-expect-error this any type
    Object.defineProperty(this, $_debug_args, {
      get() {
        return {
          if: lastValue,
        };
      },
    });
    const currentComponent = () => {
      return {
        item: prevComponent,
        set(value: GenericReturnType) {
          prevComponent = value;
        }
      }
    }
    IFS_FOR_HMR.add(currentComponent);
    associateDestroyable(ctx, [
      () => {
        IFS_FOR_HMR.delete(currentComponent);
      }
    ]);
  }

  associateDestroyable(ctx, [
    () => {
      if (placeholder.isConnected) {
        placeholder.parentNode!.removeChild(placeholder);
      }
    },
    runExistingDestructors,
    // @ts-expect-error
    opcodeFor(cell, (value) => {
      if (throwedError) {
        Promise.resolve().then(() => {
          if (!placeholder.isConnected) {
            // placeholder is disconnected, it means whole `if` is removed from DOM, no need to recover;
            return;
          }
          const newPlaceholder = IS_DEV_MODE
            ? api.comment('if-error-placeholder')
            : api.comment('');
          api.insert(placeholder.parentNode!, newPlaceholder, placeholder);
          runExistingDestructors().then(async () => {
            removeDestructor(ctx, runExistingDestructors);
            if (!newPlaceholder.isConnected) {
              // placeholder is disconnected, it means whole `if` is removed from DOM, no need to recover;
              return;
            }
            if (prevComponent) {
              throw new Error(`Component should be destroyed`);
            }
            // @ts-expect-error this any type
            const el2 = new ifCondition(
              ctx,
              cell,
              outlet,
              trueBranch,
              falseBranch,
              newPlaceholder,
            );
            addToTree(ctx, el2, 'ifCondition');
          });
        });
        throw throwedError;
      }
      runNumber++;
      if (runNumber > 1) {
        if (!!lastValue === !!value) {
          return;
        }
      }
      lastValue = value;
      if (runNumber === 1) {
        let nextBranch = value ? trueBranch : falseBranch;
        if (IS_DEV_MODE) {
          $DEBUG_REACTIVE_CONTEXTS.push(
            `if:${value ? String(true) : String(false)}`,
          );
        }
        // @ts-expect-error this any type
        prevComponent = nextBranch(this as unknown as Component<any>);
        if (IS_DEV_MODE) {
          $DEBUG_REACTIVE_CONTEXTS.pop();
        }
        renderElement(
          placeholder.parentNode || target,
          prevComponent,
          placeholder,
        );
        return;
      }
      (async () => {
        if (runNumber === 1 || isDestructorRunning) {
          return;
        }
        let localRunNumber = runNumber;
        let nextBranch = value ? trueBranch : falseBranch;
        if (prevComponent) {
          let prevCmp = prevComponent;
          prevComponent = null;
          // console.log('prevComponent', prevCmp);
          await destroyElement(prevCmp);
        }
        if (localRunNumber !== runNumber) {
          // @todo: run -re-inicialization logic here,
          // because it may broke form overall syncLogic delay.
          if (IS_DEV_MODE) {
            throwedError = new Error(`
              Woops, error in ifCondition, managed by ${cell._debugName}: 
                Run number mismatch, looks like some modifier is removed longer than re-rendering takes. 
                It may be a bug in your code. We can't sync DOM because it's always outdated.
                Removing opcode to not break whole app.
            `);
          } else {
            throwedError = new Error(`ERROR_0`);
          }
          return;
        }
        if (isDestructorRunning) {
          return;
        }
        if (IS_DEV_MODE) {
          $DEBUG_REACTIVE_CONTEXTS.push(
            `if:${value ? String(true) : String(false)}`,
          );
        }
        // @ts-expect-error this any type
        prevComponent = nextBranch(this);
        if (IS_DEV_MODE) {
          $DEBUG_REACTIVE_CONTEXTS.pop();
        }
        renderElement(
          placeholder.parentNode || target,
          prevComponent,
          placeholder,
        );
      })();
    }),
  ]);
  // @ts-expect-error
  return this as unknown as Component<any>;
}
