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
  const placeholder = document.createComment('');
  const target = targetFor(outlet);
  target.appendChild(placeholder);
  let prevComponent: GenericReturnType = null;
  const runDestructors = () => {
    if (prevComponent) {
      destroyElement(prevComponent);
    }
  };

  if (typeof cell === "function") { 
    cell = formula(cell);
  } else if (typeof cell === 'boolean') {
    cell = formula(() => cell);
  }

  addDestructors([runDestructors, bindUpdatingOpcode(cell, (value) => {
    if (prevComponent) {
      destroyElement(prevComponent);
    }
    if (value === true) {
      prevComponent = trueBranch();
    } else {
      prevComponent = falseBranch();
    }
    renderElement(
      placeholder.parentElement || target,
      prevComponent,
      placeholder
    );
  })], placeholder);
}

