export class Cell<T extends unknown = unknown> {
  declare _value: T;
  declare toHTML: () => string;
  [Symbol.toPrimitive](): T;
  _debugName?: string | undefined;
  constructor(value: T, debugName?: string);
  update(value: T): void;
}
