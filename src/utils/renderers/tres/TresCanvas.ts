import {
  $_tag,
  $_fin,
  Component,
  $_GET_ARGS,
  $_GET_SLOTS,
  Root,
  setParentContext,
  registerDestructor,
} from '@lifeart/gxt';
import { initDOM, provideContext, RENDERING_CONTEXT } from '@/utils/context';
import { TresBrowserDOMApi, TresPlaceholder } from './tres-api';
import { PerspectiveCamera, Scene, WebGLRenderer, Camera, Raycaster, Vector2 } from 'three';
import type { TresScene } from './types';
import {
  addToTree,
  cId,
  COMPONENT_ID_PROPERTY,
  RENDERED_NODES_PROPERTY,
} from '@/utils/shared';
import { renderElement } from '@/utils/component';
import {
  TRES_CONTEXT,
  createTresContextState,
  createTresContext,
  type TresContext,
} from './context';

export interface TresCanvasProps {
  /** Enable shadows */
  shadows?: boolean;
  /** Pixel ratio (defaults to window.devicePixelRatio) */
  dpr?: number;
  /** Canvas width */
  width?: string;
  /** Canvas height */
  height?: string;
  /** Enable debug mode (shows stats) */
  debug?: boolean;
  /** Error handler */
  onError?: (error: Error) => void;
  /** Called when context is ready */
  onReady?: (context: TresContext) => void;
}

/**
 * TresCanvas - A canvas component for rendering Three.js scenes in GXT
 *
 * Usage:
 * ```gts
 * <TresCanvas>
 *   <TresMesh @position={{array 0 1 0}}>
 *     <TresBoxGeometry @args={{array 1 1 1}} />
 *     <TresMeshNormalMaterial />
 *   </TresMesh>
 * </TresCanvas>
 * ```
 *
 * With options:
 * ```gts
 * <TresCanvas @shadows={{true}} @debug={{true}} @onReady={{this.handleReady}}>
 *   ...
 * </TresCanvas>
 * ```
 */
// @ts-expect-error internal component typing
export function TresCanvas(this: Component<TresCanvasProps>) {
  $_GET_ARGS(this, arguments);
  const args = this.args as TresCanvasProps;

  // Create the canvas element
  const canvasNode = $_tag('canvas', [[], [], []], [], this) as HTMLCanvasElement;
  canvasNode.setAttribute('data-tres', 'tresjs 0.0.1');
  canvasNode.style.display = 'block';
  canvasNode.style.width = args.width ?? '100%';
  canvasNode.style.height = args.height ?? '400px';
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

  // Create context state
  const contextState = createTresContextState(scene);
  const tresContext = createTresContext(contextState);

  // Create a root context for GXT rendering
  const root = {
    [COMPONENT_ID_PROPERTY]: cId(),
    [RENDERED_NODES_PROPERTY]: [],
  } as unknown as Root;

  // Create the Tres DOM API with context reference
  const api = new TresBrowserDOMApi();
  api.setContext(tresContext);

  // Register camera handlers on scene userData
  scene.userData.tres__registerCamera = (camera: Camera) => {
    if (!contextState.cameras.value.includes(camera)) {
      contextState.cameras.update([...contextState.cameras.value, camera]);
    }
    if (!contextState.camera.value) {
      contextState.camera.update(camera);
    }
  };

  scene.userData.tres__deregisterCamera = (camera: Camera) => {
    contextState.cameras.update(contextState.cameras.value.filter((c) => c !== camera));
    if (contextState.camera.value === camera) {
      contextState.camera.update(contextState.cameras.value[0] || null);
    }
  };

  // Register pointer event handlers on scene userData
  scene.userData.tres__registerAtPointerEventHandler = (object: import('three').Object3D) => {
    contextState.interactiveObjects.add(object);
  };

  scene.userData.tres__deregisterAtPointerEventHandler = (object: import('three').Object3D) => {
    contextState.interactiveObjects.delete(object);
  };

  scene.userData.tres__registerBlockingObjectAtPointerEventHandler = (object: import('three').Object3D) => {
    // Blocking objects prevent pointer events from passing through
    object.userData.tres__blockPointerEvents = true;
  };

  scene.userData.tres__deregisterBlockingObjectAtPointerEventHandler = (object: import('three').Object3D) => {
    object.userData.tres__blockPointerEvents = false;
  };

  // Provide the rendering context
  provideContext(root, RENDERING_CONTEXT, api);
  provideContext(root, TRES_CONTEXT, tresContext);

  addToTree(this, root as unknown as Component<any>);

  // Animation loop state
  let animationFrameId: number | null = null;
  let lastTime = 0;

  // Debug/Stats state
  let statsElement: HTMLDivElement | null = null;
  let frameCount = 0;
  let fpsUpdateTime = 0;
  let currentFps = 0;

  // Setup renderer and animation loop after canvas is mounted
  const setupRenderer = () => {
    if (import.meta.env.SSR) return;

    try {
      // Create WebGL renderer
      const renderer = new WebGLRenderer({
        canvas: canvasNode,
        antialias: true,
        alpha: true,
      });

      // Set size
      const width = canvasNode.clientWidth || 400;
      const height = canvasNode.clientHeight || 400;
      renderer.setSize(width, height);
      renderer.setPixelRatio(args.dpr ?? window.devicePixelRatio);

      // Enable shadows if requested
      if (args.shadows) {
        renderer.shadowMap.enabled = true;
      }

      contextState.renderer.update(renderer);

      // Setup raycaster for pointer events
      contextState.raycaster = new Raycaster();
      contextState.pointer = new Vector2();

      // Add default camera if none provided
      if (!contextState.camera.value) {
        const defaultCamera = new PerspectiveCamera(75, width / height, 0.1, 1000);
        defaultCamera.position.set(3, 3, 3);
        defaultCamera.lookAt(0, 0, 0);
        scene.userData.tres__registerCamera?.(defaultCamera);
      }

      // Create debug stats display if debug mode is enabled
      if (args.debug) {
        statsElement = document.createElement('div');
        statsElement.style.cssText = `
          position: absolute;
          top: 0;
          left: 0;
          background: rgba(0, 0, 0, 0.8);
          color: #0f0;
          font-family: monospace;
          font-size: 12px;
          padding: 4px 8px;
          z-index: 1000;
          pointer-events: none;
        `;
        canvasNode.parentElement?.appendChild(statsElement);
      }

      // Call onReady callback
      args.onReady?.(tresContext);

      // Animation loop
      const animate = (time: number) => {
        if (!contextState.renderer.value) return;
        animationFrameId = requestAnimationFrame(animate);

        // Skip rendering if paused
        if (!contextState.isRunning.value) return;

        const delta = (time - lastTime) / 1000;
        lastTime = time;

        // Update FPS counter for debug mode
        if (args.debug && statsElement) {
          frameCount++;
          if (time - fpsUpdateTime >= 1000) {
            currentFps = Math.round((frameCount * 1000) / (time - fpsUpdateTime));
            frameCount = 0;
            fpsUpdateTime = time;
            const renderInfo = renderer.info;
            statsElement.innerHTML = `
              FPS: ${currentFps}<br>
              Triangles: ${renderInfo.render.triangles}<br>
              Calls: ${renderInfo.render.calls}<br>
              Objects: ${scene.children.length}<br>
              ${contextState.isRunning.value ? '' : '<span style="color:orange">PAUSED</span>'}
            `;
          }
        }

        // Run before render callbacks
        contextState.onBeforeRender.forEach((cb) => cb(contextState, delta));

        if (contextState.camera.value) {
          contextState.renderer.value.render(scene, contextState.camera.value);
        }

        // Run after render callbacks
        contextState.onAfterRender.forEach((cb) => cb(contextState, delta));
      };

      animationFrameId = requestAnimationFrame(animate);
    } catch (error) {
      if (args.onError) {
        args.onError(error as Error);
      } else {
        console.error('[TresCanvas] Error setting up renderer:', error);
      }
    }
  };

  // Handle resize
  const handleResize = () => {
    const renderer = contextState.renderer.value;
    const camera = contextState.camera.value;
    if (!renderer || !camera) return;

    const width = canvasNode.clientWidth || 400;
    const height = canvasNode.clientHeight || 400;
    renderer.setSize(width, height);

    if ((camera as PerspectiveCamera).isPerspectiveCamera) {
      (camera as PerspectiveCamera).aspect = width / height;
      (camera as PerspectiveCamera).updateProjectionMatrix();
    }
  };

  // Track current hovered object for pointer enter/leave events
  let currentHovered: import('three').Object3D | null = null;

  // Handle pointer events for raycasting
  const handlePointerMove = (event: PointerEvent) => {
    if (!contextState.pointer || !contextState.raycaster || !contextState.camera.value) return;

    const rect = canvasNode.getBoundingClientRect();
    contextState.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    contextState.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Update raycaster
    contextState.raycaster.setFromCamera(contextState.pointer, contextState.camera.value);
    const intersects = contextState.raycaster.intersectObjects(
      Array.from(contextState.interactiveObjects),
      true
    );

    // Find the first non-blocking interactive object
    let hitObject: import('three').Object3D | null = null;
    for (const intersect of intersects) {
      let current: any = intersect.object;
      while (current) {
        // Check for blocking in both new namespace and legacy
        if (current.userData?.tres?.blockPointerEvents || current.userData?.tres__blockPointerEvents) {
          break;
        }
        // Check for handlers in both new namespace and legacy
        const tresData = current.userData?.tres;
        const hasHandler = (tresData?.onPointerMove || tresData?.onPointerEnter || tresData?.onPointerLeave) ||
          (current.onPointerMove || current.onPointerEnter || current.onPointerLeave);
        if (hasHandler) {
          hitObject = current;
          break;
        }
        current = current.parent;
      }
      if (hitObject) break;
    }

    // Handle pointer enter/leave
    if (hitObject !== currentHovered) {
      // Pointer leave the old object
      if (currentHovered) {
        const leaveHandler = (currentHovered as any).userData?.tres?.onPointerLeave ||
          (currentHovered as any).onPointerLeave;
        if (leaveHandler) {
          leaveHandler({
            object: currentHovered,
            event,
          });
        }
      }

      // Pointer enter the new object
      if (hitObject) {
        const enterHandler = (hitObject as any).userData?.tres?.onPointerEnter ||
          (hitObject as any).onPointerEnter;
        if (enterHandler) {
          enterHandler({
            object: hitObject,
            intersection: intersects[0],
            event,
          });
        }
      }

      currentHovered = hitObject;
    }

    // Call onPointerMove on the hovered object
    if (hitObject) {
      const moveHandler = (hitObject as any).userData?.tres?.onPointerMove ||
        (hitObject as any).onPointerMove;
      if (moveHandler) {
        moveHandler({
          object: hitObject,
          intersection: intersects.find(i => {
            let c: any = i.object;
            while (c) {
              if (c === hitObject) return true;
              c = c.parent;
            }
            return false;
          }),
          event,
        });
      }
    }
  };

  const handleClick = (event: MouseEvent) => {
    if (!contextState.raycaster || !contextState.pointer || !contextState.camera.value) return;

    contextState.raycaster.setFromCamera(contextState.pointer, contextState.camera.value);
    const intersects = contextState.raycaster.intersectObjects(
      Array.from(contextState.interactiveObjects),
      true
    );

    if (intersects.length > 0) {
      const object = intersects[0].object;
      // Traverse up to find the object with onClick handler
      let current: any = object;
      while (current) {
        // Check for blocking in both namespaces
        if (current.userData?.tres?.blockPointerEvents || current.userData?.tres__blockPointerEvents) {
          break;
        }
        // Check for onClick handler in both namespaces
        const clickHandler = current.userData?.tres?.onClick ||
          current.onClick ||
          current.userData?.onClick;
        if (clickHandler) {
          clickHandler({
            object: current,
            intersection: intersects[0],
            event,
          });
          break;
        }
        current = current.parent;
      }
    }
  };

  // ResizeObserver for proper container resize detection
  let resizeObserver: ResizeObserver | null = null;

  // Cleanup function
  const cleanup = () => {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
    }
    if (contextState.renderer.value) {
      contextState.renderer.value.dispose();
    }
    if (statsElement) {
      statsElement.remove();
      statsElement = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (typeof window !== 'undefined') {
      canvasNode.removeEventListener('pointermove', handlePointerMove);
      canvasNode.removeEventListener('click', handleClick);
    }
    contextState.onBeforeRender.clear();
    contextState.onAfterRender.clear();
    contextState.interactiveObjects.clear();
  };

  // Use requestAnimationFrame to delay setup until canvas is in DOM
  if (typeof window !== 'undefined') {
    requestAnimationFrame(() => {
      setupRenderer();

      // Use ResizeObserver for proper container resize detection
      // Falls back to window resize if ResizeObserver is not available
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          handleResize();
        });
        resizeObserver.observe(canvasNode);
      } else {
        window.addEventListener('resize', handleResize);
      }

      canvasNode.addEventListener('pointermove', handlePointerMove);
      canvasNode.addEventListener('click', handleClick);
    });
  }

  // Register cleanup destructor
  registerDestructor(this, cleanup);

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
