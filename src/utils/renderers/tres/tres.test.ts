import { expect, test, describe, beforeEach, vi } from 'vitest';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
} from 'three';

// Type guards
import {
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
import {
  normalizeVectorFlexibleParam,
  normalizeColor,
} from './utils/normalize';

// General utilities
import {
  kebabToCamel,
  isHTMLTag,
  deepEqual,
  deepArrayEqual,
} from './utils/index';

// Core exports
import {
  TresBrowserDOMApi,
  TresPlaceholder,
  TresFragment,
  TresComment,
  TresText,
  catalogue,
  extend,
  dispose,
  traverseObjects,
  findObjectsByType,
  findCameras,
  findMeshes,
  TRES_CONTEXT,
  createTresContext,
  createTresContextState,
} from './index';
import type { TresContext, TresContextState } from './context';

// ============================================
// Type Guards Tests (utils/is.ts)
// ============================================

describe('Type Guards (utils/is.ts)', () => {
  describe('und', () => {
    test('returns true for undefined', () => {
      expect(und(undefined)).toBe(true);
    });

    test('returns false for null', () => {
      expect(und(null)).toBe(false);
    });

    test('returns false for defined values', () => {
      expect(und(0)).toBe(false);
      expect(und('')).toBe(false);
      expect(und(false)).toBe(false);
      expect(und({})).toBe(false);
    });
  });

  describe('arr', () => {
    test('returns true for arrays', () => {
      expect(arr([])).toBe(true);
      expect(arr([1, 2, 3])).toBe(true);
      expect(arr(new Array(3))).toBe(true);
    });

    test('returns false for non-arrays', () => {
      expect(arr({})).toBe(false);
      expect(arr('array')).toBe(false);
      expect(arr(null)).toBe(false);
      expect(arr(undefined)).toBe(false);
    });
  });

  describe('num', () => {
    test('returns true for numbers', () => {
      expect(num(0)).toBe(true);
      expect(num(42)).toBe(true);
      expect(num(-3.14)).toBe(true);
      expect(num(Infinity)).toBe(true);
      expect(num(NaN)).toBe(true);
    });

    test('returns false for non-numbers', () => {
      expect(num('42')).toBe(false);
      expect(num(null)).toBe(false);
      expect(num(undefined)).toBe(false);
    });
  });

  describe('str', () => {
    test('returns true for strings', () => {
      expect(str('')).toBe(true);
      expect(str('hello')).toBe(true);
      expect(str(String(42))).toBe(true);
    });

    test('returns false for non-strings', () => {
      expect(str(42)).toBe(false);
      expect(str(null)).toBe(false);
      expect(str(undefined)).toBe(false);
      expect(str(['a', 'b'])).toBe(false);
    });
  });

  describe('bool', () => {
    test('returns true for booleans', () => {
      expect(bool(true)).toBe(true);
      expect(bool(false)).toBe(true);
    });

    test('returns false for non-booleans', () => {
      expect(bool(0)).toBe(false);
      expect(bool(1)).toBe(false);
      expect(bool('')).toBe(false);
      expect(bool(null)).toBe(false);
      expect(bool(undefined)).toBe(false);
    });
  });

  describe('fun', () => {
    test('returns true for functions', () => {
      expect(fun(() => {})).toBe(true);
      expect(fun(function() {})).toBe(true);
      expect(fun(class {})).toBe(true);
      expect(fun(Math.max)).toBe(true);
    });

    test('returns false for non-functions', () => {
      expect(fun({})).toBe(false);
      expect(fun([])).toBe(false);
      expect(fun(null)).toBe(false);
    });
  });

  describe('obj', () => {
    test('returns true for plain objects', () => {
      expect(obj({})).toBe(true);
      expect(obj({ a: 1 })).toBe(true);
      expect(obj(new Object())).toBe(true);
    });

    test('returns false for arrays', () => {
      expect(obj([])).toBe(false);
    });

    test('returns false for functions', () => {
      expect(obj(() => {})).toBe(false);
    });

    test('returns false for primitives', () => {
      expect(obj(null)).toBe(false);
      expect(obj(undefined)).toBe(false);
      expect(obj(42)).toBe(false);
      expect(obj('string')).toBe(false);
    });
  });

  describe('object3D', () => {
    test('returns true for Object3D instances', () => {
      expect(object3D(new Object3D())).toBe(true);
      expect(object3D(new Mesh())).toBe(true);
      expect(object3D(new Group())).toBe(true);
      expect(object3D(new Scene())).toBe(true);
    });

    test('returns false for non-Object3D', () => {
      expect(object3D({})).toBe(false);
      expect(object3D(new BoxGeometry())).toBe(false);
      expect(object3D(new MeshBasicMaterial())).toBe(false);
      expect(object3D(null)).toBe(false);
    });
  });

  describe('camera', () => {
    test('returns true for cameras', () => {
      expect(camera(new PerspectiveCamera())).toBe(true);
    });

    test('returns false for non-cameras', () => {
      expect(camera(new Object3D())).toBe(false);
      expect(camera(new Mesh())).toBe(false);
      expect(camera({})).toBe(false);
    });
  });

  describe('bufferGeometry', () => {
    test('returns true for BufferGeometry', () => {
      expect(bufferGeometry(new BufferGeometry())).toBe(true);
      expect(bufferGeometry(new BoxGeometry())).toBe(true);
    });

    test('returns false for non-geometry', () => {
      expect(bufferGeometry(new Mesh())).toBe(false);
      expect(bufferGeometry({})).toBe(false);
    });
  });

  describe('material', () => {
    test('returns true for materials', () => {
      expect(material(new MeshBasicMaterial())).toBe(true);
      expect(material(new MeshStandardMaterial())).toBe(true);
    });

    test('returns false for non-materials', () => {
      expect(material(new Mesh())).toBe(false);
      expect(material({})).toBe(false);
    });
  });

  describe('light', () => {
    test('returns true for lights', () => {
      expect(light(new DirectionalLight())).toBe(true);
    });

    test('returns false for non-lights', () => {
      expect(light(new Mesh())).toBe(false);
      expect(light({})).toBe(false);
    });
  });

  describe('fog', () => {
    test('returns true for fog', () => {
      expect(fog(new Fog(0xffffff, 1, 100))).toBe(true);
    });

    test('returns false for non-fog', () => {
      expect(fog(new Mesh())).toBe(false);
      expect(fog({})).toBe(false);
    });
  });

  describe('scene', () => {
    test('returns true for Scene', () => {
      expect(scene(new Scene())).toBe(true);
    });

    test('returns false for non-Scene', () => {
      expect(scene(new Object3D())).toBe(false);
      expect(scene(new Mesh())).toBe(false);
    });
  });

  describe('tresObject', () => {
    test('returns true for Object3D', () => {
      expect(tresObject(new Mesh())).toBe(true);
    });

    test('returns true for BufferGeometry', () => {
      expect(tresObject(new BoxGeometry())).toBe(true);
    });

    test('returns true for Material', () => {
      expect(tresObject(new MeshBasicMaterial())).toBe(true);
    });

    test('returns true for Fog', () => {
      expect(tresObject(new Fog(0xffffff, 1, 100))).toBe(true);
    });

    test('returns false for plain objects', () => {
      expect(tresObject({})).toBe(false);
    });
  });

  describe('tresPrimitive', () => {
    test('returns true for objects with isPrimitive', () => {
      expect(tresPrimitive({ isPrimitive: true })).toBe(true);
    });

    test('returns false for regular objects', () => {
      expect(tresPrimitive({})).toBe(false);
      expect(tresPrimitive(new Mesh())).toBe(false);
    });
  });
});

// ============================================
// Normalization Utilities Tests (utils/normalize.ts)
// ============================================

describe('Normalization Utilities (utils/normalize.ts)', () => {
  describe('normalizeVectorFlexibleParam', () => {
    test('converts number to [n, n, n]', () => {
      expect(normalizeVectorFlexibleParam(5)).toEqual([5, 5, 5]);
      expect(normalizeVectorFlexibleParam(0)).toEqual([0, 0, 0]);
    });

    test('converts Vector3 to array', () => {
      const vec = new Vector3(1, 2, 3);
      expect(normalizeVectorFlexibleParam(vec)).toEqual([1, 2, 3]);
    });

    test('passes through arrays', () => {
      expect(normalizeVectorFlexibleParam([1, 2, 3])).toEqual([1, 2, 3]);
    });
  });

  describe('normalizeColor', () => {
    test('passes through Color instances', () => {
      const color = new Color(0xff0000);
      expect(normalizeColor(color)).toBe(color);
    });

    test('converts hex number to Color', () => {
      const result = normalizeColor(0xff0000);
      expect(result).toBeInstanceOf(Color);
      expect(result.getHex()).toBe(0xff0000);
    });

    test('converts string to Color', () => {
      const result = normalizeColor('#00ff00');
      expect(result).toBeInstanceOf(Color);
    });

    test('converts array to Color', () => {
      const result = normalizeColor([1, 0, 0]);
      expect(result).toBeInstanceOf(Color);
    });
  });
});

// ============================================
// General Utilities Tests (utils/index.ts)
// ============================================

describe('General Utilities (utils/index.ts)', () => {
  describe('kebabToCamel', () => {
    test('converts kebab-case to camelCase', () => {
      expect(kebabToCamel('position-x')).toBe('positionX');
      expect(kebabToCamel('rotation-y')).toBe('rotationY');
      expect(kebabToCamel('scale-x')).toBe('scaleX');
    });

    test('handles multiple hyphens', () => {
      expect(kebabToCamel('some-long-property-name')).toBe('someLongPropertyName');
    });

    test('leaves non-kebab strings unchanged', () => {
      expect(kebabToCamel('position')).toBe('position');
      expect(kebabToCamel('x')).toBe('x');
    });

    test('handles empty string', () => {
      expect(kebabToCamel('')).toBe('');
    });
  });

  describe('isHTMLTag', () => {
    test('returns true for HTML tags', () => {
      expect(isHTMLTag('div')).toBe(true);
      expect(isHTMLTag('span')).toBe(true);
      expect(isHTMLTag('button')).toBe(true);
      expect(isHTMLTag('input')).toBe(true);
      expect(isHTMLTag('canvas')).toBe(true);
    });

    test('returns false for non-HTML tags', () => {
      expect(isHTMLTag('TresMesh')).toBe(false);
      expect(isHTMLTag('CustomComponent')).toBe(false);
      expect(isHTMLTag('mesh')).toBe(false);
    });
  });

  describe('deepEqual', () => {
    test('returns true for equal primitives', () => {
      expect(deepEqual(1, 1)).toBe(true);
      expect(deepEqual('a', 'a')).toBe(true);
      expect(deepEqual(null, null)).toBe(true);
    });

    test('returns false for different primitives', () => {
      expect(deepEqual(1, 2)).toBe(false);
      expect(deepEqual('a', 'b')).toBe(false);
    });

    test('returns true for equal objects', () => {
      expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true);
      expect(deepEqual({ a: { b: 2 } }, { a: { b: 2 } })).toBe(true);
    });

    test('returns false for different objects', () => {
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });
  });

  describe('deepArrayEqual', () => {
    test('returns true for equal arrays', () => {
      expect(deepArrayEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepArrayEqual([], [])).toBe(true);
    });

    test('returns false for different arrays', () => {
      expect(deepArrayEqual([1, 2], [1, 3])).toBe(false);
      expect(deepArrayEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    test('returns false for non-arrays', () => {
      expect(deepArrayEqual([1] as any, {} as any)).toBe(false);
      expect(deepArrayEqual({} as any, [] as any)).toBe(false);
    });

    test('handles nested arrays', () => {
      expect(deepArrayEqual([[1, 2], [3, 4]], [[1, 2], [3, 4]])).toBe(true);
      expect(deepArrayEqual([[1, 2], [3, 4]], [[1, 2], [3, 5]])).toBe(false);
    });
  });
});

// ============================================
// TresBrowserDOMApi Tests
// ============================================

describe('TresBrowserDOMApi', () => {
  let api: TresBrowserDOMApi;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
  });

  describe('toString', () => {
    test('returns correct identifier', () => {
      expect(api.toString()).toBe('tres:dom-api');
    });
  });

  describe('isNode', () => {
    test('returns true for Object3D', () => {
      expect(api.isNode(new Object3D())).toBe(true);
      expect(api.isNode(new Mesh())).toBe(true);
    });

    test('returns true for BufferGeometry', () => {
      expect(api.isNode(new BoxGeometry())).toBe(true);
    });

    test('returns true for Material', () => {
      expect(api.isNode(new MeshBasicMaterial())).toBe(true);
    });

    test('returns true for Fog', () => {
      expect(api.isNode(new Fog(0xffffff, 1, 100))).toBe(true);
    });

    test('returns true for TresPlaceholder', () => {
      expect(api.isNode(new TresPlaceholder())).toBe(true);
    });

    test('returns false for plain objects', () => {
      expect(api.isNode({})).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(api.isNode(null)).toBe(false);
      expect(api.isNode(undefined)).toBe(false);
    });
  });

  describe('element', () => {
    test('creates Mesh for TresMesh', () => {
      const element = api.element('TresMesh');
      expect(element).toBeInstanceOf(Mesh);
    });

    test('creates BoxGeometry for TresBoxGeometry', () => {
      const element = api.element('TresBoxGeometry', false, false, [[], [['args', [1, 1, 1]]], []]);
      expect(element).toBeInstanceOf(BoxGeometry);
    });

    test('creates MeshBasicMaterial for TresMeshBasicMaterial', () => {
      const element = api.element('TresMeshBasicMaterial');
      expect(element).toBeInstanceOf(MeshBasicMaterial);
    });

    test('returns null for template tag', () => {
      expect(api.element('template')).toBe(null);
    });

    test('returns null for HTML tags', () => {
      expect(api.element('div')).toBe(null);
      expect(api.element('span')).toBe(null);
    });

    test('returns placeholder for unknown Tres elements', () => {
      const element = api.element('TresUnknownElement');
      expect(element).toBeInstanceOf(TresPlaceholder);
    });
  });

  describe('insert', () => {
    test('adds Object3D to parent', () => {
      const parent = new Group();
      const child = new Mesh();
      api.insert(parent as any, child as any);
      expect(parent.children).toContain(child);
    });

    test('attaches geometry to mesh', () => {
      const mesh = new Mesh();
      const geometry = new BoxGeometry();
      (geometry as any).attach = 'geometry';
      api.insert(mesh as any, geometry as any);
      expect(mesh.geometry).toBe(geometry);
    });

    test('attaches material to mesh', () => {
      const mesh = new Mesh();
      const mat = new MeshBasicMaterial();
      (mat as any).attach = 'material';
      api.insert(mesh as any, mat as any);
      expect(mesh.material).toBe(mat);
    });

    test('handles null child gracefully', () => {
      const parent = new Group();
      expect(() => api.insert(parent as any, null)).not.toThrow();
    });
  });

  describe('destroy', () => {
    test('removes Object3D from parent', () => {
      const parent = new Group();
      const child = new Mesh();
      parent.add(child);
      expect(parent.children).toContain(child);
      api.destroy(child as any);
      expect(parent.children).not.toContain(child);
    });

    test('disposes geometry and material', () => {
      const geometry = new BoxGeometry();
      const mat = new MeshBasicMaterial();
      const mesh = new Mesh(geometry, mat);

      const geometryDispose = vi.spyOn(geometry, 'dispose');
      const materialDispose = vi.spyOn(mat, 'dispose');

      api.destroy(mesh as any);

      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).toHaveBeenCalled();
    });

    test('handles null gracefully', () => {
      expect(() => api.destroy(null)).not.toThrow();
    });
  });

  describe('comment', () => {
    test('creates TresComment', () => {
      const comment = api.comment('test');
      expect(comment).toBeInstanceOf(TresComment);
    });
  });

  describe('text', () => {
    test('creates TresText', () => {
      const text = api.text('hello');
      expect(text).toBeInstanceOf(TresText);
      expect(text.textContent).toBe('hello');
    });

    test('converts number to string', () => {
      const text = api.text(42);
      expect(text.textContent).toBe('42');
    });
  });

  describe('fragment', () => {
    test('creates TresFragment', () => {
      const fragment = api.fragment();
      expect(fragment).toBeInstanceOf(TresFragment);
    });
  });

  describe('parent', () => {
    test('returns parent of Object3D', () => {
      const parent = new Group();
      const child = new Mesh();
      parent.add(child);
      expect(api.parent(child as any)).toBe(parent);
    });

    test('returns null for orphan', () => {
      const orphan = new Mesh();
      expect(api.parent(orphan as any)).toBe(null);
    });
  });

  describe('clearChildren', () => {
    test('removes all children', () => {
      const parent = new Group();
      parent.add(new Mesh());
      parent.add(new Mesh());
      expect(parent.children.length).toBe(2);
      api.clearChildren(parent as any);
      expect(parent.children.length).toBe(0);
    });
  });

  describe('prop', () => {
    test('sets position via pierced prop', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'position-x', 5);
      expect(mesh.position.x).toBe(5);
    });

    test('sets rotation via pierced prop', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'rotation-y', Math.PI);
      expect(mesh.rotation.y).toBe(Math.PI);
    });

    test('sets scale via pierced prop', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'scale-x', 2);
      expect(mesh.scale.x).toBe(2);
    });

    test('sets direct properties', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'visible', false);
      expect(mesh.visible).toBe(false);
    });
  });

  describe('textContent', () => {
    test('sets textContent on TresText', () => {
      const text = new TresText('initial');
      api.textContent(text, 'updated');
      expect(text.textContent).toBe('updated');
    });
  });
});

// ============================================
// Placeholder Classes Tests
// ============================================

describe('Placeholder Classes', () => {
  describe('TresPlaceholder', () => {
    test('is not visible', () => {
      const placeholder = new TresPlaceholder();
      expect(placeholder.visible).toBe(false);
    });

    test('has isTresPlaceholder flag', () => {
      const placeholder = new TresPlaceholder();
      expect(placeholder.isTresPlaceholder).toBe(true);
    });

    test('stores debug name', () => {
      const placeholder = new TresPlaceholder('test-debug');
      expect(placeholder.debugName).toBe('test-debug');
    });
  });

  describe('TresFragment', () => {
    test('is a TresPlaceholder', () => {
      const fragment = new TresFragment();
      expect(fragment.isTresPlaceholder).toBe(true);
    });

    test('has isTresFragment flag', () => {
      const fragment = new TresFragment();
      expect(fragment.isTresFragment).toBe(true);
    });
  });

  describe('TresComment', () => {
    test('is a TresPlaceholder', () => {
      const comment = new TresComment();
      expect(comment.isTresPlaceholder).toBe(true);
    });

    test('has isTresComment flag', () => {
      const comment = new TresComment();
      expect(comment.isTresComment).toBe(true);
    });
  });

  describe('TresText', () => {
    test('is a TresPlaceholder', () => {
      const text = new TresText();
      expect(text.isTresPlaceholder).toBe(true);
    });

    test('has isTresText flag', () => {
      const text = new TresText();
      expect(text.isTresText).toBe(true);
    });

    test('stores text content', () => {
      const text = new TresText('hello world');
      expect(text.textContent).toBe('hello world');
    });
  });
});

// ============================================
// Catalogue Tests
// ============================================

describe('Catalogue', () => {
  describe('catalogue', () => {
    test('contains Three.js classes', () => {
      expect(catalogue.value.Mesh).toBe(Mesh);
      expect(catalogue.value.BoxGeometry).toBe(BoxGeometry);
      expect(catalogue.value.MeshBasicMaterial).toBe(MeshBasicMaterial);
    });
  });

  describe('extend', () => {
    test('adds custom classes to catalogue', () => {
      class CustomClass {}
      extend({ CustomClass });
      expect(catalogue.value.CustomClass).toBe(CustomClass);
    });
  });
});

// ============================================
// Dispose & Traverse Utilities Tests
// ============================================

describe('Dispose & Traverse Utilities', () => {
  describe('dispose', () => {
    test('disposes mesh geometry and material', () => {
      const geometry = new BoxGeometry();
      const mat = new MeshBasicMaterial();
      const mesh = new Mesh(geometry, mat);

      const geometryDispose = vi.spyOn(geometry, 'dispose');
      const materialDispose = vi.spyOn(mat, 'dispose');

      dispose(mesh);

      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).toHaveBeenCalled();
    });

    test('disposes children recursively', () => {
      const parent = new Group();
      const childGeometry = new BoxGeometry();
      const childMaterial = new MeshBasicMaterial();
      const child = new Mesh(childGeometry, childMaterial);
      parent.add(child);

      const childGeometryDispose = vi.spyOn(childGeometry, 'dispose');
      const childMaterialDispose = vi.spyOn(childMaterial, 'dispose');

      dispose(parent);

      expect(childGeometryDispose).toHaveBeenCalled();
      expect(childMaterialDispose).toHaveBeenCalled();
    });

    test('removes object from parent', () => {
      const parent = new Group();
      const child = new Mesh();
      parent.add(child);

      dispose(child);

      expect(parent.children).not.toContain(child);
    });

    test('handles null gracefully', () => {
      expect(() => dispose(null)).not.toThrow();
      expect(() => dispose(undefined)).not.toThrow();
    });

    test('disposes material textures', () => {
      const texture = new Texture();
      const mat = new MeshBasicMaterial({ map: texture });
      const mesh = new Mesh(new BoxGeometry(), mat);

      const textureDispose = vi.spyOn(texture, 'dispose');

      dispose(mesh);

      expect(textureDispose).toHaveBeenCalled();
    });
  });

  describe('traverseObjects', () => {
    test('visits all objects in hierarchy', () => {
      const root = new Group();
      const child1 = new Mesh();
      const child2 = new Mesh();
      const grandchild = new Mesh();

      root.add(child1);
      root.add(child2);
      child1.add(grandchild);

      const visited: Object3D[] = [];
      traverseObjects(root, (obj) => visited.push(obj));

      expect(visited).toContain(root);
      expect(visited).toContain(child1);
      expect(visited).toContain(child2);
      expect(visited).toContain(grandchild);
      expect(visited.length).toBe(4);
    });
  });

  describe('findObjectsByType', () => {
    test('finds objects matching predicate', () => {
      const root = new Group();
      const mesh1 = new Mesh();
      const mesh2 = new Mesh();
      const cam = new PerspectiveCamera();

      root.add(mesh1);
      root.add(mesh2);
      root.add(cam);

      const meshes = findObjectsByType(root, (obj): obj is Mesh =>
        'isMesh' in obj && (obj as any).isMesh === true
      );

      expect(meshes).toContain(mesh1);
      expect(meshes).toContain(mesh2);
      expect(meshes).not.toContain(cam);
      expect(meshes.length).toBe(2);
    });
  });

  describe('findCameras', () => {
    test('finds all cameras in scene', () => {
      const scene = new Scene();
      const cam1 = new PerspectiveCamera();
      const cam2 = new PerspectiveCamera();
      const mesh = new Mesh();

      scene.add(cam1);
      scene.add(mesh);
      mesh.add(cam2); // Nested camera

      const cameras = findCameras(scene);

      expect(cameras).toContain(cam1);
      expect(cameras).toContain(cam2);
      expect(cameras.length).toBe(2);
    });
  });

  describe('findMeshes', () => {
    test('finds all meshes in scene', () => {
      const scene = new Scene();
      const mesh1 = new Mesh();
      const mesh2 = new Mesh();
      const group = new Group();

      scene.add(mesh1);
      scene.add(group);
      group.add(mesh2);

      const meshes = findMeshes(scene);

      expect(meshes).toContain(mesh1);
      expect(meshes).toContain(mesh2);
      expect(meshes.length).toBe(2);
    });
  });
});

// ============================================
// TresContext Tests
// ============================================

describe('TresContext', () => {
  describe('TRES_CONTEXT', () => {
    test('is a symbol', () => {
      expect(typeof TRES_CONTEXT).toBe('symbol');
    });

    test('has correct description', () => {
      expect(TRES_CONTEXT.description).toBe('TRES_CONTEXT');
    });
  });

  describe('createTresContextState', () => {
    test('creates state with scene', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);

      expect(state.scene).toBe(scene);
    });

    test('initializes camera as null', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);

      expect(state.camera.value).toBe(null);
    });

    test('initializes cameras as empty array', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);

      expect(state.cameras.value).toEqual([]);
    });

    test('initializes renderer as null', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);

      expect(state.renderer.value).toBe(null);
    });

    test('initializes callback sets', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);

      expect(state.onBeforeRender).toBeInstanceOf(Set);
      expect(state.onAfterRender).toBeInstanceOf(Set);
      expect(state.interactiveObjects).toBeInstanceOf(Set);
    });
  });

  describe('createTresContext', () => {
    let scene: Scene;
    let state: TresContextState;
    let context: TresContext;

    beforeEach(() => {
      scene = new Scene();
      state = createTresContextState(scene);
      context = createTresContext(state);
    });

    test('exposes scene', () => {
      expect(context.scene).toBe(scene);
    });

    test('exposes state', () => {
      expect(context.state).toBe(state);
    });

    test('getCamera returns null initially', () => {
      expect(context.getCamera()).toBe(null);
    });

    test('getCamera returns camera when set', () => {
      const camera = new PerspectiveCamera();
      state.camera.update(camera);

      expect(context.getCamera()).toBe(camera);
    });

    test('getCameras returns empty array initially', () => {
      expect(context.getCameras()).toEqual([]);
    });

    test('getCameras returns cameras when added', () => {
      const cam1 = new PerspectiveCamera();
      const cam2 = new PerspectiveCamera();
      state.cameras.update([cam1, cam2]);

      expect(context.getCameras()).toEqual([cam1, cam2]);
    });

    test('getRenderer returns null initially', () => {
      expect(context.getRenderer()).toBe(null);
    });

    test('onBeforeRender registers callback', () => {
      const callback = vi.fn();
      context.onBeforeRender(callback);

      expect(state.onBeforeRender.has(callback)).toBe(true);
    });

    test('onBeforeRender returns unregister function', () => {
      const callback = vi.fn();
      const unregister = context.onBeforeRender(callback);

      expect(state.onBeforeRender.has(callback)).toBe(true);
      unregister();
      expect(state.onBeforeRender.has(callback)).toBe(false);
    });

    test('onAfterRender registers callback', () => {
      const callback = vi.fn();
      context.onAfterRender(callback);

      expect(state.onAfterRender.has(callback)).toBe(true);
    });

    test('onAfterRender returns unregister function', () => {
      const callback = vi.fn();
      const unregister = context.onAfterRender(callback);

      expect(state.onAfterRender.has(callback)).toBe(true);
      unregister();
      expect(state.onAfterRender.has(callback)).toBe(false);
    });

    test('registerInteractiveObject adds object', () => {
      const mesh = new Mesh();
      context.registerInteractiveObject(mesh);

      expect(state.interactiveObjects.has(mesh)).toBe(true);
    });

    test('unregisterInteractiveObject removes object', () => {
      const mesh = new Mesh();
      context.registerInteractiveObject(mesh);
      expect(state.interactiveObjects.has(mesh)).toBe(true);

      context.unregisterInteractiveObject(mesh);
      expect(state.interactiveObjects.has(mesh)).toBe(false);
    });
  });
});

// ============================================
// TresBrowserDOMApi Context Tests
// ============================================

describe('TresBrowserDOMApi Context', () => {
  let api: TresBrowserDOMApi;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
  });

  describe('setContext', () => {
    test('stores context', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);
      const context = createTresContext(state);

      api.setContext(context);

      expect(api.getContext()).toBe(context);
    });
  });

  describe('getContext', () => {
    test('returns null when no context set', () => {
      expect(api.getContext()).toBe(null);
    });

    test('returns context when set', () => {
      const scene = new Scene();
      const state = createTresContextState(scene);
      const context = createTresContext(state);

      api.setContext(context);

      expect(api.getContext()).toBe(context);
    });
  });
});

// ============================================
// Shorthand Props Tests
// ============================================

describe('Shorthand Props Support', () => {
  let api: TresBrowserDOMApi;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
  });

  describe('position array prop', () => {
    test('sets position from array', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'position', [1, 2, 3]);

      expect(mesh.position.x).toBe(1);
      expect(mesh.position.y).toBe(2);
      expect(mesh.position.z).toBe(3);
    });
  });

  describe('rotation array prop', () => {
    test('sets rotation from array', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'rotation', [Math.PI / 2, Math.PI, 0]);

      expect(mesh.rotation.x).toBeCloseTo(Math.PI / 2);
      expect(mesh.rotation.y).toBeCloseTo(Math.PI);
      expect(mesh.rotation.z).toBeCloseTo(0);
    });
  });

  describe('scale array prop', () => {
    test('sets scale from array', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'scale', [2, 3, 4]);

      expect(mesh.scale.x).toBe(2);
      expect(mesh.scale.y).toBe(3);
      expect(mesh.scale.z).toBe(4);
    });
  });

  describe('scale scalar prop', () => {
    test('sets uniform scale from scalar', () => {
      const mesh = new Mesh();
      api.prop(mesh as any, 'scale', 2);

      expect(mesh.scale.x).toBe(2);
      expect(mesh.scale.y).toBe(2);
      expect(mesh.scale.z).toBe(2);
    });
  });

  describe('color prop', () => {
    test('sets color from hex number', () => {
      const mat = new MeshBasicMaterial();
      api.prop(mat as any, 'color', 0xff0000);

      expect(mat.color.getHex()).toBe(0xff0000);
    });

    test('sets color from array', () => {
      const mat = new MeshBasicMaterial();
      api.prop(mat as any, 'color', [1, 0, 0]);

      expect(mat.color.r).toBeCloseTo(1);
      expect(mat.color.g).toBeCloseTo(0);
      expect(mat.color.b).toBeCloseTo(0);
    });
  });
});

// ============================================
// Event Handler Props Tests
// ============================================

describe('Event Handler Props', () => {
  let api: TresBrowserDOMApi;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
  });

  describe('onClick prop', () => {
    test('stores onClick handler on object', () => {
      const mesh = new Mesh();
      const handler = vi.fn();
      api.prop(mesh as any, 'onClick', handler);

      // onClick should be stored on the object for raycasting
      expect((mesh as any).onClick).toBe(handler);
    });
  });

  describe('onPointerMove prop', () => {
    test('stores onPointerMove handler on object', () => {
      const mesh = new Mesh();
      const handler = vi.fn();
      api.prop(mesh as any, 'onPointerMove', handler);

      expect((mesh as any).onPointerMove).toBe(handler);
    });
  });

  describe('onPointerEnter prop', () => {
    test('stores onPointerEnter handler on object', () => {
      const mesh = new Mesh();
      const handler = vi.fn();
      api.prop(mesh as any, 'onPointerEnter', handler);

      expect((mesh as any).onPointerEnter).toBe(handler);
    });
  });

  describe('onPointerLeave prop', () => {
    test('stores onPointerLeave handler on object', () => {
      const mesh = new Mesh();
      const handler = vi.fn();
      api.prop(mesh as any, 'onPointerLeave', handler);

      expect((mesh as any).onPointerLeave).toBe(handler);
    });
  });
});

// ============================================
// Conditional Rendering Tests (#if/else)
// ============================================

describe('Conditional Rendering in Tres Context', () => {
  let api: TresBrowserDOMApi;
  let scene: Scene;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
    scene = new Scene();
  });

  describe('conditional insertion', () => {
    test('inserts node when condition is true', () => {
      const mesh = new Mesh();
      api.insert(scene as any, mesh as any);

      expect(scene.children).toContain(mesh);
      expect(scene.children.length).toBe(1);
    });

    test('placeholder can be inserted without affecting scene', () => {
      const placeholder = new TresPlaceholder('if-placeholder');
      api.insert(scene as any, placeholder);

      // Placeholder should be added but invisible
      expect(scene.children).toContain(placeholder);
      expect(placeholder.visible).toBe(false);
    });

    test('can toggle between mesh and placeholder', () => {
      const mesh = new Mesh();
      const placeholder = new TresPlaceholder('if-placeholder');

      // Condition true - insert mesh
      api.insert(scene as any, mesh as any);
      expect(scene.children).toContain(mesh);

      // Condition false - remove mesh, insert placeholder
      api.destroy(mesh as any);
      api.insert(scene as any, placeholder);
      expect(scene.children).not.toContain(mesh);
      expect(scene.children).toContain(placeholder);

      // Condition true again - remove placeholder, insert mesh
      api.destroy(placeholder as any);
      const newMesh = new Mesh();
      api.insert(scene as any, newMesh as any);
      expect(scene.children).not.toContain(placeholder);
      expect(scene.children).toContain(newMesh);
    });
  });

  describe('conditional with fragments', () => {
    test('fragment children are inserted into parent', () => {
      const fragment = new TresFragment();
      const mesh1 = new Mesh();
      const mesh2 = new Mesh();
      fragment.add(mesh1);
      fragment.add(mesh2);

      api.insert(scene as any, fragment);

      // Fragment children should be added to scene
      expect(scene.children).toContain(mesh1);
      expect(scene.children).toContain(mesh2);
    });
  });

  describe('nested conditional', () => {
    test('handles nested conditions', () => {
      const group = new Group();
      api.insert(scene as any, group as any);

      // Outer condition true, inner condition true
      const mesh = new Mesh();
      api.insert(group as any, mesh as any);
      expect(group.children).toContain(mesh);

      // Inner condition false
      api.destroy(mesh as any);
      const innerPlaceholder = new TresPlaceholder('inner-if');
      api.insert(group as any, innerPlaceholder);
      expect(group.children).not.toContain(mesh);
      expect(group.children).toContain(innerPlaceholder);

      // Outer condition false
      api.destroy(group as any);
      expect(scene.children).not.toContain(group);
    });
  });
});

// ============================================
// List Rendering Tests (@each)
// ============================================

describe('List Rendering in Tres Context', () => {
  let api: TresBrowserDOMApi;
  let scene: Scene;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
    scene = new Scene();
  });

  describe('list insertion', () => {
    test('inserts multiple items', () => {
      const meshes = [new Mesh(), new Mesh(), new Mesh()];

      meshes.forEach((mesh) => {
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);
      meshes.forEach((mesh) => {
        expect(scene.children).toContain(mesh);
      });
    });

    test('items maintain insertion order', () => {
      const mesh1 = new Mesh();
      mesh1.name = 'mesh1';
      const mesh2 = new Mesh();
      mesh2.name = 'mesh2';
      const mesh3 = new Mesh();
      mesh3.name = 'mesh3';

      api.insert(scene as any, mesh1 as any);
      api.insert(scene as any, mesh2 as any);
      api.insert(scene as any, mesh3 as any);

      expect(scene.children[0]).toBe(mesh1);
      expect(scene.children[1]).toBe(mesh2);
      expect(scene.children[2]).toBe(mesh3);
    });
  });

  describe('list removal', () => {
    test('removes items from list', () => {
      const mesh1 = new Mesh();
      const mesh2 = new Mesh();
      const mesh3 = new Mesh();

      api.insert(scene as any, mesh1 as any);
      api.insert(scene as any, mesh2 as any);
      api.insert(scene as any, mesh3 as any);

      expect(scene.children.length).toBe(3);

      // Remove middle item
      api.destroy(mesh2 as any);

      expect(scene.children.length).toBe(2);
      expect(scene.children).toContain(mesh1);
      expect(scene.children).not.toContain(mesh2);
      expect(scene.children).toContain(mesh3);
    });

    test('removes all items', () => {
      const meshes = [new Mesh(), new Mesh(), new Mesh()];
      meshes.forEach((mesh) => api.insert(scene as any, mesh as any));

      meshes.forEach((mesh) => api.destroy(mesh as any));

      expect(scene.children.length).toBe(0);
    });
  });

  describe('list update', () => {
    test('handles adding items to existing list', () => {
      const mesh1 = new Mesh();
      api.insert(scene as any, mesh1 as any);

      const mesh2 = new Mesh();
      api.insert(scene as any, mesh2 as any);

      expect(scene.children.length).toBe(2);
      expect(scene.children).toContain(mesh1);
      expect(scene.children).toContain(mesh2);
    });

    test('handles removing items from existing list', () => {
      const mesh1 = new Mesh();
      const mesh2 = new Mesh();
      const mesh3 = new Mesh();

      api.insert(scene as any, mesh1 as any);
      api.insert(scene as any, mesh2 as any);
      api.insert(scene as any, mesh3 as any);

      // Remove first item
      api.destroy(mesh1 as any);

      expect(scene.children.length).toBe(2);
      expect(scene.children[0]).toBe(mesh2);
      expect(scene.children[1]).toBe(mesh3);
    });
  });

  describe('list with groups', () => {
    test('renders list items as groups', () => {
      const items = [
        { geometry: new BoxGeometry(), material: new MeshBasicMaterial({ color: 0xff0000 }) },
        { geometry: new BoxGeometry(), material: new MeshBasicMaterial({ color: 0x00ff00 }) },
        { geometry: new BoxGeometry(), material: new MeshBasicMaterial({ color: 0x0000ff }) },
      ];

      const meshes = items.map((item) => new Mesh(item.geometry, item.material));

      meshes.forEach((mesh) => {
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);
      meshes.forEach((mesh, index) => {
        expect(scene.children[index]).toBe(mesh);
      });
    });
  });

  describe('nested lists', () => {
    test('renders nested list structure', () => {
      // Create a grid of meshes (3x3)
      const groups: Group[] = [];

      for (let i = 0; i < 3; i++) {
        const group = new Group();
        group.name = `row-${i}`;
        api.insert(scene as any, group as any);
        groups.push(group);

        for (let j = 0; j < 3; j++) {
          const mesh = new Mesh();
          mesh.name = `mesh-${i}-${j}`;
          api.insert(group as any, mesh as any);
        }
      }

      expect(scene.children.length).toBe(3);
      groups.forEach((group, i) => {
        expect(group.children.length).toBe(3);
        group.children.forEach((child, j) => {
          expect(child.name).toBe(`mesh-${i}-${j}`);
        });
      });
    });
  });
});

// ============================================
// Node Relocation Tests
// ============================================

describe('Node Relocation in Tres Context', () => {
  let api: TresBrowserDOMApi;
  let scene: Scene;

  beforeEach(() => {
    api = new TresBrowserDOMApi();
    scene = new Scene();
  });

  describe('moving nodes between parents', () => {
    test('moves node from one parent to another', () => {
      const group1 = new Group();
      const group2 = new Group();
      const mesh = new Mesh();

      api.insert(scene as any, group1 as any);
      api.insert(scene as any, group2 as any);
      api.insert(group1 as any, mesh as any);

      expect(group1.children).toContain(mesh);
      expect(group2.children).not.toContain(mesh);

      // Move mesh from group1 to group2
      mesh.removeFromParent();
      api.insert(group2 as any, mesh as any);

      expect(group1.children).not.toContain(mesh);
      expect(group2.children).toContain(mesh);
    });
  });

  describe('clearChildren', () => {
    test('clears all children from a node', () => {
      const group = new Group();
      api.insert(scene as any, group as any);

      const mesh1 = new Mesh();
      const mesh2 = new Mesh();
      const mesh3 = new Mesh();

      api.insert(group as any, mesh1 as any);
      api.insert(group as any, mesh2 as any);
      api.insert(group as any, mesh3 as any);

      expect(group.children.length).toBe(3);

      api.clearChildren(group as any);

      expect(group.children.length).toBe(0);
    });

    test('disposes geometry and materials when clearing', () => {
      const group = new Group();
      const geometry = new BoxGeometry();
      const material = new MeshBasicMaterial();
      const mesh = new Mesh(geometry, material);

      api.insert(scene as any, group as any);
      api.insert(group as any, mesh as any);

      const geometryDispose = vi.spyOn(geometry, 'dispose');
      const materialDispose = vi.spyOn(material, 'dispose');

      api.clearChildren(group as any);

      expect(geometryDispose).toHaveBeenCalled();
      expect(materialDispose).toHaveBeenCalled();
    });
  });

  describe('replacing list items', () => {
    test('handles replacing entire list', () => {
      // Initial list
      const initialMeshes = [new Mesh(), new Mesh()];
      initialMeshes.forEach((mesh) => api.insert(scene as any, mesh as any));

      expect(scene.children.length).toBe(2);

      // Clear and replace with new list
      api.clearChildren(scene as any);
      const newMeshes = [new Mesh(), new Mesh(), new Mesh()];
      newMeshes.forEach((mesh) => api.insert(scene as any, mesh as any));

      expect(scene.children.length).toBe(3);
      newMeshes.forEach((mesh) => {
        expect(scene.children).toContain(mesh);
      });
      initialMeshes.forEach((mesh) => {
        expect(scene.children).not.toContain(mesh);
      });
    });
  });
});
