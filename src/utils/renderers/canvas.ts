import {
  $_tag,
  $_fin,
  Component,
  $_GET_ARGS,
  $_GET_SLOTS,
  // $_slot,
  Root,
  ComponentReturnType,
  setParentContext,
} from '@lifeart/gxt';
import { initDOM, provideContext, RENDERING_CONTEXT } from '@/utils/context';
import { ComponentReturn } from '@glint/template/-private/integration';
import {
  addToTree,
  cId,
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
} from '../shared';
import { renderElement } from '../component';

// Exported for testing
export const DESTROYED_NODES: WeakSet<CanvasBaseElement> = new WeakSet();

export class CanvasBaseElement {
  toCanvas(_: CanvasRenderingContext2D) {
    // console.log(`toCanvase`, ctx);
  }
  parentElement: CanvasBaseElement | undefined | HTMLCanvasElement;
  // neeed for IF
  get parentNode() {
    return this.parentElement;
  }
  // need for list
  removeChild(child: CanvasBaseElement) {
    this.children = this.children.filter((el) => el !== child);
  }
  children: CanvasBaseElement[] = [];
  isConnected = false;
  remove() {
    if (DESTROYED_NODES.has(this)) {
      return;
    }
    if (this.parentElement instanceof CanvasBaseElement) {
      this.parentElement.removeChild(this);
    }
    this.isConnected = false;
    DESTROYED_NODES.add(this);
    this.children.length = 0;
    this.parentElement = undefined;
  }
  get childNodes() {
    return this.children;
  }
}
export class CanvasComment extends CanvasBaseElement {}
export class CanvasFragment extends CanvasBaseElement {}
export class CanvasTextElement extends CanvasBaseElement {
  attrs = {
    font: '48px serif',
    fillStyle: 'red',
    x: 0,
    y: 0,
  };
  text = '';
  toCanvas(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = this.attrs.fillStyle;
    ctx.font = this.attrs.font;
    ctx.fillText(this.text, this.attrs.x, this.attrs.y);
  }
}

export function CanvasRenderer(): ComponentReturn<
  {
    default: [];
  },
  HTMLCanvasElement
> {
  // @ts-expect-error
  $_GET_ARGS(this, arguments);
  const canvasNode = $_tag(
    'canvas',
    [[], [], []],
    [],
    // @ts-expect-error

    this,
  ) as HTMLCanvasElement;
  // @ts-expect-error
  const api = initDOM(this);
  const comment = api.comment('runtime-placeholder');
  canvasNode.style.display = 'block';
  canvasNode.style.border = '1px solid red';
  canvasNode.style.width = '100%';
  canvasNode.style.height = '100%';
  canvasNode.style.position = 'relative';
  canvasNode.style.top = '0';
  canvasNode.style.left = '0';
  canvasNode.style.pointerEvents = 'auto';

  // @ts-expect-error this
  const $slots = $_GET_SLOTS(this, arguments);

  const root = {
    // need for context lookup in tree
    [COMPONENT_ID_PROPERTY]: cId(),
    // need for root destructor
    [RENDERED_NODES_PROPERTY]: [],
  } as unknown as Root; // ctx instanceof Root

  const canvasApi = {
    toString() {
      return 'canvas:dom-api';
    },
    createNode(klass: typeof CanvasBaseElement, debuName?: string) {
      const node = new klass();
      // @ts-expect-error
      node.debugName = debuName;
      return node;
    },
    destroy(el: CanvasBaseElement) {
      this.nodes.delete(el);
      el.remove();
      this.scheduleRerender();
    },
    clearChildren(element: CanvasBaseElement) {
      element.children.forEach((child) => {
        this.destroy(child);
      });
      element.children.length = 0;
    },
    addEventListener(
      _node: CanvasBaseElement,
      _eventName: string,
      _fn: EventListener,
    ) {
      // Canvas elements don't support DOM events directly
      return undefined;
    },
    prop(_element: CanvasBaseElement, _name: string, _value: unknown) {
      // Canvas elements don't have properties like DOM elements
      return _value;
    },
    nodes: new Set<CanvasBaseElement>(),
    get ctx() {
      return canvasNode.getContext('2d')!;
    },
    parent(node: CanvasBaseElement) {
      return node.parentElement;
    },
    fragment() {
      return this.createNode(CanvasFragment);
    },
    element(tagName: string) {
      if (tagName === 'text') {
        return this.createNode(CanvasTextElement);
      } else {
        throw new Error(`Unknown canvas element: ${tagName}`);
      }
    },
    attr<T extends keyof CanvasTextElement['attrs']>(
      el: CanvasTextElement,
      attr: T,
      value: CanvasTextElement['attrs'][T],
    ) {
      el.attrs[attr] = value;
      this.scheduleRerender();
    },
    text(text: string) {
      const textNode = this.createNode(CanvasTextElement) as CanvasTextElement;
      textNode.text = text;
      return textNode;
    },
    clear() {
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    },
    textContent(element: CanvasTextElement, text: string) {
      element.text = text;
      this.scheduleRerender();
    },
    comment(debugName?: string) {
      return this.createNode(CanvasComment, debugName);
    },
    isNode(el: unknown) {
      return el instanceof CanvasBaseElement;
    },
    frameId: 0,
    scheduleRerender() {
      if (import.meta.env.SSR) {
        return;
      }
      window.cancelAnimationFrame(this.frameId);
      this.frameId = window.requestAnimationFrame(() => {
        this.clear();
        this.nodes.forEach((node) => {
          node.isConnected = true;
          node.toCanvas(this.ctx);
        });
      });
    },
    _addNode(element: CanvasBaseElement) {
      if (element instanceof CanvasFragment) {
        throw new Error('Cannot add CanvasFragment directly');
      }
      element.isConnected = true;
      element.parentElement = canvasNode;
      this.nodes.add(element);
    },
    insert(
      element: HTMLCanvasElement | CanvasFragment,
      node: CanvasTextElement | CanvasComment | ComponentReturnType,
    ) {
      if (import.meta.env.SSR) {
        return;
      }
      if (element instanceof HTMLCanvasElement) {
        if (!node || RENDERED_NODES_PROPERTY in node) {
          throw new Error('woops');
        }
        if (node instanceof CanvasFragment) {
          node.children.forEach((el) => {
            if (el instanceof CanvasFragment) {
              // recursively insert nested fragments
              this.insert(element, el);
            } else {
              el.parentElement = canvasNode;
              this._addNode(el);
            }
          });
          node.isConnected = false;
          node.remove();
          return;
        }
        this._addNode(node);
      } else if (element instanceof CanvasFragment) {
        if (!node || RENDERED_NODES_PROPERTY in node) {
          throw new Error('woops');
        } else if (node instanceof CanvasFragment) {
          // merge fragment to parent
          node.children.forEach((el) => {
            el.parentElement = element;
            this.insert(element, el);
          });
          node.remove();
          return;
        }
        node.parentElement = element;
        element.children.push(node);
        this._addNode(node);
        return;
      }
      this.scheduleRerender();
    },
  };
  try {
    // @ts-expect-error
    window['canvasApi'] = canvasApi;
  } catch (e) {
    // fine
  }
  provideContext(root, RENDERING_CONTEXT, canvasApi);
  // @ts-expect-error
  addToTree(this, root as unknown as Component<any>);
  // const nodes = $slots.default(root);
  // $_slot("default", () => [canvasNode], $slots, self)]

  let nodes: any[] = [];

  try {
    setParentContext(root);
    nodes = $slots.default(root);
  } finally {
    setParentContext(null);
  }

  // @ts-expect-error
  return $_fin(
    [
      canvasNode,
      // @ts-expect-error
      () => {
        // @ts-expect-error
        renderElement(canvasApi, root, canvasNode, $_fin(nodes, root));
        return comment;
      },
    ],
    // @ts-expect-error
    this,
  );
}
