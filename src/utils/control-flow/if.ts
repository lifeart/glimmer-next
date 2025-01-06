import {
  associateDestroyable,
  destroyElement,
  type GenericReturnType,
  renderElement,
  type Component,
} from '@/utils/component';
import { Destructors } from '@/utils/glimmer/destroyable';
import { formula, type Cell, type MergedCell } from '@/utils/reactive';
import {
  $_debug_args,
  $DEBUG_REACTIVE_CONTEXTS,
  IFS_FOR_HMR,
  isEmpty,
  isFn,
  isPrimitive,
  isTagLike,
  addToTree,
} from '@/utils/shared';
import { opcodeFor } from '@/utils/vm';

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
  trueBranch: (ifContext: Component<any>) => GenericReturnType;
  falseBranch: (ifContext: Component<any>) => GenericReturnType;
  constructor(
    parentContext: Component<any>,
    maybeCondition: Cell<boolean>,
    target: DocumentFragment | HTMLElement,
    placeholder: Comment,
    trueBranch: (ifContext: Component<any>) => GenericReturnType,
    falseBranch: (ifContext: Component<any>) => GenericReturnType,
  ) {
    this.target = target;
    this.placeholder = placeholder;
    this.setupCondition(maybeCondition);
    this.trueBranch = trueBranch;
    this.falseBranch = falseBranch;
    // @ts-expect-error typings error
    addToTree(parentContext, this);
    this.destructors.push(opcodeFor(this.condition, this.syncState.bind(this)));
    associateDestroyable(parentContext, [this.destroy.bind(this)]);
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
    nextBranch: (ifContext: Component<any>) => GenericReturnType,
    runNumber: number,
  ) {
    if (this.destroyPromise) {
      this.destroyPromise.then(() => {
        this.destroyPromise = null;
        this.renderBranch(nextBranch, runNumber);
      });
      return;
    } else if (this.prevComponent) {
      this.destroyBranch().then(() => {
        this.renderBranch(nextBranch, runNumber);
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
      // @todo: run -re-inicialization logic here,
      // because it may broke form overall syncLogic delay.
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
  async destroyBranch() {
    const branch = this.prevComponent;
    if (branch === null) {
      return;
    } else {
      this.prevComponent = null;
    }
    this.destroyPromise = destroyElement(branch);
    await this.destroyPromise;
  }
  renderState(nextBranch: (ifContext: Component<any>) => GenericReturnType) {
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.push(`if:${String(this.lastValue)}`);
    }
    this.prevComponent = nextBranch(this as unknown as Component<any>);
    if (IS_DEV_MODE) {
      $DEBUG_REACTIVE_CONTEXTS.pop();
    }
    renderElement(
      this.placeholder.parentNode || this.target,
      this.prevComponent,
      this.placeholder,
    );
    return;
  }
  async destroy() {
    this.isDestructorRunning = true;
    if (this.placeholder.isConnected) {
      // should be handled on the top level
      // this.placeholder.parentNode!.removeChild(this.placeholder);
    }
    await this.destroyBranch();
    await Promise.all(this.destructors.map((destroyFn) => destroyFn()));
  }
  setupCondition(maybeCondition: Cell<boolean>) {
    if (isFn(maybeCondition)) {
      this.condition = formula(() => {
        const v = maybeCondition();
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
