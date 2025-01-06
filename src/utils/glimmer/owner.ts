// https://github.com/glimmerjs/glimmer-vm/blob/1cb493b128a9c6704482a1775a478aac20259935/packages/%40glimmer/owner/index.ts#L12

export const OWNER: unique symbol = Symbol('OWNER') as any;

interface OwnedObject<O extends object> {
  [OWNER]: O | undefined;
}

/**
  Framework objects in a Glimmer application may receive an owner object.
  Glimmer is unopinionated about this owner, but will forward it through its
  internal resolution system, and through its managers if it is provided.
*/
export function getOwner<O extends object = object>(
  object: object,
): O | undefined {
  return (object as OwnedObject<O>)[OWNER];
}

/**
  `setOwner` set's an object's owner
*/
export function setOwner<O extends object = object>(
  object: object,
  owner: O,
): void {
  (object as OwnedObject<O>)[OWNER] = owner;
}

export function createOwner() {
  // returning owner object
  return {};
}
