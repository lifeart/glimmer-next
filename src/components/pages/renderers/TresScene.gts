import { cell, type Cell, formula } from '@lifeart/gxt';
import { TresCanvas } from '@/core/renderers/tres/TresCanvas';

function updateCell(
  el: Cell<any>,
  e: InputEvent & { target: HTMLInputElement },
) {
  const type = e.target.type;
  if (type === 'number' || type === 'range') {
    el.update(e.target.valueAsNumber);
  } else if (type === 'color') {
    el.update(e.target.value);
  } else {
    el.update(e.target.value);
  }
}

function RangeInput({
  label: labelText,
  value,
  min,
  max,
  step = 0.1,
  onUpdate,
  accentColor = 'cyan',
}: {
  label: string;
  value: Cell<number>;
  min: number;
  max: number;
  step?: number;
  onUpdate: (cell: Cell<number>, e: InputEvent) => void;
  accentColor?: string;
}) {
  const colorClass = formula(() => {
    const colors: Record<string, string> = {
      cyan: 'accent-cyan-500',
      purple: 'accent-purple-500',
      green: 'accent-green-500',
      orange: 'accent-orange-500',
      pink: 'accent-pink-500',
    };
    return colors[accentColor] || 'accent-cyan-500';
  });

  return <template>
    <div class='space-y-1'>
      <label class='text-xs text-slate-400 uppercase tracking-wide flex justify-between'>
        <span>{{labelText}}</span>
        <span class='font-mono'>{{value.value}}</span>
      </label>
      <input
        type='range'
        value={{value.value}}
        min={{min}}
        max={{max}}
        step={{step}}
        {{on 'input' (fn onUpdate value)}}
        class='w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer {{colorClass.value}}'
      />
    </div>
  </template>;
}

function ColorPicker({
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
      <div class='flex gap-2 items-center'>
        <input
          type='color'
          value={{value.value}}
          {{on 'input' (fn onUpdate value)}}
          class='w-8 h-8 rounded cursor-pointer border border-slate-600'
        />
        <span class='text-xs font-mono text-slate-500'>{{value.value}}</span>
      </div>
    </div>
  </template>;
}

export function TresScene() {
  // Main cube controls
  const posX = cell(0);
  const posY = cell(0.5);
  const posZ = cell(0);

  const rotX = cell(0);
  const rotY = cell(0);
  const rotZ = cell(0);

  const scale = cell(1);

  // Torus knot controls
  const torusRotation = cell(0);
  const torusScale = cell(0.5);

  // Sphere controls
  const spherePosX = cell(-2);
  const sphereColor = cell('#ff6b6b');

  // Animation state
  const isAnimating = cell(true);

  // Animation callback - will be registered via TresCanvas onReady
  // and automatically cleaned up when TresCanvas is destroyed
  const onCanvasReady = (context: import('@/core/renderers/tres/context').TresContext) => {
    context.onBeforeRender(() => {
      if (isAnimating.value) {
        rotY.update(rotY.value + 0.01);
        torusRotation.update(torusRotation.value + 0.02);
      }
    });
  };

  const toggleAnimation = () => {
    isAnimating.update(!isAnimating.value);
  };

  const resetTransforms = () => {
    posX.update(0);
    posY.update(0.5);
    posZ.update(0);
    rotX.update(0);
    rotY.update(0);
    rotZ.update(0);
    scale.update(1);
    torusScale.update(0.5);
    spherePosX.update(-2);
  };

  return <template>
    <div class='grid grid-cols-1 lg:grid-cols-2 gap-6'>
      {{! Three.js Preview }}
      <div class='order-1 lg:order-2'>
        <div class='flex items-center justify-between mb-3'>
          <h3 class='text-sm font-medium text-slate-400'>Live Preview</h3>
          <div class='flex gap-2'>
            <button
              {{on 'click' toggleAnimation}}
              class='px-3 py-1 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors {{if isAnimating.value "text-cyan-400" "text-slate-400"}}'
            >
              {{if isAnimating.value "Pause" "Play"}}
            </button>
            <button
              {{on 'click' resetTransforms}}
              class='px-3 py-1 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 transition-colors'
            >
              Reset
            </button>
          </div>
        </div>
        <div class='rounded-lg overflow-hidden border border-slate-600 bg-gradient-to-b from-slate-900 to-slate-800'>
          <TresCanvas @onReady={{onCanvasReady}}>
            {{! Main interactive cube }}
            <TresMesh
              position-x={{posX.value}}
              position-y={{posY.value}}
              position-z={{posZ.value}}
              rotation-x={{rotX.value}}
              rotation-y={{rotY.value}}
              rotation-z={{rotZ.value}}
              scale-x={{scale.value}}
              scale-y={{scale.value}}
              scale-z={{scale.value}}
            >
              <TresBoxGeometry @args={{array 1 1 1}} />
              <TresMeshNormalMaterial />
            </TresMesh>

            {{! Torus knot decoration }}
            <TresMesh
              position-x={{2}}
              position-y={{0.5}}
              position-z={{0}}
              rotation-y={{torusRotation.value}}
              scale-x={{torusScale.value}}
              scale-y={{torusScale.value}}
              scale-z={{torusScale.value}}
            >
              <TresTorusKnotGeometry @args={{array 0.8 0.3 100 16}} />
              <TresMeshNormalMaterial />
            </TresMesh>

            {{! Animated sphere }}
            <TresMesh
              position-x={{spherePosX.value}}
              position-y={{0.5}}
              position-z={{0}}
            >
              <TresSphereGeometry @args={{array 0.5 32 32}} />
              <TresMeshBasicMaterial color={{sphereColor.value}} />
            </TresMesh>

            {{! Ground plane }}
            <TresMesh
              position-y={{-0.5}}
              rotation-x={{-1.5708}}
            >
              <TresPlaneGeometry @args={{array 10 10}} />
              <TresMeshBasicMaterial color={{0x2a2a3a}} />
            </TresMesh>
          </TresCanvas>
        </div>
        <p class='mt-2 text-xs text-slate-500 text-center'>
          Interactive WebGL scene with reactive controls. Drag sliders to transform objects.
        </p>
      </div>

      {{! Controls }}
      <div class='space-y-4 order-2 lg:order-1'>
        {{! Cube Position Controls }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-cyan-400 mb-3 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-cyan-400'></span>
            Cube Position
          </h4>
          <div class='space-y-3'>
            <RangeInput @label='X' @value={{posX}} @min={{-3}} @max={{3}} @step={{0.1}} @onUpdate={{updateCell}} @accentColor='cyan' />
            <RangeInput @label='Y' @value={{posY}} @min={{-2}} @max={{3}} @step={{0.1}} @onUpdate={{updateCell}} @accentColor='cyan' />
            <RangeInput @label='Z' @value={{posZ}} @min={{-3}} @max={{3}} @step={{0.1}} @onUpdate={{updateCell}} @accentColor='cyan' />
          </div>
        </div>

        {{! Cube Rotation Controls }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-purple-400 mb-3 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-purple-400'></span>
            Cube Rotation
          </h4>
          <div class='space-y-3'>
            <RangeInput @label='X' @value={{rotX}} @min={{0}} @max={{6.28}} @step={{0.05}} @onUpdate={{updateCell}} @accentColor='purple' />
            <RangeInput @label='Y' @value={{rotY}} @min={{0}} @max={{6.28}} @step={{0.05}} @onUpdate={{updateCell}} @accentColor='purple' />
            <RangeInput @label='Z' @value={{rotZ}} @min={{0}} @max={{6.28}} @step={{0.05}} @onUpdate={{updateCell}} @accentColor='purple' />
          </div>
        </div>

        {{! Scale & Torus Controls }}
        <div class='grid grid-cols-2 gap-4'>
          <div class='bg-slate-700/50 rounded-lg p-4'>
            <h4 class='text-sm font-medium text-green-400 mb-3 flex items-center gap-2'>
              <span class='w-2 h-2 rounded-full bg-green-400'></span>
              Cube Scale
            </h4>
            <RangeInput @label='Size' @value={{scale}} @min={{0.2}} @max={{2}} @step={{0.1}} @onUpdate={{updateCell}} @accentColor='green' />
          </div>

          <div class='bg-slate-700/50 rounded-lg p-4'>
            <h4 class='text-sm font-medium text-orange-400 mb-3 flex items-center gap-2'>
              <span class='w-2 h-2 rounded-full bg-orange-400'></span>
              Torus Scale
            </h4>
            <RangeInput @label='Size' @value={{torusScale}} @min={{0.2}} @max={{1.5}} @step={{0.1}} @onUpdate={{updateCell}} @accentColor='orange' />
          </div>
        </div>

        {{! Sphere Controls }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-pink-400 mb-3 flex items-center gap-2'>
            <span class='w-2 h-2 rounded-full bg-pink-400'></span>
            Sphere
          </h4>
          <div class='grid grid-cols-2 gap-4'>
            <RangeInput @label='Position X' @value={{spherePosX}} @min={{-3}} @max={{3}} @step={{0.1}} @onUpdate={{updateCell}} @accentColor='pink' />
            <ColorPicker @label='Color' @value={{sphereColor}} @onUpdate={{updateCell}} />
          </div>
        </div>
      </div>
    </div>
  </template>;
}
