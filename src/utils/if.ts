import {
  targetFor,
  type ComponentRenderTarget,
  destroyElement,
  GenericReturnType,
  renderElement,
  runDestructors,
} from "@/utils/component";
import { formula, type Cell, type MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { addDestructors } from "./component";

export function ifCondition(
  cell: Cell<boolean> | MergedCell,
  outlet: ComponentRenderTarget,
  trueBranch: () => GenericReturnType,
  falseBranch: () => GenericReturnType,
  existingPlaceholder?: Comment
) {
  // "if-placeholder"
  const placeholder = existingPlaceholder || document.createComment("");
  const target = targetFor(outlet);
  if (!placeholder.isConnected) {
    target.appendChild(placeholder);
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

  if (typeof cell === "function") {
    cell = formula(cell);
  } else if (typeof cell === "boolean") {
    cell = formula(() => cell);
  } else if (typeof cell === 'number') {
    cell = formula(() => cell);
  }
  let runNumber = 0;
  let throwedError: Error | null = null;

  addDestructors(
    [
      runExistingDestructors,
      bindUpdatingOpcode(cell, (value) => {
        if (throwedError) {
          Promise.resolve().then(() => {
            const newPlaceholder = document.createComment("");
            if (!placeholder.isConnected) {
              // placeholder is disconnected, it means whole `if` is removed from DOM, no need to recover;
              return;
            }
            placeholder.parentElement?.insertBefore(
              newPlaceholder,
              placeholder
            );
            Promise.all(runDestructors(placeholder)).then(async () => {
              if (!newPlaceholder.isConnected) {
                // placeholder is disconnected, it means whole `if` is removed from DOM, no need to recover;
                return;
              }
              if (prevComponent) {
                throw new Error(`Component should be destroyed`);
              }
              ifCondition(
                cell,
                outlet,
                trueBranch,
                falseBranch,
                newPlaceholder
              );
            });
          });
          throw throwedError;
        }
        runNumber++;
        (async () => {
          let localRunNumber = runNumber;
          let nextBranch = value === true ? trueBranch : falseBranch;
          if (prevComponent) {
            let prevCmp = prevComponent;
            prevComponent = null;
            await destroyElement(prevCmp);
          }
          if (localRunNumber !== runNumber) {
            // @todo: run -re-inicialization logic here,
            // because it may broke form overall syncLogic delay.
            throwedError = new Error(`
          Woops, error in ifCondition, managed by ${cell._debugName}: 
            Run number mismatch, looks like some modifier is removed longer than re-rendering takes. 
            It may be a bug in your code. We can't sync DOM because it's always outdated.
            Removing opcode to not break whole app.
        `);
            return;
          }
          if (isDestructorRunning) {
            return;
          }
          prevComponent = nextBranch();
          renderElement(
            placeholder.parentElement || target,
            prevComponent,
            placeholder
          );
        })();
      }),
    ],
    placeholder
  );
}
