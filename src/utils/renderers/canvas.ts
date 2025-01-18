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

const DESTROYED_NODES: WeakSet<BaseElement> = new WeakSet();
class BaseElement {
  toCanvas(_: CanvasRenderingContext2D) {
    // console.log(`toCanvase`, ctx);
  }
  parentElement: BaseElement | undefined | HTMLCanvasElement;
  // neeed for IF
  get parentNode() {
    return this.parentElement;
  }
  // need for list
  removeChild(child: BaseElement) {
    this.children = this.children.filter((el) => el !== child);
    console.log('remove child', child);
  }
  children: BaseElement[] = [];
  isConnected = false;
  remove() {
    if (DESTROYED_NODES.has(this)) {
      return;
    }
    if (this.parentElement instanceof BaseElement) {
      debugger;
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
class Comment extends BaseElement {}
class Fragment extends BaseElement {}
class TextElement extends BaseElement {
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
    createNode(klass: typeof BaseElement, debuName?: string) {
      //   const destroyParent = getParentContext()!;
      const node = new klass();
      // @ts-expect-error
      node.debugName = debuName;
      //   registerDestructor(destroyParent, () => {
      //     if (!DESTROYED_NODES.has(node)) {
      //       this.nodes.delete(node);
      //       node.remove();
      //       this.scheduleRerender();
      //     }
      //   });
      return node;
    },
    destroy(el: BaseElement) {
      // console.log('destroy', el);
      this.nodes.delete(el);
      el.remove();
      this.scheduleRerender();
    },
    nodes: new Set<BaseElement>(),
    get ctx() {
      return canvasNode.getContext('2d')!;
    },
    fragment() {
      console.log(`c:element:fragment`);
      return this.createNode(Fragment);
    },
    element(tagName: string) {
      console.log(`c:element:${tagName}`);
      if (tagName === 'text') {
        return this.createNode(TextElement);
      } else {
        debugger;
      }
    },
    attr<T extends keyof TextElement['attrs']>(
      el: TextElement,
      attr: T,
      value: TextElement['attrs'][T],
    ) {
      el.attrs[attr] = value;
      if (DESTROYED_NODES.has(el)) {
        debugger;
      }
      this.scheduleRerender();
    },
    text(text: string) {
      console.log('c:text');
      debugger;
      this.ctx.fillText(text, 10, 50);
    },
    clear() {
      this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    },
    textContent(element: TextElement, text: string) {
      if (DESTROYED_NODES.has(element)) {
        debugger;
      }
      console.log('c:textContent', `${element.text} => ${text}`);
      element.text = text;
      this.scheduleRerender();
    },
    comment(debugName?: string) {
      console.log(`c:element:comment`);
      return this.createNode(Comment, debugName);
    },
    isNode(el: unknown) {
      return el instanceof BaseElement;
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
    _addNode(element: BaseElement) {
      if (element instanceof Fragment) {
        debugger;
      }
      element.isConnected = true;
      element.parentElement = canvasNode;
      this.nodes.add(element);
    },
    insert(
      element: HTMLCanvasElement | Fragment,
      node: TextElement | Comment | ComponentReturnType,
    ) {
      console.log('insert', element, node);
      if (import.meta.env.SSR) {
        return;
      }
      if (element instanceof HTMLCanvasElement) {
        if (!node || RENDERED_NODES_PROPERTY in node) {
          throw new Error('woops');
        }
        if (node instanceof Fragment) {
          node.children.forEach((el) => {
            if (el instanceof Fragment) {
              debugger;
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
      } else if (element instanceof Fragment) {
        console.log('c:insert: to Fragment ->', node);
        if (!node || RENDERED_NODES_PROPERTY in node) {
          throw new Error('woops');
        } else if (node instanceof Fragment) {
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
        console.log('wooosh');
        // @ts-expect-error
        renderElement(canvasApi, root, canvasNode, $_fin(nodes, root));
        return comment;
      },
    ],
    // @ts-expect-error
    this,
  );
}
