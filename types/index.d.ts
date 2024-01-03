declare global {
  interface Window {
    getDestructors: () => WeakSet<Node, Array<() => void>>;
  }
}

export {}