import {
  $_tag,
  $_fin,
  Component,
  $_GET_ARGS,
  $_GET_SLOTS,
  Root,
  setParentContext,
  cell,
} from '@lifeart/gxt';
import { initDOM, provideContext, RENDERING_CONTEXT } from '@/utils/context';
import { TresBrowserDOMApi, TresPlaceholder } from './tres-api';
import { PerspectiveCamera, Scene, WebGLRenderer, Camera } from 'three';
import type { TresScene } from './types';
import {
  addToTree,
  cId,
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
} from '@/utils/shared';
import { renderElement } from '@/utils/component';

/**
 * TresCanvas - A canvas component for rendering Three.js scenes in GXT
 *
 * Usage:
 * <TresCanvas>
 *   <TresMesh>
 *     <TresBoxGeometry @args={{array 1 1 1}} />
 *     <TresMeshNormalMaterial />
 *   </TresMesh>
 * </TresCanvas>
 */
export function TresCanvas(this: Component) {
  $_GET_ARGS(this, arguments);

  // Create the canvas element
  const canvasNode = $_tag('canvas', [[], [], []], [], this) as HTMLCanvasElement;
  canvasNode.setAttribute('data-tres', 'tresjs 0.0.0');
  canvasNode.style.display = 'block';
  canvasNode.style.width = '100%';
  canvasNode.style.height = '400px';
  canvasNode.style.position = 'relative';
  canvasNode.style.top = '0';
  canvasNode.style.left = '0';
  canvasNode.style.pointerEvents = 'auto';
  canvasNode.style.touchAction = 'none';

  const parentApi = initDOM(this);
  const comment = parentApi.comment('tres-placeholder');

  const $slots = $_GET_SLOTS(this, arguments);

  // Create the Three.js scene
  const scene = new Scene() as TresScene;

  // Create a root context for GXT rendering
  const root = {
    [COMPONENT_ID_PROPERTY]: cId(),
    [RENDERED_NODES_PROPERTY]: [],
  } as unknown as Root;

  // Create the Tres DOM API with scene reference
  const api = new TresBrowserDOMApi();

  // State for camera management
  const cameras = cell<Camera[]>([]);
  const activeCamera = cell<Camera | null>(null);

  // Register camera handlers on scene userData
  scene.userData.tres__registerCamera = (camera: Camera) => {
    if (!cameras.value.includes(camera)) {
      cameras.update([...cameras.value, camera]);
    }
    if (!activeCamera.value) {
      activeCamera.update(camera);
    }
  };

  scene.userData.tres__deregisterCamera = (camera: Camera) => {
    cameras.update(cameras.value.filter((c) => c !== camera));
    if (activeCamera.value === camera) {
      activeCamera.update(cameras.value[0] || null);
    }
  };

  // Provide the rendering context
  provideContext(root, RENDERING_CONTEXT, api);

  addToTree(this, root as unknown as Component<any>);

  // Animation loop state
  let animationFrameId: number | null = null;
  let renderer: WebGLRenderer | null = null;

  // Setup renderer and animation loop after canvas is mounted
  const setupRenderer = () => {
    if (import.meta.env.SSR) return;

    // Create WebGL renderer
    renderer = new WebGLRenderer({
      canvas: canvasNode,
      antialias: true,
      alpha: true,
    });

    // Set size
    const width = canvasNode.clientWidth || 400;
    const height = canvasNode.clientHeight || 400;
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Add default camera if none provided
    if (!activeCamera.value) {
      const defaultCamera = new PerspectiveCamera(75, width / height, 0.1, 1000);
      defaultCamera.position.set(3, 3, 3);
      defaultCamera.lookAt(0, 0, 0);
      scene.userData.tres__registerCamera?.(defaultCamera);
    }

    // Animation loop
    const animate = () => {
      if (!renderer) return;
      animationFrameId = requestAnimationFrame(animate);

      if (activeCamera.value) {
        renderer.render(scene, activeCamera.value);
      }
    };

    animate();
  };

  // Handle resize
  const handleResize = () => {
    if (!renderer || !activeCamera.value) return;
    const width = canvasNode.clientWidth || 400;
    const height = canvasNode.clientHeight || 400;
    renderer.setSize(width, height);

    if ((activeCamera.value as PerspectiveCamera).isPerspectiveCamera) {
      (activeCamera.value as PerspectiveCamera).aspect = width / height;
      (activeCamera.value as PerspectiveCamera).updateProjectionMatrix();
    }
  };

  // Cleanup function
  const cleanup = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    if (renderer) {
      renderer.dispose();
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', handleResize);
    }
  };

  // Use requestAnimationFrame to delay setup until canvas is in DOM
  if (typeof window !== 'undefined') {
    requestAnimationFrame(() => {
      setupRenderer();
      window.addEventListener('resize', handleResize);
    });
  }

  // Store cleanup for later
  // @ts-expect-error attaching cleanup to canvas
  canvasNode.__tres_cleanup = cleanup;

  // Render slots with proper context
  let nodes: any[] = [];
  try {
    setParentContext(root);
    nodes = $slots.default(root);
  } finally {
    setParentContext(null);
  }

  // Process nodes and add to Three.js scene
  const processNodes = (items: unknown[]) => {
    items.forEach((node: unknown) => {
      if (node && !(node instanceof TresPlaceholder)) {
        api.insert(scene, node as any);
      }
    });
  };

  if (Array.isArray(nodes)) {
    processNodes(nodes);
  }

  // @ts-expect-error using renderElement for proper component handling
  renderElement(api, root as unknown as Component<any>, scene as unknown as Node, nodes);

  // Return just the canvas node to the DOM
  return $_fin([canvasNode, comment], this);
}
