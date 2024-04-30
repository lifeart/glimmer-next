import { type Cell, formula } from '@lifeart/gxt';
import { opcodeFor, evaluateOpcode } from '../vm';

interface Cache {
  tag: ReturnType<typeof formula>;
  value: unknown;
  destroy: () => void;
}

export function createCache(fn: () => unknown): Cache {
  const tag = formula(fn);
  let initValue: any = null;
  let relatedCells: Set<Cell<any>> = new Set();
  let calcVersion = 0;
  evaluateOpcode(tag, (value) => {
    initValue = value;
  });
  tag.relatedCells?.forEach((cell) => {
    relatedCells.add(cell);
  });
  let consumeCells = () => Array.from(relatedCells).map((cell) => cell.value);
  const updateTag = formula(consumeCells);
  let updatingOpcodeDestructor = opcodeFor(updateTag, () => {
    calcVersion++;
  });
  let lastCalcVersion = calcVersion;

  return {
    tag,
    get value() {
      if (calcVersion !== lastCalcVersion) {
        lastCalcVersion = calcVersion;
        initValue = fn();
      }
      return initValue;
    },
    destroy() {
      tag.destroy();
      updateTag.destroy();
      updatingOpcodeDestructor();
    },
  };
}
export function getValue(cache: Cache) {
  return cache.value;
}
export function isConst(cache: Cache) {
  return cache.tag.isConst;
}
