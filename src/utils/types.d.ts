export type RenderableType = Node | ComponentReturnType | string | number;
export type ShadowRootMode = 'open' | 'closed' | null;
export type ModifierFn = (
  element: HTMLElement,
  ...args: unknown[]
) => void | DestructorFn;

export type Attr =
  | MergedCell
  | Cell
  | string
  | ((element: HTMLElement, attribute: string) => void);

export type TagAttr = [string, Attr];
export type TagProp = [string, Attr];
export type TagEvent = [string, EventListener | ModifierFn];
export type FwType = [TagProp[], TagAttr[], TagEvent[]];
export type Props = [TagProp[], TagAttr[], TagEvent[], FwType?];

export type Fn = () => unknown;
export type InElementFnArg = () => HTMLElement;
export type BranchCb = () => ComponentReturnType | Node;
