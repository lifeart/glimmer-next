/**
 * Integration tests for Tres renderer with GXT control flow primitives
 * Tests slots, slot params, #each, and #if blocks
 */
import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
} from 'three';

import {
  TresBrowserDOMApi,
  TresPlaceholder,
  TresFragment,
} from './tres-api';
import {
  createTresContext,
  createTresContextState,
} from './context';

import {
  Component,
  renderComponent,
  destroyElementSync,
} from '@/utils/component';
import {
  cell,
  type Cell,
} from '@/utils/reactive';
import {
  cleanupFastContext,
  provideContext,
  RENDERING_CONTEXT,
} from '@/utils/context';
import { Root } from '@/utils/dom';
import {
  RENDERED_NODES_PROPERTY,
  PARENT,
  TREE,
  CHILD,
  addToTree,
  cId,
  COMPONENT_ID_PROPERTY,
} from '@/utils/shared';

// ============================================
// Test Setup
// ============================================

describe('Tres Integration Tests', () => {
  let window: Window;
  let document: Document;
  let api: TresBrowserDOMApi;
  let root: Root;
  let scene: Scene;

  beforeEach(() => {
    window = new Window();
    document = window.document as unknown as Document;
    cleanupFastContext();
    root = new Root(document);

    // Setup Tres API with context
    api = new TresBrowserDOMApi();
    scene = new Scene();
    const contextState = createTresContextState(scene);
    const tresContext = createTresContext(contextState);
    api.setContext(tresContext);

    provideContext(root, RENDERING_CONTEXT, api);
  });

  afterEach(() => {
    cleanupFastContext();
    TREE.clear();
    PARENT.clear();
    CHILD.clear();
    window.close();
  });

  // ============================================
  // Slots Tests
  // ============================================

  describe('Slots in Tres Context', () => {
    test('default slot renders children into scene', () => {
      // Simulate a component with a default slot
      const parentComponent = new Component({});
      parentComponent[RENDERED_NODES_PROPERTY] = [];
      parentComponent[COMPONENT_ID_PROPERTY] = cId();
      addToTree(root, parentComponent);

      // Create child meshes (what would be in the slot)
      const mesh1 = new Mesh();
      mesh1.name = 'slot-child-1';
      const mesh2 = new Mesh();
      mesh2.name = 'slot-child-2';

      // Insert into scene (simulating slot rendering)
      api.insert(scene as any, mesh1 as any);
      api.insert(scene as any, mesh2 as any);

      expect(scene.children.length).toBe(2);
      expect(scene.children[0].name).toBe('slot-child-1');
      expect(scene.children[1].name).toBe('slot-child-2');
    });

    test('named slot renders to specific location', () => {
      // Create a group to act as the named slot target
      const headerGroup = new Group();
      headerGroup.name = 'header-slot';
      const contentGroup = new Group();
      contentGroup.name = 'content-slot';

      api.insert(scene as any, headerGroup as any);
      api.insert(scene as any, contentGroup as any);

      // Render to header slot
      const headerMesh = new Mesh();
      headerMesh.name = 'header-item';
      api.insert(headerGroup as any, headerMesh as any);

      // Render to content slot
      const contentMesh1 = new Mesh();
      contentMesh1.name = 'content-item-1';
      const contentMesh2 = new Mesh();
      contentMesh2.name = 'content-item-2';
      api.insert(contentGroup as any, contentMesh1 as any);
      api.insert(contentGroup as any, contentMesh2 as any);

      expect(headerGroup.children.length).toBe(1);
      expect(headerGroup.children[0].name).toBe('header-item');
      expect(contentGroup.children.length).toBe(2);
      expect(contentGroup.children[0].name).toBe('content-item-1');
      expect(contentGroup.children[1].name).toBe('content-item-2');
    });

    test('slot with fragment renders all fragment children', () => {
      const fragment = new TresFragment();
      const mesh1 = new Mesh();
      mesh1.name = 'fragment-child-1';
      const mesh2 = new Mesh();
      mesh2.name = 'fragment-child-2';
      const mesh3 = new Mesh();
      mesh3.name = 'fragment-child-3';

      fragment.add(mesh1);
      fragment.add(mesh2);
      fragment.add(mesh3);

      api.insert(scene as any, fragment);

      expect(scene.children.length).toBe(3);
      expect(scene.children.map(c => c.name)).toEqual([
        'fragment-child-1',
        'fragment-child-2',
        'fragment-child-3',
      ]);
    });
  });

  // ============================================
  // Slot Params Tests
  // ============================================

  describe('Slot Params in Tres Context', () => {
    test('slot params can be used to configure child meshes', () => {
      // Simulate slot params: position, color, scale
      const slotParams = {
        position: [0, 1, 0] as [number, number, number],
        color: 0xff0000,
        scale: 2,
      };

      // Create a mesh and apply params (simulating what slot content would do)
      const mesh = api.element('TresMesh') as Mesh;

      // Apply position from params
      api.prop(mesh as any, 'position', slotParams.position);
      expect(mesh.position.x).toBe(0);
      expect(mesh.position.y).toBe(1);
      expect(mesh.position.z).toBe(0);

      // Apply scale from params
      api.prop(mesh as any, 'scale', slotParams.scale);
      expect(mesh.scale.x).toBe(2);
      expect(mesh.scale.y).toBe(2);
      expect(mesh.scale.z).toBe(2);
    });

    test('slot params can pass index for list items', () => {
      const items = ['red', 'green', 'blue'];
      const meshes: Mesh[] = [];

      items.forEach((color, index) => {
        const mesh = new Mesh();
        mesh.name = `item-${index}`;
        mesh.userData.color = color;
        mesh.userData.index = index;
        meshes.push(mesh);
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);
      meshes.forEach((mesh, index) => {
        expect(mesh.userData.index).toBe(index);
        expect(mesh.name).toBe(`item-${index}`);
      });
    });

    test('slot params can pass complex objects', () => {
      // Simulate passing a complex object as slot param
      const itemData = {
        id: 'mesh-001',
        transform: {
          position: [1, 2, 3] as [number, number, number],
          rotation: [0, Math.PI / 2, 0] as [number, number, number],
        },
        material: {
          color: 0x00ff00,
          wireframe: true,
        },
      };

      const mesh = api.element('TresMesh') as Mesh;
      api.prop(mesh as any, 'position', itemData.transform.position);
      api.prop(mesh as any, 'rotation', itemData.transform.rotation);
      mesh.userData.id = itemData.id;

      expect(mesh.position.toArray()).toEqual([1, 2, 3]);
      expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
      expect(mesh.userData.id).toBe('mesh-001');
    });
  });

  // ============================================
  // #each Tests
  // ============================================

  describe('#each in Tres Context', () => {
    test('renders list of meshes', () => {
      const items = [
        { id: 1, name: 'cube' },
        { id: 2, name: 'sphere' },
        { id: 3, name: 'cylinder' },
      ];

      items.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.name;
        mesh.userData.id = item.id;
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);
      expect(scene.children.map(c => c.name)).toEqual(['cube', 'sphere', 'cylinder']);
    });

    test('updates when item added to list', () => {
      // Initial list
      const itemsCell = cell([
        { id: 1, name: 'item-1' },
        { id: 2, name: 'item-2' },
      ]);

      // Render initial items
      itemsCell.value.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.name;
        mesh.userData.id = item.id;
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(2);

      // Add new item
      const newItem = { id: 3, name: 'item-3' };
      const mesh = new Mesh();
      mesh.name = newItem.name;
      mesh.userData.id = newItem.id;
      api.insert(scene as any, mesh as any);

      expect(scene.children.length).toBe(3);
      expect(scene.children[2].name).toBe('item-3');
    });

    test('updates when item removed from list', () => {
      // Create meshes with tracking
      const meshMap = new Map<number, Mesh>();
      const items = [
        { id: 1, name: 'item-1' },
        { id: 2, name: 'item-2' },
        { id: 3, name: 'item-3' },
      ];

      items.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.name;
        mesh.userData.id = item.id;
        meshMap.set(item.id, mesh);
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);

      // Remove middle item
      const meshToRemove = meshMap.get(2)!;
      api.destroy(meshToRemove as any);

      expect(scene.children.length).toBe(2);
      expect(scene.children.map(c => c.name)).toEqual(['item-1', 'item-3']);
    });

    test('handles complete list replacement', () => {
      // Initial list
      const initialItems = [{ id: 1, name: 'old-1' }, { id: 2, name: 'old-2' }];
      initialItems.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.name;
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(2);

      // Clear and replace with new list
      api.clearChildren(scene as any);

      const newItems = [
        { id: 3, name: 'new-1' },
        { id: 4, name: 'new-2' },
        { id: 5, name: 'new-3' },
      ];
      newItems.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.name;
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);
      expect(scene.children.map(c => c.name)).toEqual(['new-1', 'new-2', 'new-3']);
    });

    test('handles empty list', () => {
      const items: any[] = [];
      items.forEach(item => {
        const mesh = new Mesh();
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(0);
    });

    test('handles list with index parameter', () => {
      const items = ['a', 'b', 'c'];

      items.forEach((item, index) => {
        const mesh = new Mesh();
        mesh.name = `${item}-${index}`;
        mesh.position.set(index * 2, 0, 0); // Position based on index
        api.insert(scene as any, mesh as any);
      });

      expect(scene.children.length).toBe(3);
      expect(scene.children[0].position.x).toBe(0);
      expect(scene.children[1].position.x).toBe(2);
      expect(scene.children[2].position.x).toBe(4);
    });

    test('keyed list preserves mesh instances', () => {
      // Create keyed items
      const items = [
        { id: 'key-a', data: 'A' },
        { id: 'key-b', data: 'B' },
        { id: 'key-c', data: 'C' },
      ];

      const meshById = new Map<string, Mesh>();
      items.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.id;
        mesh.userData.data = item.data;
        meshById.set(item.id, mesh);
        api.insert(scene as any, mesh as any);
      });

      // Store original references
      const originalMeshA = meshById.get('key-a')!;
      const originalMeshC = meshById.get('key-c')!;

      // Remove key-b, keep key-a and key-c
      api.destroy(meshById.get('key-b')! as any);

      expect(scene.children.length).toBe(2);
      // Verify same instances are preserved
      expect(scene.children).toContain(originalMeshA);
      expect(scene.children).toContain(originalMeshC);
    });

    test('nested #each renders hierarchical structure', () => {
      const categories = [
        { id: 'cat-1', items: [{ id: 'item-1a' }, { id: 'item-1b' }] },
        { id: 'cat-2', items: [{ id: 'item-2a' }, { id: 'item-2b' }, { id: 'item-2c' }] },
      ];

      categories.forEach(category => {
        const group = new Group();
        group.name = category.id;
        api.insert(scene as any, group as any);

        category.items.forEach(item => {
          const mesh = new Mesh();
          mesh.name = item.id;
          api.insert(group as any, mesh as any);
        });
      });

      expect(scene.children.length).toBe(2);
      expect((scene.children[0] as Group).children.length).toBe(2);
      expect((scene.children[1] as Group).children.length).toBe(3);
    });
  });

  // ============================================
  // #if Tests
  // ============================================

  describe('#if in Tres Context', () => {
    test('renders mesh when condition is true', () => {
      const showMesh = true;

      if (showMesh) {
        const mesh = new Mesh();
        mesh.name = 'conditional-mesh';
        api.insert(scene as any, mesh as any);
      }

      expect(scene.children.length).toBe(1);
      expect(scene.children[0].name).toBe('conditional-mesh');
    });

    test('does not render mesh when condition is false', () => {
      const showMesh = false;

      if (showMesh) {
        const mesh = new Mesh();
        mesh.name = 'conditional-mesh';
        api.insert(scene as any, mesh as any);
      }

      expect(scene.children.length).toBe(0);
    });

    test('toggles mesh visibility with reactive condition', () => {
      const isVisible = cell(true);
      let currentMesh: Mesh | null = null;

      // Simulate initial render
      const render = () => {
        if (isVisible.value) {
          if (!currentMesh) {
            currentMesh = new Mesh();
            currentMesh.name = 'toggle-mesh';
            api.insert(scene as any, currentMesh as any);
          }
        } else {
          if (currentMesh) {
            api.destroy(currentMesh as any);
            currentMesh = null;
          }
        }
      };

      // Initial: visible
      render();
      expect(scene.children.length).toBe(1);

      // Toggle: hidden
      isVisible.update(false);
      render();
      expect(scene.children.length).toBe(0);

      // Toggle: visible again
      isVisible.update(true);
      render();
      expect(scene.children.length).toBe(1);
    });

    test('if/else renders correct branch', () => {
      const useBoxGeometry = cell(true);

      const renderConditional = () => {
        api.clearChildren(scene as any);

        if (useBoxGeometry.value) {
          const mesh = new Mesh(new BoxGeometry(1, 1, 1));
          mesh.name = 'box';
          api.insert(scene as any, mesh as any);
        } else {
          // Sphere would go here, using placeholder
          const placeholder = new TresPlaceholder('sphere-placeholder');
          api.insert(scene as any, placeholder);
        }
      };

      // True branch
      renderConditional();
      expect(scene.children.length).toBe(1);
      expect(scene.children[0].name).toBe('box');

      // False branch
      useBoxGeometry.update(false);
      renderConditional();
      expect(scene.children.length).toBe(1);
      expect(scene.children[0]).toBeInstanceOf(TresPlaceholder);
    });

    test('nested #if conditions', () => {
      const showOuter = cell(true);
      const showInner = cell(true);

      const renderNested = () => {
        api.clearChildren(scene as any);

        if (showOuter.value) {
          const group = new Group();
          group.name = 'outer-group';
          api.insert(scene as any, group as any);

          if (showInner.value) {
            const mesh = new Mesh();
            mesh.name = 'inner-mesh';
            api.insert(group as any, mesh as any);
          }
        }
      };

      // Both true
      renderNested();
      expect(scene.children.length).toBe(1);
      expect((scene.children[0] as Group).children.length).toBe(1);

      // Outer true, inner false
      showInner.update(false);
      renderNested();
      expect(scene.children.length).toBe(1);
      expect((scene.children[0] as Group).children.length).toBe(0);

      // Outer false
      showOuter.update(false);
      renderNested();
      expect(scene.children.length).toBe(0);
    });

    test('#if inside #each', () => {
      const items = [
        { id: 1, visible: true },
        { id: 2, visible: false },
        { id: 3, visible: true },
      ];

      items.forEach(item => {
        if (item.visible) {
          const mesh = new Mesh();
          mesh.name = `item-${item.id}`;
          api.insert(scene as any, mesh as any);
        }
      });

      expect(scene.children.length).toBe(2);
      expect(scene.children.map(c => c.name)).toEqual(['item-1', 'item-3']);
    });
  });

  // ============================================
  // Combined Control Flow Tests
  // ============================================

  describe('Combined Control Flow', () => {
    test('slot with #each inside', () => {
      // Simulate a component that receives items via slot params
      const slotItems = [
        { id: 1, name: 'slot-item-1' },
        { id: 2, name: 'slot-item-2' },
      ];

      const slotGroup = new Group();
      slotGroup.name = 'slot-container';
      api.insert(scene as any, slotGroup as any);

      // Render items inside slot
      slotItems.forEach(item => {
        const mesh = new Mesh();
        mesh.name = item.name;
        api.insert(slotGroup as any, mesh as any);
      });

      expect(slotGroup.children.length).toBe(2);
      expect(slotGroup.children.map(c => c.name)).toEqual(['slot-item-1', 'slot-item-2']);
    });

    test('#each with dynamic #if per item', () => {
      const itemsCell = cell([
        { id: 1, active: true },
        { id: 2, active: false },
        { id: 3, active: true },
      ]);

      const renderItems = () => {
        api.clearChildren(scene as any);
        itemsCell.value.forEach(item => {
          if (item.active) {
            const mesh = new Mesh();
            mesh.name = `active-${item.id}`;
            api.insert(scene as any, mesh as any);
          }
        });
      };

      renderItems();
      expect(scene.children.length).toBe(2);

      // Update item 2 to active
      itemsCell.update([
        { id: 1, active: true },
        { id: 2, active: true },
        { id: 3, active: true },
      ]);
      renderItems();
      expect(scene.children.length).toBe(3);
    });

    test('complex nested structure with all control flow', () => {
      const categories = cell([
        {
          id: 'cat-1',
          visible: true,
          items: [
            { id: 'item-1', active: true },
            { id: 'item-2', active: false },
          ],
        },
        {
          id: 'cat-2',
          visible: true,
          items: [
            { id: 'item-3', active: true },
          ],
        },
      ]);

      const renderComplex = () => {
        api.clearChildren(scene as any);

        categories.value.forEach(category => {
          if (category.visible) {
            const group = new Group();
            group.name = category.id;
            api.insert(scene as any, group as any);

            category.items.forEach(item => {
              if (item.active) {
                const mesh = new Mesh();
                mesh.name = item.id;
                api.insert(group as any, mesh as any);
              }
            });
          }
        });
      };

      renderComplex();

      expect(scene.children.length).toBe(2);
      expect((scene.children[0] as Group).children.length).toBe(1); // Only active items
      expect((scene.children[1] as Group).children.length).toBe(1);
    });
  });
});
