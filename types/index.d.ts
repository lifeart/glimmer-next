declare global {
  interface Window {
    getDestructors: () => WeakSet<Node, Array<() => void>>;
    getVM: () => any;
  }

  const IS_GLIMMER_COMPAT_MODE: boolean;
  const RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: boolean;
}

declare module '@glint/environment-ember-template-imports/globals' {
  export default interface Globals {
    // used to hang any macros off of that are provided by config.additionalGlobals
    on: (
      noop: unknown,
      event: string,
      callback: (e: Event, element: Element) => void,
    ) => ModifierReturn;
    array: <T extends unknown>(...params: T[]) => T[],
    hash: <T extends Record<string, unknown>>(obj: T) => T,
  }
}

export {};
