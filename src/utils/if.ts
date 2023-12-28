import {
  targetFor,
  type ComponentRenderTarget,
  ComponentReturnType,
  NodeReturnType,
  destroyElement,
} from "@/utils/component";
import type { Cell, MergedCell } from "@/utils/reactive";
import { bindUpdatingOpcode } from "@/utils/vm";

type GenericReturnType =
  | ComponentReturnType
  | NodeReturnType
  | ComponentReturnType[]
  | NodeReturnType[]
  | null
  | null[];

export function ifCondition(
  cell: Cell<boolean> | MergedCell,
  outlet: ComponentRenderTarget,
  trueBranch: () => GenericReturnType,
  falseBranch: () => GenericReturnType
) {
  const placeholder = document.createComment("if-placeholder");
  const target = targetFor(outlet);
  target.appendChild(placeholder);
  let prevComponent: GenericReturnType = null;
  const runDestructors = () => {
    if (prevComponent) {
      destroyElement(prevComponent);
    }
  };
  return [
    runDestructors,
    bindUpdatingOpcode(cell, (value) => {
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
    }),
  ];
}

function renderElement(
  target: Node,
  el: GenericReturnType,
  placeholder: Comment
) {
  if (!Array.isArray(el)) {
    if (el === null) {
      return;
    }
    if ("nodes" in el) {
      el.nodes.forEach((node) => {
        target.insertBefore(node, placeholder);
      });
    } else {
      target.insertBefore(el.node, placeholder);
    }
  } else {
    el.forEach((item) => {
      renderElement(target, item, placeholder);
    });
  }
}
