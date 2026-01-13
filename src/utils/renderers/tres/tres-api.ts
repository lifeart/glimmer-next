import { BufferAttribute, Object3D } from 'three';
import type { Camera } from 'three';
import { deepArrayEqual, isHTMLTag, kebabToCamel } from './utils/index';

import type { TresObject, TresObject3D, TresScene } from './types';
import { catalogue } from './catalogue';
import { isFn } from '@/utils/shared';

let scene: TresScene | null = null;

const logError = (msg: string) => {
  console.error('[TresRenderer]', msg);
};

const supportedPointerEvents = [
  'onClick',
  'onPointerMove',
  'onPointerEnter',
  'onPointerLeave',
];

// Placeholder class for comments and fragments in the Three.js scene
export class TresPlaceholder extends Object3D {
  readonly isTresPlaceholder = true;
  debugName?: string;

  constructor(debugName?: string) {
    super();
    this.debugName = debugName;
    this.visible = false; // Placeholders should not be rendered
  }
}

export class TresFragment extends TresPlaceholder {
  readonly isTresFragment = true;
  constructor() {
    super('fragment');
  }
}

export class TresComment extends TresPlaceholder {
  readonly isTresComment = true;
  constructor(text?: string) {
    super(text || 'comment');
  }
}

export class TresText extends TresPlaceholder {
  readonly isTresText = true;
  textContent = '';
  constructor(text?: string) {
    super('text');
    this.textContent = text || '';
  }
}

type Props = [any[], [string, any][], any[]];

export class TresBrowserDOMApi {
  toString() {
    return 'tres:dom-api';
  }

  isNode(node: unknown): node is TresObject | TresPlaceholder {
    if (!node || typeof node !== 'object') return false;
    return (
      (node as TresObject).isObject3D === true ||
      (node as any).isBufferGeometry === true ||
      (node as any).isMaterial === true ||
      (node as any).isFog === true ||
      (node as any).isTexture === true ||
      (node as TresPlaceholder).isTresPlaceholder === true
    );
  }

  parent(node: TresObject | TresPlaceholder | null): TresObject | null {
    return (node as Object3D)?.parent as TresObject | null;
  }

  clearChildren(node: TresObject | TresPlaceholder | null): void {
    if (!node || !(node as TresObject).isObject3D) return;
    const object3D = node as Object3D;
    while (object3D.children.length > 0) {
      const child = object3D.children[0];
      this.destroy(child as TresObject);
    }
  }

  addEventListener(
    _node: TresObject | TresPlaceholder,
    _eventName: string,
    _fn: EventListener,
  ): undefined {
    // Three.js objects don't support DOM events directly
    // Event handling is done via raycasting in useTresEventManager
    return undefined;
  }

  element(
    tag: string,
    _isSVG = false,
    _anchor = false,
    _props: Props = [[], [], []],
  ): TresObject | TresPlaceholder | null {
    const props: Record<string, any> = {};
    const args = _props[1];
    args.forEach((arg) => {
      props[arg[0]] = arg[1];
    });

    if (!props.args) {
      props.args = [];
    }

    if (tag === 'template') {
      return null;
    }
    if (isHTMLTag(tag)) {
      return null;
    }

    let name = tag.replace('Tres', '');
    let instance: TresObject;

    if (tag === 'primitive') {
      if (props?.object === undefined) {
        logError("Tres primitives need a prop 'object'");
      }
      const object = props.object as TresObject;
      name = object.type;
      instance = Object.assign(object, {
        type: name,
        attach: props.attach,
        primitive: true,
      });
    } else {
      const target = catalogue.value[name];
      if (!target) {
        logError(
          `${name} is not defined on the THREE namespace. Use extend to add it to the catalog.`,
        );
        return new TresPlaceholder(`unknown:${name}`);
      }
      instance = new target(...props.args);
    }

    if (instance.isCamera) {
      if (!props?.position) {
        instance.position.set(3, 3, 3);
      }
      if (!props?.lookAt) {
        instance.lookAt(0, 0, 0);
      }
    }

    if (props?.attach === undefined) {
      if (instance.isMaterial) {
        instance.attach = 'material';
      } else if (instance.isBufferGeometry) {
        instance.attach = 'geometry';
      }
    }

    // Determine whether the material was passed via prop to
    // prevent its disposal when node is removed later in its lifecycle
    if (instance.isObject3D) {
      if (props?.material?.isMaterial) {
        (instance as TresObject3D).userData.tres__materialViaProp = true;
      }
      if (props?.geometry?.isBufferGeometry) {
        (instance as TresObject3D).userData.tres__geometryViaProp = true;
      }
    }

    // Store the tag name for later use in re-instancing
    instance.userData = {
      ...instance.userData,
      tres__name: name,
    };

    return instance;
  }

  insert(
    parent: TresScene | TresObject | TresFragment | null,
    child: TresObject | TresPlaceholder | null,
    _anchor?: any,
  ): void {
    if (!child) return;

    if (parent && (parent as TresScene).isScene) {
      scene = parent as TresScene;
    }
    const parentObject = parent || scene;
    if (!parentObject) return;

    // Handle fragment insertion
    if (child instanceof TresFragment) {
      child.children.forEach((grandchild) => {
        this.insert(parentObject as TresObject, grandchild as TresObject);
      });
      return;
    }

    if ((child as TresObject)?.isObject3D) {
      const childObj = child as TresObject;
      if ((childObj as unknown as Camera)?.isCamera) {
        if (scene?.userData.tres__registerCamera) {
          scene.userData.tres__registerCamera(childObj as unknown as Camera);
        }
      }

      if (supportedPointerEvents.some((eventName) => (childObj as any)[eventName])) {
        if (scene?.userData.tres__registerAtPointerEventHandler) {
          scene.userData.tres__registerAtPointerEventHandler(childObj as Object3D);
        }
      }
    }

    if ((child as TresObject)?.isObject3D && (parentObject as TresObject)?.isObject3D) {
      (parentObject as Object3D).add(child as Object3D);
      (child as Object3D).dispatchEvent({ type: 'added' });
    } else if ((child as any)?.isFog) {
      (parentObject as any).fog = child;
    } else if (typeof (child as TresObject)?.attach === 'string') {
      const attach = (child as TresObject).attach as string;
      (child as any).__previousAttach = (parentObject as any)[attach];
      (parentObject as any)[attach] = child;
    }
  }

  destroy(node: TresObject | TresPlaceholder | null): void {
    if (!node) return;

    if ((node as TresObject).isObject3D) {
      const object3D = node as Object3D;

      const disposeMaterialsAndGeometries = (obj: Object3D) => {
        const tresObj = obj as TresObject3D;
        if (!obj.userData.tres__materialViaProp) {
          tresObj.material?.dispose?.();
          tresObj.material = undefined;
        }
        if (!obj.userData.tres__geometryViaProp) {
          tresObj.geometry?.dispose?.();
          tresObj.geometry = undefined;
        }
      };

      const deregisterCamera = scene?.userData.tres__deregisterCamera;
      const deregisterAtPointerEventHandler = scene?.userData.tres__deregisterAtPointerEventHandler;
      const deregisterBlockingObjectAtPointerEventHandler =
        scene?.userData.tres__deregisterBlockingObjectAtPointerEventHandler;

      node.removeFromParent?.();
      object3D.traverse((child: Object3D) => {
        disposeMaterialsAndGeometries(child);
        if (deregisterCamera && (child as Camera).isCamera) {
          deregisterCamera(child as Camera);
        }
        if (deregisterBlockingObjectAtPointerEventHandler) {
          deregisterBlockingObjectAtPointerEventHandler(child);
        }
        if (
          deregisterAtPointerEventHandler &&
          supportedPointerEvents.some((eventName) => (child as any)[eventName])
        ) {
          deregisterAtPointerEventHandler(child);
        }
      });

      disposeMaterialsAndGeometries(object3D);
      if (deregisterCamera && (object3D as Camera).isCamera) {
        deregisterCamera(object3D as Camera);
      }
    }

    (node as TresObject).dispose?.();
  }

  attr(node: TresObject | TresPlaceholder | null, prop: string, nextValue: any): void {
    this.prop(node, prop, nextValue);
  }

  prop(node: TresObject | TresPlaceholder | null, prop: string, nextValue: any): void {
    if (!node || node instanceof TresPlaceholder) return;

    let root: any = node;
    let key = prop;

    if (node.isObject3D && key === 'blocks-pointer-events') {
      if (nextValue || nextValue === '') {
        scene?.userData.tres__registerBlockingObjectAtPointerEventHandler?.(node as Object3D);
      } else {
        scene?.userData.tres__deregisterBlockingObjectAtPointerEventHandler?.(node as Object3D);
      }
      return;
    }

    let finalKey = kebabToCamel(key);
    let target = root?.[finalKey];

    if (key === 'args') {
      const prevNode = node as TresObject3D;
      const prevArgs: any[] = [];
      const args = nextValue ?? [];
      const instanceName = node.userData?.tres__name || node.type;

      if (instanceName && prevArgs.length && !deepArrayEqual(prevArgs, args)) {
        root = Object.assign(prevNode, new catalogue.value[instanceName](...nextValue));
      }
      return;
    }

    if (root.type === 'BufferGeometry') {
      if (key === 'args') return;
      root.setAttribute(
        kebabToCamel(key),
        new BufferAttribute(...(nextValue as ConstructorParameters<typeof BufferAttribute>)),
      );
      return;
    }

    // Traverse pierced props (e.g. foo-bar=value => foo.bar = value)
    if (key.includes('-') && target === undefined) {
      const chain = key.split('-');
      target = chain.reduce((acc, k) => acc?.[kebabToCamel(k)], root);
      key = chain.pop() as string;
      finalKey = kebabToCamel(key);
      if (!target?.set) {
        root = chain.reduce((acc, k) => acc?.[kebabToCamel(k)], root);
      }
      // If we couldn't resolve the chain, bail out
      if (root === undefined) return;
    }

    let value = nextValue;
    if (value === '') {
      value = true;
    }

    // Set prop, prefer atomic methods if applicable
    if (isFn(target)) {
      if (!supportedPointerEvents.includes(prop)) {
        if (Array.isArray(value)) {
          node[finalKey](...value);
        } else {
          node[finalKey](value);
        }
      }
      return;
    }

    if (!target?.set && !isFn(target)) {
      root[finalKey] = value;
    } else if (target.constructor === value.constructor && target?.copy) {
      target.copy(value);
    } else if (Array.isArray(value)) {
      target.set(...value);
    } else if (!target.isColor && target.setScalar) {
      target.setScalar(value);
    } else {
      target.set(value);
    }
  }

  comment(text?: string): TresComment {
    return new TresComment(text);
  }

  text(text: string | number): TresText {
    return new TresText(String(text));
  }

  textContent(node: TresText | null, text: string): void {
    if (node instanceof TresText) {
      node.textContent = text;
    }
  }

  fragment(): TresFragment {
    return new TresFragment();
  }

}
