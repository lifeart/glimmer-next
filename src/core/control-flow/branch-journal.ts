/**
 * Ember compat (WITH_EMBER_INTEGRATION without EMBER_NATIVE): the elements
 * created while a block's branch renders, in creation order.
 *
 * A branch is built before it is inserted (`IfCondition.renderState`), so when
 * a component of the branch throws, the elements the branch created before it
 * are referenced by nothing. Glimmer appends a block's nodes as it renders
 * them, and those nodes stay in front of the block's placeholder. The journal
 * lets the block find them: the elements still without a parent are the
 * branch's top-level nodes (a child element is created before its parent and
 * then appended to it), in document order.
 *
 * Only `_DOM` records, and only while a journal is open. Nested branches share
 * the one array: each takes its part from the mark it opened at.
 */
const createdElements: Node[] = [];
let openJournals = 0;

/** Record an element `_DOM` created (no-op when no branch is rendering). */
export function recordCreatedElement(element: Node): void {
  if (openJournals > 0) createdElements.push(element);
}

/** Open a journal for a branch render: returns its mark. */
export function openBranchJournal(): number {
  openJournals++;
  return createdElements.length;
}

/** Close the journal opened at `mark`, dropping its entries. */
export function closeBranchJournal(mark: number): void {
  openJournals--;
  createdElements.length = mark;
}

/**
 * The elements created since `mark` that have no parent: the top-level nodes
 * of a branch that threw, in document order.
 */
export function detachedSince(mark: number, parentOf: (node: Node) => Node | null): Node[] {
  const detached: Node[] = [];
  for (let i = mark; i < createdElements.length; i++) {
    const node = createdElements[i];
    if (parentOf(node) === null) detached.push(node);
  }
  return detached;
}
