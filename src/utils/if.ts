import {
  ComponentReturnType,
  destroyElement,
  GenericReturnType,
  NodeReturnType,
  relatedRoots,
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
import { addToTree, isFn, isPrimitive } from './shared';

export function ifCondition(
  this: any,
  ctx: ComponentReturnType | NodeReturnType,
  cell: Cell<boolean> | MergedCell,
  outlet: DocumentFragment,
  trueBranch: () => GenericReturnType,
  falseBranch: () => GenericReturnType,
  existingPlaceholder?: Comment,
) {
  // "if-placeholder"
  const placeholder = existingPlaceholder || api.comment();
  const target = outlet;
  if (!placeholder.isConnected) {
    api.append(target, placeholder);
  }
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
    cell = formula(() => deepFnValue(originalCell));
  } else if (isPrimitive(originalCell)) {
    cell = formula(() => originalCell);
  }
  let runNumber = 0;
  let throwedError: Error | null = null;

  associateDestroyable(ctx, [
    runExistingDestructors,
    opcodeFor(cell, (value) => {
      if (throwedError) {
        Promise.resolve().then(() => {
          const newPlaceholder = api.comment();
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
            const el2 = ifCondition(
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
      if (runNumber === 1) {
        let nextBranch = value ? trueBranch : falseBranch;
        // @ts-expect-error
        prevComponent = nextBranch(this);
         // @todo - fix type here
        addToTree(this, prevComponent as ComponentReturnType, nextBranch.name);
        relatedRoots.set(outlet, prevComponent);
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
          await destroyElement(prevCmp);
        }
        if (localRunNumber !== runNumber) {
          // @todo: run -re-inicialization logic here,
          // because it may broke form overall syncLogic delay.
          if (import.meta.env.DEV) {
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
        // @ts-expect-error
        prevComponent = nextBranch(this);
        // @todo - fix type here
        addToTree(this, prevComponent as ComponentReturnType, nextBranch.name);

        relatedRoots.set(outlet, prevComponent);
        renderElement(
          placeholder.parentNode || target,
          prevComponent,
          placeholder,
        );
      })();
    }),
  ]);
  return this;
}
