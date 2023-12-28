import {
  targetFor,
  type ComponentRenderTarget,
  ComponentReturnType,
  NodeReturnType,
  destroyElement,
} from "@/utils/component";
import type { Cell, MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";

export function ifCondition(
  cell: Cell<boolean> | MergedCell,
  outlet: ComponentRenderTarget,
  trueBranch: () => ComponentReturnType | NodeReturnType,
  falseBranch: () => ComponentReturnType | NodeReturnType
) {
  const placeholder = document.createComment("if-placeholder");
  const target = targetFor(outlet);
  target.appendChild(placeholder);
  let prevComponent: ComponentReturnType | NodeReturnType | null = null;
  const runDestructors = () => {
    if (prevComponent) {
      destroyElement(prevComponent);
    }
  }
  return [runDestructors, bindUpdatingOpcode(cell, (value) => {
    if (prevComponent) {
      destroyElement(prevComponent);
    }
    if (value === true) {
      prevComponent = trueBranch();
    } else {
      prevComponent = falseBranch();
    }
    renderElement(target, prevComponent, placeholder);
  })];
}

function renderElement(
  target: Node,
  el: ComponentReturnType | NodeReturnType,
  placeholder: Comment
) {
  if ("nodes" in el) {
    el.nodes.forEach((node) => {
      target.insertBefore(node, placeholder);
    });
  } else {
    target.insertBefore(el.node, placeholder);
  }
}
