import { cell, formula, type Cell } from '@lifeart/gxt';
import { CanvasRenderer } from '@/utils/renderers/canvas';

function updateCell(
  el: Cell<any>,
  e: InputEvent & { target: HTMLInputElement },
) {
  if (e.target.type === 'number' || e.target.type === 'range') {
    el.update(e.target.valueAsNumber);
  } else {
    el.update(e.target.value);
  }
}

function ColorInput({
  label: labelText,
  value,
  onUpdate,
}: {
  label: string;
  value: Cell<string>;
  onUpdate: (cell: Cell<string>, e: InputEvent) => void;
}) {
  return <template>
    <div class='space-y-1'>
      <label class='text-xs text-slate-400 uppercase tracking-wide'>{{labelText}}</label>
      <div class='flex items-center gap-2'>
        <input
          type='color'
          value={{value.value}}
          {{on 'input' (fn onUpdate value)}}
          class='w-8 h-8 rounded cursor-pointer border-0 p-0'
        />
        <input
          type='text'
          value={{value.value}}
          {{on 'input' (fn onUpdate value)}}
          class='flex-1 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-xs font-mono'
        />
      </div>
    </div>
  </template>;
}

function RangeInput({
  label: labelText,
  value,
  min,
  max,
  onUpdate,
}: {
  label: string;
  value: Cell<number>;
  min: number;
  max: number;
  onUpdate: (cell: Cell<number>, e: InputEvent) => void;
}) {
  return <template>
    <div class='space-y-1'>
      <label class='text-xs text-slate-400 uppercase tracking-wide'>{{labelText}}: {{value.value}}</label>
      <input
        type='range'
        value={{value.value}}
        min={{min}}
        max={{max}}
        {{on 'input' (fn onUpdate value)}}
        class='w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500'
      />
    </div>
  </template>;
}

export function CanvasDemo() {
  // Text primitive state
  const textContent = cell('Hello Canvas!');
  const textX = cell(20);
  const textY = cell(30);
  const textColor = cell('#3b82f6');
  const fontSize = cell(24);

  // Rectangle state
  const rectX = cell(200);
  const rectY = cell(60);
  const rectW = cell(120);
  const rectH = cell(80);
  const rectFill = cell('#8b5cf6');

  // Circle state
  const circleX = cell(100);
  const circleY = cell(120);
  const circleR = cell(40);
  const circleFill = cell('#10b981');

  // Line state
  const lineX1 = cell(250);
  const lineY1 = cell(20);
  const lineX2 = cell(380);
  const lineY2 = cell(180);
  const lineColor = cell('#f59e0b');
  const lineWidth = cell(3);

  const fontSpec = formula(
    () => `${fontSize.value}px Inter, system-ui, sans-serif`,
  );

  return <template>
    <div class='bg-slate-800/50 rounded-xl p-6'>
      <h2 class='text-xl font-semibold mb-4 flex items-center gap-3'>
        <span class='w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center text-sm'>🎨</span>
        Canvas Renderer
      </h2>
      <p class='text-slate-400 text-sm mb-6'>
        Renders reactive primitives to an HTML Canvas element with retina display support.
      </p>

      <div class='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        {{! Canvas Preview }}
        <div class='order-1 lg:order-2'>
          <h3 class='text-sm font-medium text-slate-400 mb-3'>Live Preview</h3>
          <div class='rounded-lg overflow-hidden border border-slate-600 bg-white'>
            <CanvasRenderer>
              <rect
                x={{rectX.value}}
                y={{rectY.value}}
                width={{rectW.value}}
                height={{rectH.value}}
                fillStyle={{rectFill.value}}
              />
              <circle
                cx={{circleX.value}}
                cy={{circleY.value}}
                r={{circleR.value}}
                fillStyle={{circleFill.value}}
              />
              <line
                x1={{lineX1.value}}
                y1={{lineY1.value}}
                x2={{lineX2.value}}
                y2={{lineY2.value}}
                strokeStyle={{lineColor.value}}
                lineWidth={{lineWidth.value}}
              />
              <text
                x={{textX.value}}
                y={{textY.value}}
                font={{fontSpec.value}}
                fillStyle={{textColor.value}}
              >{{textContent.value}}</text>
            </CanvasRenderer>
          </div>
          <p class='mt-2 text-xs text-slate-500'>
            Scaled for retina displays using devicePixelRatio.
          </p>
        </div>

        {{! Controls }}
        <div class='space-y-4 order-2 lg:order-1'>
          {{! Text Controls }}
          <div class='bg-slate-700/50 rounded-lg p-3'>
            <h4 class='text-sm font-medium text-blue-400 mb-2 flex items-center gap-2'>
              <span class='w-2 h-2 rounded-full bg-blue-400'></span>
              Text
            </h4>
            <div class='grid grid-cols-2 gap-2'>
              <div class='col-span-2 space-y-1'>
                <label class='text-xs text-slate-400'>Content</label>
                <input
                  type='text'
                  value={{textContent.value}}
                  {{on 'input' (fn updateCell textContent)}}
                  class='w-full px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm'
                />
              </div>
              <RangeInput @label='X' @value={{textX}} @min={{0}} @max={{350}} @onUpdate={{updateCell}} />
              <RangeInput @label='Y' @value={{textY}} @min={{10}} @max={{150}} @onUpdate={{updateCell}} />
              <RangeInput @label='Size' @value={{fontSize}} @min={{12}} @max={{48}} @onUpdate={{updateCell}} />
              <ColorInput @label='Color' @value={{textColor}} @onUpdate={{updateCell}} />
            </div>
          </div>

          {{! Shape Controls }}
          <div class='grid grid-cols-2 gap-3'>
            <div class='bg-slate-700/50 rounded-lg p-3'>
              <h4 class='text-sm font-medium text-purple-400 mb-2 flex items-center gap-2'>
                <span class='w-2 h-2 rounded bg-purple-400'></span>
                Rectangle
              </h4>
              <div class='space-y-2'>
                <RangeInput @label='X' @value={{rectX}} @min={{0}} @max={{300}} @onUpdate={{updateCell}} />
                <RangeInput @label='Y' @value={{rectY}} @min={{0}} @max={{100}} @onUpdate={{updateCell}} />
                <ColorInput @label='Fill' @value={{rectFill}} @onUpdate={{updateCell}} />
              </div>
            </div>

            <div class='bg-slate-700/50 rounded-lg p-3'>
              <h4 class='text-sm font-medium text-green-400 mb-2 flex items-center gap-2'>
                <span class='w-2 h-2 rounded-full bg-green-400'></span>
                Circle
              </h4>
              <div class='space-y-2'>
                <RangeInput @label='X' @value={{circleX}} @min={{0}} @max={{380}} @onUpdate={{updateCell}} />
                <RangeInput @label='Y' @value={{circleY}} @min={{0}} @max={{150}} @onUpdate={{updateCell}} />
                <ColorInput @label='Fill' @value={{circleFill}} @onUpdate={{updateCell}} />
              </div>
            </div>
          </div>

          {{! Line Controls }}
          <div class='bg-slate-700/50 rounded-lg p-3'>
            <h4 class='text-sm font-medium text-amber-400 mb-2 flex items-center gap-2'>
              <span class='w-4 h-0.5 bg-amber-400 rounded'></span>
              Line
            </h4>
            <div class='grid grid-cols-2 gap-2'>
              <RangeInput @label='X1' @value={{lineX1}} @min={{0}} @max={{400}} @onUpdate={{updateCell}} />
              <RangeInput @label='Y1' @value={{lineY1}} @min={{0}} @max={{160}} @onUpdate={{updateCell}} />
              <RangeInput @label='X2' @value={{lineX2}} @min={{0}} @max={{400}} @onUpdate={{updateCell}} />
              <RangeInput @label='Y2' @value={{lineY2}} @min={{0}} @max={{160}} @onUpdate={{updateCell}} />
              <RangeInput @label='Width' @value={{lineWidth}} @min={{1}} @max={{10}} @onUpdate={{updateCell}} />
              <ColorInput @label='Stroke' @value={{lineColor}} @onUpdate={{updateCell}} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>;
}
