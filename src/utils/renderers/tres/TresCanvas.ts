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
    const nodes = $slots.default(root);
    nodes.forEach((node: unknown) => {
      api.insert(canvasNode, node);
    });
    console.log('$slots', nodes);
  });
  // $_slot("default", () => [canvasNode], $slots, self)]
  // @ts-expect-error
  return $_fin([canvasNode], this);
}
