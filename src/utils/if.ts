import {
  targetFor,
  type ComponentRenderTarget,
  destroyElement,
  GenericReturnType,
  renderElement,
} from "@/utils/component";
import { formula, type Cell, type MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";
import { addDestructors } from "./component";

export function ifCondition(
  cell: Cell<boolean> | MergedCell,
  outlet: ComponentRenderTarget,
  trueBranch: () => GenericReturnType,
  falseBranch: () => GenericReturnType
) {
  // "if-placeholder"
  const placeholder = document.createComment("");
  const target = targetFor(outlet);
  target.appendChild(placeholder);
  let prevComponent: GenericReturnType = null;
  let isDestructorRunning = false;
  const runDestructors = async () => {
    isDestructorRunning = true;
    if (prevComponent) {
      await destroyElement(prevComponent);
    }
  };

  if (typeof cell === "function") {
    cell = formula(cell);
  } else if (typeof cell === "boolean") {
    cell = formula(() => cell);
  }
  let runNumber = 0;
  let throwedError: Error | null = null;

  addDestructors(
    [
      runDestructors,
      bindUpdatingOpcode(cell, (value) => {
        if (throwedError) {
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
