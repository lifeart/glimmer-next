import { Suspense, lazy } from '@/utils/suspense';

const TresScene = lazy(() => import('./TresScene.gts').then(m => ({ default: m.TresScene })));

function TresLoadingFallback() {
  return <template>
    <div class='grid grid-cols-1 lg:grid-cols-2 gap-6'>
      <div class='order-1 lg:order-2'>
        <div class='rounded-lg overflow-hidden border border-slate-600 bg-gradient-to-b from-slate-900 to-slate-800 h-[400px] flex items-center justify-center'>
          <div class='text-center'>
            <div class='animate-spin w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full mx-auto mb-4'></div>
            <p class='text-slate-400 text-sm'>Loading Three.js renderer...</p>
            <p class='text-slate-500 text-xs mt-1'>WebGL powered 3D graphics</p>
          </div>
        </div>
      </div>
      <div class='space-y-4 order-2 lg:order-1'>
        <div class='bg-slate-700/50 rounded-lg p-4 animate-pulse'>
          <div class='h-4 w-32 bg-slate-600 rounded mb-4'></div>
          <div class='space-y-3'>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
          </div>
        </div>
        <div class='bg-slate-700/50 rounded-lg p-4 animate-pulse'>
          <div class='h-4 w-32 bg-slate-600 rounded mb-4'></div>
          <div class='space-y-3'>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
          </div>
        </div>
      </div>
    </div>
  </template>;
}

export function TresDemo() {
  return <template>
    <div class='bg-slate-800/50 rounded-xl p-6'>
      <h2 class='text-xl font-semibold mb-4 flex items-center gap-3'>
        <span class='w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center text-sm'>3D</span>
        Three.js Renderer (Tres)
      </h2>
      <p class='text-slate-400 text-sm mb-6'>
        Renders reactive Three.js scenes using a custom renderer inspired by TresJS.
        WebGL-powered 3D graphics with full reactivity support. The renderer is lazy-loaded to keep the main bundle small.
      </p>

      <Suspense @fallback={{TresLoadingFallback}}>
        <TresScene />
      </Suspense>
    </div>
  </template>;
}
