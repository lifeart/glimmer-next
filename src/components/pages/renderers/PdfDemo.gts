import { Suspense, lazy } from '@/utils/suspense';

const PdfDemoContent = lazy(() => import('./PdfDemoContent.gts').then(m => ({ default: m.PdfDemoContent })));

const PdfLoadingFallback = <template>
    <div class='grid grid-cols-1 lg:grid-cols-2 gap-6'>
      <div class='order-1 lg:order-2'>
        <div class='rounded-lg overflow-hidden border border-slate-600 bg-white h-[400px] flex items-center justify-center'>
          <div class='text-center'>
            <div class='animate-spin w-12 h-12 border-4 border-pink-500/30 border-t-pink-500 rounded-full mx-auto mb-4'></div>
            <p class='text-slate-500 text-sm'>Loading PDF renderer...</p>
            <p class='text-slate-400 text-xs mt-1'>Declarative PDF generation</p>
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
          </div>
        </div>
        <div class='bg-slate-700/50 rounded-lg p-4 animate-pulse'>
          <div class='h-4 w-32 bg-slate-600 rounded mb-4'></div>
          <div class='grid grid-cols-2 gap-2'>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
            <div class='h-6 bg-slate-600 rounded'></div>
          </div>
        </div>
      </div>
    </div>
  </template>;

export function PdfDemo() {
  return <template>
    <div class='bg-slate-800/50 rounded-xl p-6' data-test-pdf-demo>
      <h2 class='text-xl font-semibold mb-4 flex items-center gap-3'>
        <span class='w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-pink-500 flex items-center justify-center text-sm'>📄</span>
        PDF Renderer
      </h2>
      <p class='text-slate-400 text-sm mb-6'>
        Build PDF documents using a declarative component-based API. Define document structure with familiar components and reactive styling.
        The renderer is lazy-loaded to keep the main bundle small.
      </p>

      <Suspense @fallback={{PdfLoadingFallback}}>
        <PdfDemoContent />
      </Suspense>
    </div>
  </template>;
}
