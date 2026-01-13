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
} from './index';

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
