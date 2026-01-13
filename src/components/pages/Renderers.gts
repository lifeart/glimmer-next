import { CanvasDemo } from './renderers/CanvasDemo.gts';
import { SVGDemo } from './renderers/SVGDemo.gts';
import { MathMLDemo } from './renderers/MathMLDemo.gts';
import { TresDemo } from './renderers/TresDemo.gts';

export function Renderers() {
  return <template>
    <div class='text-white p-6 max-w-6xl mx-auto'>
      <h1 class='text-3xl font-bold mb-2'>Custom Renderers</h1>
      <p class='text-slate-400 mb-8'>
        Demonstrating the framework's ability to render to different targets: Canvas, SVG, MathML, and Three.js (WebGL).
        Each renderer handles its namespace automatically while maintaining full reactivity.
      </p>

      <div class='space-y-8'>
        <TresDemo />
        <CanvasDemo />
        <SVGDemo />
        <MathMLDemo />
      </div>

      <div class='mt-8 flex gap-4'>
        <a
          href='/pageOne'
          class='inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors'
        >
          ← Back to Page One
        </a>
      </div>
    </div>
  </template>;
}
