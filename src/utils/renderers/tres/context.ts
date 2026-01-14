/**
 * Tres Context - Provides access to Three.js scene, camera, and renderer
 */
import { type Cell, cell } from '@lifeart/gxt';
import type { Camera, Scene, WebGLRenderer, Object3D, Raycaster, Vector2 } from 'three';

export const TRES_CONTEXT = Symbol('TRES_CONTEXT');

export interface TresContextState {
  scene: Scene;
  camera: Cell<Camera | null>;
  cameras: Cell<Camera[]>;
  renderer: Cell<WebGLRenderer | null>;
  raycaster: Raycaster | null;
  pointer: Vector2 | null;

  // Loop callbacks
  onBeforeRender: Set<(state: TresContextState, delta: number) => void>;
  onAfterRender: Set<(state: TresContextState, delta: number) => void>;

  // Event handlers registry
  interactiveObjects: Set<Object3D>;

  // Render loop control
  isRunning: Cell<boolean>;
}

export interface TresContext {
  /** The Three.js scene */
  scene: Scene;

  /** Get the active camera */
  getCamera(): Camera | null;

  /** Get all registered cameras */
  getCameras(): Camera[];

  /** Get the WebGL renderer */
  getRenderer(): WebGLRenderer | null;

  /** Register a callback to run before each render */
  onBeforeRender(callback: (state: TresContextState, delta: number) => void): () => void;

  /** Register a callback to run after each render */
  onAfterRender(callback: (state: TresContextState, delta: number) => void): () => void;

  /** Register an object for pointer events */
  registerInteractiveObject(object: Object3D): void;

  /** Unregister an object from pointer events */
  unregisterInteractiveObject(object: Object3D): void;

  /** Pause the render loop */
  pause(): void;

  /** Resume the render loop */
  resume(): void;

  /** Check if the render loop is running */
  isRunning(): boolean;

  /** Internal state (for advanced use) */
  state: TresContextState;
}

/**
 * Create a new Tres context state
 */
export function createTresContextState(scene: Scene): TresContextState {
  return {
    scene,
    camera: cell<Camera | null>(null),
    cameras: cell<Camera[]>([]),
    renderer: cell<WebGLRenderer | null>(null),
    raycaster: null,
    pointer: null,
    onBeforeRender: new Set(),
    onAfterRender: new Set(),
    interactiveObjects: new Set(),
    isRunning: cell<boolean>(true),
  };
}

/**
 * Create a Tres context from state
 */
export function createTresContext(state: TresContextState): TresContext {
  return {
    scene: state.scene,

    getCamera() {
      return state.camera.value;
    },

    getCameras() {
      return state.cameras.value;
    },

    getRenderer() {
      return state.renderer.value;
    },

    onBeforeRender(callback) {
      state.onBeforeRender.add(callback);
      return () => state.onBeforeRender.delete(callback);
    },

    onAfterRender(callback) {
      state.onAfterRender.add(callback);
      return () => state.onAfterRender.delete(callback);
    },

    registerInteractiveObject(object) {
      state.interactiveObjects.add(object);
    },

    unregisterInteractiveObject(object) {
      state.interactiveObjects.delete(object);
    },

    pause() {
      state.isRunning.update(false);
    },

    resume() {
      state.isRunning.update(true);
    },

    isRunning() {
      return state.isRunning.value;
    },

    state,
  };
}
