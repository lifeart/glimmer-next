import { $_GET_ARGS, hbs, type Component } from '@lifeart/gxt';
import { getContext, provideContext, RENDERING_CONTEXT } from '@/utils/context';
import { TresBrowserDOMApi } from './tres-api';
import type { Camera, Object3D, Material } from 'three';
import type { TresObject, TresObject3D } from './types';

// Core exports
export { TresCanvas } from './TresCanvas';
export { TresBrowserDOMApi, TresPlaceholder, TresFragment, TresComment, TresText } from './tres-api';
export { catalogue, extend } from './catalogue';

// Type guards - useful for checking Three.js object types
export {
  und,
  arr,
  num,
  str,
  bool,
  fun,
  obj,
  object3D,
  camera,
  bufferGeometry,
  material,
  light,
  fog,
  scene,
  tresObject,
  tresPrimitive,
} from './utils/is';

// Normalization utilities
export {
  normalizeVectorFlexibleParam,
  normalizeColor,
  type SizeFlexibleParams,
  type Vector2PropInterface,
  type Vector3PropInterface,
  type VectorFlexibleParams,
} from './utils/normalize';

// General utilities
export {
  kebabToCamel,
  isHTMLTag,
  deepEqual,
  deepArrayEqual,
} from './utils/index';

// Types
export type {
  TresObject,
  TresObject3D,
  TresScene,
  TresPrimitive,
  TresCatalogue,
  TresCamera,
  TresInstance,
  LocalState,
  AttachType,
  AttachFnType,
  InstanceProps,
  EventHandlers,
  ThreeEvent,
  TresVector2,
  TresVector3,
  TresVector4,
  TresColor,
  TresEuler,
  TresQuaternion,
} from './types';

/**
 * Get the Tres rendering context from a component
 * Useful for accessing the TresBrowserDOMApi within Tres components
 */
export function useTresContext(ctx: Component<any>): TresBrowserDOMApi | null {
  return getContext<TresBrowserDOMApi>(ctx, RENDERING_CONTEXT);
}

/**
 * Dispose of a Three.js object and its children
 * Recursively disposes geometries, materials, and textures
 */
export function dispose(object: TresObject | Object3D | null | undefined): void {
  if (!object) return;

  // Dispose children first
  if ('children' in object && Array.isArray(object.children)) {
    // Copy array since we're modifying it
    const children = [...object.children];
    children.forEach((child) => dispose(child as TresObject));
  }

  // Remove from parent
  if ('removeFromParent' in object && typeof object.removeFromParent === 'function') {
    object.removeFromParent();
  }

  // Dispose geometry
  if ('geometry' in object) {
    const geometry = (object as TresObject3D).geometry;
    if (geometry && 'dispose' in geometry) {
      geometry.dispose();
    }
  }

  // Dispose material(s)
  if ('material' in object) {
    const mat = (object as TresObject3D).material;
    if (mat) {
      if (Array.isArray(mat)) {
        mat.forEach((m: Material) => disposeMaterial(m));
      } else {
        disposeMaterial(mat as Material);
      }
    }
  }

  // Dispose the object itself
  if ('dispose' in object && typeof object.dispose === 'function') {
    object.dispose();
  }
}

/**
 * Dispose a material and its textures
 */
function disposeMaterial(material: Material): void {
  if (!material) return;

  // Dispose textures
  Object.values(material).forEach((value) => {
    if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) {
      value.dispose();
    }
  });

  material.dispose();
}

/**
 * Traverse an object and its children, calling a callback for each
 */
export function traverseObjects(
  object: Object3D,
  callback: (obj: Object3D) => void,
): void {
  callback(object);
  if (object.children) {
    object.children.forEach((child) => traverseObjects(child, callback));
  }
}

/**
 * Find all objects of a specific type in a scene graph
 */
export function findObjectsByType<T extends Object3D>(
  root: Object3D,
  predicate: (obj: Object3D) => obj is T,
): T[] {
  const results: T[] = [];
  traverseObjects(root, (obj) => {
    if (predicate(obj)) {
      results.push(obj);
    }
  });
  return results;
}

/**
 * Find all cameras in a scene
 */
export function findCameras(root: Object3D): Camera[] {
  return findObjectsByType(root, (obj): obj is Camera =>
    'isCamera' in obj && obj.isCamera === true
  );
}

/**
 * Find all meshes in a scene
 */
export function findMeshes(root: Object3D): Object3D[] {
  return findObjectsByType(root, (obj): obj is Object3D =>
    'isMesh' in obj && (obj as any).isMesh === true
  );
}

/**
 * TresProvider - A context provider for using Tres renderer in a subtree
 *
 * This allows rendering Three.js elements within GXT components.
 * Use TresCanvas instead for most use cases.
 */
export function TresProvider() {
  // @ts-expect-error typings error
  $_GET_ARGS(this, arguments);
  // @ts-expect-error typings error
  provideContext(this, RENDERING_CONTEXT, new TresBrowserDOMApi());
  return hbs`{{yield}}`;
}
