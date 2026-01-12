import { cell, type Cell } from '@lifeart/gxt';

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

function RangeControl({
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
    <div class='flex items-center gap-2'>
      <span class='text-xs text-slate-400 w-16'>{{labelText}}</span>
      <input
        type='range'
        value={{value.value}}
        min={{min}}
        max={{max}}
        {{on 'input' (fn onUpdate value)}}
        class='flex-1 h-1 bg-slate-600 rounded appearance-none cursor-pointer accent-blue-500'
      />
      <span class='text-xs text-slate-300 w-8 text-right'>{{value.value}}</span>
    </div>
  </template>;
}

function ColorControl({
  label: labelText,
  value,
  onUpdate,
}: {
  label: string;
  value: Cell<string>;
  onUpdate: (cell: Cell<string>, e: InputEvent) => void;
}) {
  return <template>
    <div class='flex items-center gap-2'>
      <span class='text-xs text-slate-400 w-16'>{{labelText}}</span>
      <input
        type='color'
        value={{value.value}}
        {{on 'input' (fn onUpdate value)}}
        class='w-6 h-6 rounded cursor-pointer border-0 p-0'
      />
      <span class='text-xs text-slate-300 font-mono'>{{value.value}}</span>
    </div>
  </template>;
}

export function SVGDemo() {
  // Circle state
  const cx = cell(100);
  const cy = cell(80);
  const circleR = cell(40);
  const circleFill = cell('#3b82f6');

  // Rectangle state
  const rectX = cell(180);
  const rectY = cell(40);
  const rectWidth = cell(80);
  const rectHeight = cell(80);
  const rectFill = cell('#8b5cf6');
  const rectRx = cell(8);

  // Polygon (star) state
  const starScale = cell(1);
  const starFill = cell('#f59e0b');
  const starRotation = cell(0);

  // Path state
  const pathColor = cell('#10b981');
  const pathWidth = cell(3);

  return <template>
    <div class='bg-slate-800/50 rounded-xl p-6'>
      <h2 class='text-xl font-semibold mb-4 flex items-center gap-3'>
        <span class='w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-sm'>
          <svg class='w-4 h-4' viewBox='0 0 24 24' fill='currentColor'>
            <path d='M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5'/>
          </svg>
        </span>
        SVG Renderer
      </h2>
      <p class='text-slate-400 text-sm mb-6'>
        Native SVG elements with reactive attributes. SVG namespace is automatically handled.
      </p>

      <div class='grid grid-cols-1 lg:grid-cols-2 gap-6'>
        {{! SVG Preview }}
        <div class='order-1 lg:order-2'>
          <h3 class='text-sm font-medium text-slate-400 mb-3'>Live Preview</h3>
          <div class='rounded-lg overflow-hidden border border-slate-600 bg-white p-2'>
            <svg viewBox='0 0 300 160' class='w-full h-40'>
              {{! Background grid }}
              <defs>
                <pattern id='grid' width='20' height='20' patternUnits='userSpaceOnUse'>
                  <path d='M 20 0 L 0 0 0 20' fill='none' stroke='#e5e7eb' stroke-width='0.5'/>
                </pattern>
              </defs>
              <rect width='100%' height='100%' fill='url(#grid)'/>

              {{! Circle }}
              <circle
                cx={{cx.value}}
                cy={{cy.value}}
                r={{circleR.value}}
                fill={{circleFill.value}}
                opacity='0.9'
              />

              {{! Rounded Rectangle }}
              <rect
                x={{rectX.value}}
                y={{rectY.value}}
                width={{rectWidth.value}}
                height={{rectHeight.value}}
                rx={{rectRx.value}}
                fill={{rectFill.value}}
                opacity='0.9'
              />

              {{! Star polygon }}
              <g transform="translate(50, 80)">
                <polygon
                  points='25,0 31,18 50,18 35,29 41,47 25,36 9,47 15,29 0,18 19,18'
                  fill={{starFill.value}}
                  transform="scale({{starScale.value}}) rotate({{starRotation.value}}, 25, 25)"
                  opacity='0.9'
                />
              </g>

              {{! Curved path }}
              <path
                d='M 220 140 Q 250 100 280 140'
                stroke={{pathColor.value}}
                stroke-width={{pathWidth.value}}
                fill='none'
                stroke-linecap='round'
              />
            </svg>
          </div>
          <p class='mt-2 text-xs text-slate-500'>
            SVG elements render natively with full reactivity.
          </p>
        </div>

        {{! Controls }}
        <div class='space-y-4 order-2 lg:order-1'>
          {{! Circle Controls }}
          <div class='bg-slate-700/50 rounded-lg p-3'>
            <h4 class='text-sm font-medium text-blue-400 mb-2 flex items-center gap-2'>
              <span class='w-2 h-2 rounded-full bg-blue-400'></span>
              Circle
            </h4>
            <div class='space-y-2'>
              <RangeControl @label='X' @value={{cx}} @min={{20}} @max={{280}} @onUpdate={{updateCell}} />
              <RangeControl @label='Y' @value={{cy}} @min={{20}} @max={{140}} @onUpdate={{updateCell}} />
              <RangeControl @label='Radius' @value={{circleR}} @min={{10}} @max={{60}} @onUpdate={{updateCell}} />
              <ColorControl @label='Fill' @value={{circleFill}} @onUpdate={{updateCell}} />
            </div>
          </div>

          {{! Rectangle Controls }}
          <div class='bg-slate-700/50 rounded-lg p-3'>
            <h4 class='text-sm font-medium text-purple-400 mb-2 flex items-center gap-2'>
              <span class='w-2 h-2 rounded bg-purple-400'></span>
              Rectangle
            </h4>
            <div class='space-y-2'>
              <RangeControl @label='X' @value={{rectX}} @min={{100}} @max={{220}} @onUpdate={{updateCell}} />
              <RangeControl @label='Y' @value={{rectY}} @min={{10}} @max={{100}} @onUpdate={{updateCell}} />
              <RangeControl @label='Corner' @value={{rectRx}} @min={{0}} @max={{40}} @onUpdate={{updateCell}} />
              <ColorControl @label='Fill' @value={{rectFill}} @onUpdate={{updateCell}} />
            </div>
          </div>

          {{! Star Controls }}
          <div class='bg-slate-700/50 rounded-lg p-3'>
            <h4 class='text-sm font-medium text-amber-400 mb-2 flex items-center gap-2'>
              <span class='text-amber-400'>★</span>
              Star
            </h4>
            <div class='space-y-2'>
              <RangeControl @label='Scale' @value={{starScale}} @min={{0}} @max={{2}} @onUpdate={{updateCell}} />
              <RangeControl @label='Rotate' @value={{starRotation}} @min={{0}} @max={{360}} @onUpdate={{updateCell}} />
              <ColorControl @label='Fill' @value={{starFill}} @onUpdate={{updateCell}} />
            </div>
          </div>

          {{! Path Controls }}
          <div class='bg-slate-700/50 rounded-lg p-3'>
            <h4 class='text-sm font-medium text-green-400 mb-2 flex items-center gap-2'>
              <span class='w-3 h-0.5 bg-green-400 rounded'></span>
              Path
            </h4>
            <div class='space-y-2'>
              <RangeControl @label='Width' @value={{pathWidth}} @min={{1}} @max={{8}} @onUpdate={{updateCell}} />
              <ColorControl @label='Stroke' @value={{pathColor}} @onUpdate={{updateCell}} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </template>;
}
