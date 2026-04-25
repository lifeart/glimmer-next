/**
 * If Control Flow - Level 5
 *
 * Conditional rendering component.
 */

// Import types from component-class to avoid circular dependency
import type { Component } from '@/core/component-class';
import type { ComponentLike, DOMApi, GenericReturnType } from '@/core/types';

// Import render/destroy functions directly (no late-binding needed)
import { renderElement } from '@/core/render-core';
import { destroyElement, destroyElementSync, unregisterFromParent } from '@/core/destroy';

import { Destructors, registerDestructor, destroy, markAsDestroyed } from '@/core/glimmer/destroyable';
import { formula, type Cell, type MergedCell } from '@/core/reactive';
import {
  $_debug_args,
  $DEBUG_REACTIVE_CONTEXTS,
  IFS_FOR_HMR,
  isEmpty,
  isFn,
  isPrimitive,
  isTagLike,
  RENDERED_NODES_PROPERTY,
  COMPONENT_ID_PROPERTY,
} from '@/core/shared';
import { cId, addToTree } from '@/core/tree';
import { opcodeFor } from '@/core/vm';
import { initDOM } from '@/core/context';
import { setParentContext } from '../tracking';

export type IfFunction = () => boolean;

export class IfCondition {
  isDestructorRunning = false;
  prevComponent: GenericReturnType | null = null;
  condition!: MergedCell | Cell<boolean>;
  destructors: Destructors = [];
  runNumber: number = 0;
  lastValue: boolean = false;
  target: DocumentFragment | HTMLElement;
  placeholder: Comment;
  throwedError: Error | null = null;
  destroyPromise: Promise<any> | null = null;
  [RENDERED_NODES_PROPERTY]: Array<Node> = [];
  [COMPONENT_ID_PROPERTY] = cId();
  // Snapshot of DOM nodes inserted by the most recent branch render. We track
  // these so we can clean them up even when the branch's `prevComponent` is
  // empty (e.g. when the true branch is just `{{yield}}` and the slot runtime
  // inserts nodes directly into the parent without threading them back into
  // the IfCondition's component tree).
  branchDomNodes: Array<Node> = [];
  trueBranch: (ifContext: IfCondition) => GenericReturnType;
  falseBranch: (ifContext: IfCondition) => GenericReturnType;
  declare api: DOMApi;

  constructor(
    parentContext: Component<any>,
    maybeCondition: Cell<boolean> | IfFunction | MergedCell,
    target: DocumentFragment | HTMLElement,
    placeholder: Comment,
    trueBranch: (ifContext: IfCondition) => GenericReturnType,
    falseBranch: (ifContext: IfCondition) => GenericReturnType,
  ) {
    this.target = target;
    this.placeholder = placeholder;
    this.setupCondition(maybeCondition);
    this.trueBranch = trueBranch;
    this.falseBranch = falseBranch;
    // Propagate $_eval from parent context for deferred rendering
    if (WITH_DYNAMIC_EVAL) {
      // @ts-expect-error $_eval may exist on parentContext
      if (parentContext?.$_eval) {
        // @ts-expect-error $_eval may exist
        this.$_eval = parentContext.$_eval;
      }
    }
    // @ts-expect-error typings error
    addToTree(parentContext, this, 'from if constructor');
    // @ts-expect-error
    this.api = initDOM(this);
    this.destructors.push(opcodeFor(this.condition, this.syncState.bind(this)));
    // Ensure initial branch renders synchronously even if opcodeFor deferred.
    // If opcodeFor already fired syncState, checkStatement will short-circuit
    // because lastValue matches and runNumber > 1.
    if (this.runNumber === 0) {
      this.syncState(this.condition.value);
    }
    registerDestructor(parentContext, this.destroy.bind(this));
    if (IS_DEV_MODE) {
      const instance = () => {
        return {
          item: this.prevComponent,
          set: (value: GenericReturnType) => {
            this.prevComponent = value;
          },
        };
      };
      IFS_FOR_HMR.add(instance);
      this.destructors.push(() => {
        IFS_FOR_HMR.delete(instance);
      });

      Object.defineProperty(this, $_debug_args, {
        get() {
          return {
            if: this.lastValue,
          };
        },
      });
    }
  }

  checkStatement(value: boolean) {
    this.runNumber++;
    if (this.runNumber > 1) {
      if (this.lastValue === !!value) {
        return;
      }
    }
    if (this.isDestructorRunning) {
      return;
    }
    this.lastValue = !!value as boolean;
    return true;
  }

  async reInit() {
    // here we assume we have concurrency error, related to async destructors
    // updating opcode should be already executed and removed by vm
    // we need to re-init it
    this.destructors.shift(); // removing updating opcode
    this.throwedError = null;
    this.runNumber = 0;
    this.destructors.unshift(
      opcodeFor(this.condition, this.syncState.bind(this)),
    );
  }

  syncState(value: unknown) {
    if (this.throwedError) {
      Promise.resolve().then(async () => {
        await this.reInit();
      });
      throw this.throwedError;
    }
    if (!this.checkStatement(value as boolean)) {
      return;
    }
    const nextBranch = value ? this.trueBranch : this.falseBranch;
    this.renderBranch(nextBranch, this.runNumber);
  }

  renderBranch(
    nextBranch: (ifContext: IfCondition) => GenericReturnType,
    runNumber: number,
  ) {
    if (this.destroyPromise) {
      this.destroyPromise.then(() => {
        this.destroyPromise = null;
        if (!this.validateEpoch(runNumber)) {
          return;
        }
        this.renderBranch(nextBranch, runNumber);
      }).catch(() => {
        this.destroyPromise = null;
      });
      return;
    } else if (this.prevComponent || this.branchDomNodes.length > 0) {
      const isEmptyArray = Array.isArray(this.prevComponent) && this.prevComponent.length === 0;
      // In Ember integration mode, use synchronous destroy for immediate DOM updates
      if ((globalThis as any).__GXT_MODE__) {
        this.destroyBranchSync();
        this.renderState(nextBranch);
        return;
      }
      // Fast path: nothing meaningful to async-destroy and no orphan DOM —
      // just render the next branch synchronously.
      if (isEmptyArray && this.branchDomNodes.length === 0) {
        this.prevComponent = null;
        if (!this.validateEpoch(runNumber)) {
          return;
        }
        this.renderState(nextBranch);
        return;
      }
      this.destroyPromise = this.destroyBranch();
      this.destroyPromise.then(() => {
        this.destroyPromise = null;
        if (!this.validateEpoch(runNumber)) {
          return;
        }
        this.renderBranch(nextBranch, runNumber);
      }).catch(() => {
        this.destroyPromise = null;
      });
      return;
    }
    if (!this.validateEpoch(runNumber)) {
      return;
    }
    this.renderState(nextBranch);
  }

  validateEpoch(runNumber: number) {
    if (this.isDestructorRunning) {
      return false;
    }
    if (this.runNumber !== runNumber) {
      if (IS_DEV_MODE) {
        this.throwedError = new Error(`
            Woops, error in ifCondition, managed by ${this.condition._debugName}:
              Run number mismatch, looks like some modifier is removed longer than re-rendering takes.
              It may be a bug in your code. We can't sync DOM because it's always outdated.
              Removing opcode to not break whole app.
          `);
      } else {
        this.throwedError = new Error(`ERROR_0`);
      }
      return false;
    }
    return true;
  }

  /**
   * Remove any DOM nodes that the previous branch render inserted between
   * its first node and the IfCondition placeholder. Used as a fallback for
   * branches whose render function does not thread results back through
   * `prevComponent` (e.g. yield-only true branches in slot mode).
   */
  removeOrphanBranchDom() {
    const nodes = this.branchDomNodes;
    if (nodes.length === 0) {
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      // Skip nodes that were already torn down (e.g. they were owned by
      // prevComponent and destroyElementSync already removed them) or that
      // are no longer attached anywhere.
      if (node && (node as Node).parentNode) {
        try {
          (node as Node).parentNode!.removeChild(node as Node);
        } catch {
          // Defensive: a parent may have been removed in the same tick.
          // Re-throw any unexpected error so it surfaces in dev.
          if (IS_DEV_MODE) {
            throw new Error('IfCondition: failed to remove orphan branch node');
          }
        }
      }
    }
    this.branchDomNodes = [];
  }

  destroyBranchSync() {
    const branch = this.prevComponent;
    this.prevComponent = null;
    if (branch !== null) {
      destroyElementSync(branch as ComponentLike, false, this.api);
    }
    this.removeOrphanBranchDom();
  }

  async destroyBranch() {
    const branch = this.prevComponent;
    this.prevComponent = null;
    if (branch !== null) {
      await destroyElement(branch as ComponentLike, false, this.api);
    }
    this.removeOrphanBranchDom();
  }

  renderState(nextBranch: (ifContext: IfCondition) => GenericReturnType) {
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`if:${String(this.lastValue)}`);
    }
    // Capture the sibling immediately before the placeholder so that, after
    // the branch renders, we can identify which DOM nodes are "owned" by
    // this branch — including nodes inserted by sub-runtimes (slots, dynamic
    // components) that don't thread their roots through `prevComponent`.
    const placeholderParent = this.api.parent(this.placeholder) as Node | null;
    const anchorBefore: Node | null = placeholderParent
      ? (this.placeholder as Node).previousSibling
      : null;
    try {
      setParentContext(this as unknown as ComponentLike);
      this.prevComponent = nextBranch(this);
    } finally {
      setParentContext(null);
    }
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
    renderElement(this.api, this as unknown as ComponentLike,
      (this.api.parent(this.placeholder)) || this.target,
      this.prevComponent,
      this.placeholder,
    );
    // Snapshot all nodes between the pre-render anchor and the placeholder.
    // These are the DOM nodes the branch ended up inserting into the parent.
    const livingParent = this.api.parent(this.placeholder) as Node | null;
    if (livingParent) {
      const captured: Node[] = [];
      let cursor: Node | null = anchorBefore
        ? anchorBefore.nextSibling
        : livingParent.firstChild;
      while (cursor && cursor !== this.placeholder) {
        captured.push(cursor);
        cursor = cursor.nextSibling;
      }
      this.branchDomNodes = captured;
    } else {
      this.branchDomNodes = [];
    }
    if (IS_DEV_MODE) {
      // HMR logic
      if (this.runNumber === 1) {
        this[RENDERED_NODES_PROPERTY] = [this.placeholder];
      }
    }
    if (this.prevComponent !== null) {
      unregisterFromParent(this.prevComponent as ComponentLike);
    }
    return;
  }

  async destroy() {
    if (this.isDestructorRunning) {
      throw new Error('Already destroying');
    }
    this.isDestructorRunning = true;
    // Mark as destroyed early (before await) to prevent double-destruction
    markAsDestroyed(this);
    if (this.placeholder.isConnected) {
      // should be handled on the top level
    }
    await this.destroyBranch();
    // Run destructors registered via registerDestructor(ifCondition, ...)
    const promises: Promise<void>[] = [];
    destroy(this, promises);
    if (promises.length) {
      await Promise.all(promises);
    }
    // Run local destructors (condition opcode, HMR cleanup)
    await Promise.all(this.destructors.map((destroyFn) => destroyFn()));
  }

  setupCondition(maybeCondition: Cell<boolean> | IfFunction | MergedCell) {
    if (isFn(maybeCondition)) {
      this.condition = formula(() => {
        const v = maybeCondition();
        // Allow external truthiness override (e.g., Ember's special rules)
        const externalToBool = (globalThis as any).__gxtToBool;
        if (externalToBool) {
          return externalToBool(v);
        }
        if (isPrimitive(v) || isEmpty(v)) {
          return !!v;
        } else if (isTagLike(v)) {
          return !!v.value;
        } else {
          return !!v;
        }
      }, 'if-condition-wrapper-fn');
    } else if (isPrimitive(maybeCondition)) {
      this.condition = formula(
        () => maybeCondition,
        'if-condition-primitive-wrapper',
      );
    } else {
      this.condition = maybeCondition;
    }
  }
}
