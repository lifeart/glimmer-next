import {
  $_tag,
  $_fin,
  Component,
  $_GET_ARGS,
  $_GET_SLOTS,
  $_slot,
  Root,
} from '@lifeart/gxt';
import {
  getContext,
  provideContext,
  RENDERING_CONTEXT,
  ROOT_CONTEXT,
} from '@/utils/context';
import { TresBrowserDOMApi } from './tres-api';
import { useTresContextProvider } from './useTresContextProvider';
import { PerspectiveCamera, Scene } from 'three';
import { TresScene } from './types';
import { watchEffect } from './vue';

// <canvas
//     ref="canvas"
//     :data-scene="scene.uuid"
//     :class="$attrs.class"
//     :data-tres="`tresjs ${pkg.version}`"
//     :style="{
//       display: 'block',
//       width: '100%',
//       height: '100%',
//       position: windowSize ? 'fixed' : 'relative',
//       top: 0,
//       left: 0,
//       pointerEvents: 'auto',
//       touchAction: 'none',
//       ...$attrs.style as Object,
//     }"
//   ></canvas>

export function TresCanvas(this: Component) {
  $_GET_ARGS(this, arguments);
  const canvasNode = $_tag(
    'canvas',
    [[], [], []],
    [],
    this,
  ) as HTMLCanvasElement;
  canvasNode.setAttribute('data-tres', 'tresjs 0.0.0');
  canvasNode.style.display = 'block';
  canvasNode.style.border = '1px solid red';
  canvasNode.style.width = '100%';
  canvasNode.style.height = '100%';
  canvasNode.style.position = 'relative';
  canvasNode.style.top = '0';
  canvasNode.style.left = '0';
  canvasNode.style.pointerEvents = 'auto';

  const $slots = $_GET_SLOTS(this, arguments);

  const api = new TresBrowserDOMApi();
  const root = {} as Root;
  provideContext(root, RENDERING_CONTEXT, api);
  requestAnimationFrame(() => {
    const existingCanvas = canvasNode;
    const scene = new Scene();


    const nodes = $slots.default(root);
    nodes.forEach((node: unknown) => {
      api.insert(scene, node);
    });

    let context = useTresContextProvider({
      scene: scene as TresScene,
      canvas: existingCanvas,
      windowSize: false,
      rendererOptions: {},
      emit: {},
    });
    const { registerCamera, camera, cameras, deregisterCamera } = context;

    console.log({
      registerCamera, camera, cameras, deregisterCamera
    })


    const addDefaultCamera = () => {
      const camera = new PerspectiveCamera(
        45,
        window.innerWidth / window.innerHeight,
        0.1,
        1000,
      )
      camera.position.set(3, 3, 3)
      camera.lookAt(0, 0, 0)
      registerCamera(camera)
  
      const unwatch = watchEffect(() => {
        if (cameras.value.length >= 2) {
          camera.removeFromParent()
          deregisterCamera(camera)
          unwatch?.()
        }
      })
    }

    // debugger;
    if (!camera.value) {
      console.warn(
        'No camera found. Creating a default perspective camera. '
        + 'To have full control over a camera, please add one to the scene.',
      )
      addDefaultCamera()
    }
  
  
    // mountCustomRenderer(context);

    console.log('$slots', nodes);
  });
  // $_slot("default", () => [canvasNode], $slots, self)]
  // @ts-expect-error
  return $_fin([canvasNode], this);
}
