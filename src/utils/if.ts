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
import { $_debug_args, addToTree, isFn, isPrimitive } from './shared';

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
  const ifId = Math.random().toString(36).slice(2);
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
  }

  associateDestroyable(ctx, [
    runExistingDestructors,
    opcodeFor(cell, (value) => {
      if (throwedError) {
        Promise.resolve().then(() => {
          const newPlaceholder = api.comment('if-error-placeholder');
          if (!placeholder.isConnected) {
            // placeholder is disconnected, it means whole `if` is removed from DOM, no need to recover;
            return;
          }
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
      const debugInfo = {
        ifId,
        ctx,
        runNumber,
        value,
        lastValue,
        debugName: cell._debugName,
        prevComponent,
      }
      if (runNumber > 1) {
        if (!!lastValue === !!value) {
          return;
        }
      }
      lastValue = value;
      if (runNumber === 1) {
        let nextBranch = value ? trueBranch : falseBranch;
        // @ts-expect-error this any type
        prevComponent = nextBranch(this as unknown as Component<any>);
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
        console.log('executing async branch rendering', debugInfo);
        // @ts-expect-error this any type
        prevComponent = nextBranch(this);
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
