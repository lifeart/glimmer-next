import {
  $_tag,
  $_fin,
  $_GET_ARGS,
  $_GET_SLOTS,
  Root,
  setParentContext,
} from '@/core/dom';
import { Component, type ComponentReturnType } from '@/core/component';
import { initDOM, provideContext, RENDERING_CONTEXT } from '@/core/context';
import { ComponentReturn } from '@glint/template/-private/integration';
import {
  addToTree,
  cId,
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
} from '../shared';
import { renderElement } from '../render-core';

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

export class CanvasRectElement extends CanvasBaseElement {
  attrs = {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fillStyle: 'blue',
    strokeStyle: '',
    lineWidth: 1,
  };
  toCanvas(ctx: CanvasRenderingContext2D) {
    if (this.attrs.fillStyle) {
      ctx.fillStyle = this.attrs.fillStyle;
      ctx.fillRect(this.attrs.x, this.attrs.y, this.attrs.width, this.attrs.height);
    }
    if (this.attrs.strokeStyle) {
      ctx.strokeStyle = this.attrs.strokeStyle;
      ctx.lineWidth = this.attrs.lineWidth;
      ctx.strokeRect(this.attrs.x, this.attrs.y, this.attrs.width, this.attrs.height);
    }
  }
}

export class CanvasCircleElement extends CanvasBaseElement {
  attrs = {
    cx: 50,
    cy: 50,
    r: 25,
    fillStyle: 'green',
    strokeStyle: '',
    lineWidth: 1,
  };
  toCanvas(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.arc(this.attrs.cx, this.attrs.cy, this.attrs.r, 0, Math.PI * 2);
    if (this.attrs.fillStyle) {
      ctx.fillStyle = this.attrs.fillStyle;
      ctx.fill();
    }
    if (this.attrs.strokeStyle) {
      ctx.strokeStyle = this.attrs.strokeStyle;
      ctx.lineWidth = this.attrs.lineWidth;
      ctx.stroke();
    }
  }
}

export class CanvasLineElement extends CanvasBaseElement {
  attrs = {
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 100,
    strokeStyle: 'black',
    lineWidth: 2,
    lineCap: 'round' as CanvasLineCap,
  };
  toCanvas(ctx: CanvasRenderingContext2D) {
    ctx.beginPath();
    ctx.moveTo(this.attrs.x1, this.attrs.y1);
    ctx.lineTo(this.attrs.x2, this.attrs.y2);
    ctx.strokeStyle = this.attrs.strokeStyle;
    ctx.lineWidth = this.attrs.lineWidth;
    ctx.lineCap = this.attrs.lineCap;
    ctx.stroke();
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

  // Default canvas dimensions
  const width = 400;
  const height = 160;

  // Get device pixel ratio for retina support
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

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

  // Set actual canvas size (scaled for retina)
  canvasNode.width = width * dpr;
  canvasNode.height = height * dpr;

  // Set display size via CSS
  canvasNode.style.display = 'block';
  canvasNode.style.width = `${width}px`;
  canvasNode.style.height = `${height}px`;

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
    prop(
      element: CanvasTextElement | CanvasRectElement | CanvasCircleElement | CanvasLineElement,
      name: string,
      value: unknown,
    ) {
      // Canvas elements use the same attribute system for properties
      // Since the compiler treats unknown attributes as properties,
      // we delegate to attr() to handle them uniformly
      this.attr(element, name, value);
      return value;
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
      switch (tagName) {
        case 'text':
          return this.createNode(CanvasTextElement);
        case 'rect':
          return this.createNode(CanvasRectElement);
        case 'circle':
          return this.createNode(CanvasCircleElement);
        case 'line':
          return this.createNode(CanvasLineElement);
        default:
          throw new Error(`Unknown canvas element: ${tagName}`);
      }
    },
    attr(
      el: CanvasTextElement | CanvasRectElement | CanvasCircleElement | CanvasLineElement,
      attr: string,
      value: any,
    ) {
      // @ts-expect-error dynamic attr access
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
    dpr,
    isScaled: false,
    scheduleRerender() {
      if (import.meta.env.SSR) {
        return;
      }
      window.cancelAnimationFrame(this.frameId);
      this.frameId = window.requestAnimationFrame(() => {
        const ctx = this.ctx;
        // Scale context for retina displays (only once)
        if (!this.isScaled && this.dpr > 1) {
          ctx.scale(this.dpr, this.dpr);
          this.isScaled = true;
        }
        this.clear();
        this.nodes.forEach((node) => {
          node.isConnected = true;
          node.toCanvas(ctx);
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
