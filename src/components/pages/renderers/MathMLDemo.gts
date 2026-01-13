import { cell, formula, type Cell } from '@lifeart/gxt';

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

function NumberInput({
  label: labelText,
  value,
  onUpdate,
}: {
  label: string;
  value: Cell<number>;
  onUpdate: (cell: Cell<number>, e: InputEvent) => void;
}) {
  return <template>
    <div class='flex items-center gap-2'>
      <span class='text-xs text-slate-400 w-12'>{{labelText}}</span>
      <input
        type='number'
        value={{value.value}}
        {{on 'input' (fn onUpdate value)}}
        class='w-20 px-2 py-1 bg-slate-600 border border-slate-500 rounded text-white text-sm text-center'
      />
    </div>
  </template>;
}

export function MathMLDemo() {
  // Quadratic formula coefficients
  const coeffA = cell(1);
  const coeffB = cell(5);
  const coeffC = cell(6);

  // Fraction values
  const numerator = cell(22);
  const denominator = cell(7);

  // Sum notation
  const sumStart = cell(1);
  const sumEnd = cell(10);

  // Matrix values
  const m11 = cell(1);
  const m12 = cell(0);
  const m21 = cell(0);
  const m22 = cell(1);

  // Computed values
  const fractionResult = formula(() => (numerator.value / denominator.value).toFixed(4));
  const sumResult = formula(() => {
    let total = 0;
    for (let idx = sumStart.value; idx <= sumEnd.value; idx++) {
      total += idx;
    }
    return total;
  });
  const matrixDet = formula(() => m11.value * m22.value - m12.value * m21.value);

  return <template>
    <div class='bg-slate-800/50 rounded-xl p-6'>
      <h2 class='text-xl font-semibold mb-4 flex items-center gap-3'>
        <span class='w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-teal-500 flex items-center justify-center text-sm font-serif italic'>x</span>
        MathML Renderer
      </h2>
      <p class='text-slate-400 text-sm mb-6'>
        Native MathML elements for rendering mathematical notation with reactive values.
      </p>

      <div class='grid grid-cols-1 md:grid-cols-2 gap-6'>
        {{! Quadratic Formula }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-blue-400 mb-3'>Quadratic Formula</h4>
          <div class='bg-white rounded p-4 mb-3 flex justify-center text-slate-900'>
            <math display='block' class='text-xl'>
              <mrow>
                <mi>x</mi>
                <mo>=</mo>
                <mfrac>
                  <mrow>
                    <mo>-</mo>
                    <mn>{{coeffB.value}}</mn>
                    <mo>±</mo>
                    <msqrt>
                      <mrow>
                        <msup>
                          <mn>{{coeffB.value}}</mn>
                          <mn>2</mn>
                        </msup>
                        <mo>-</mo>
                        <mn>4</mn>
                        <mo>·</mo>
                        <mn>{{coeffA.value}}</mn>
                        <mo>·</mo>
                        <mn>{{coeffC.value}}</mn>
                      </mrow>
                    </msqrt>
                  </mrow>
                  <mrow>
                    <mn>2</mn>
                    <mo>·</mo>
                    <mn>{{coeffA.value}}</mn>
                  </mrow>
                </mfrac>
              </mrow>
            </math>
          </div>
          <div class='space-y-2'>
            <p class='text-xs text-slate-400 mb-2'>ax² + bx + c = 0</p>
            <div class='flex flex-wrap gap-3'>
              <NumberInput @label='a' @value={{coeffA}} @onUpdate={{updateCell}} />
              <NumberInput @label='b' @value={{coeffB}} @onUpdate={{updateCell}} />
              <NumberInput @label='c' @value={{coeffC}} @onUpdate={{updateCell}} />
            </div>
          </div>
        </div>

        {{! Fraction }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-purple-400 mb-3'>Fraction</h4>
          <div class='bg-white rounded p-4 mb-3 flex justify-center text-slate-900'>
            <math display='block' class='text-2xl'>
              <mfrac>
                <mn>{{numerator.value}}</mn>
                <mn>{{denominator.value}}</mn>
              </mfrac>
              <mo>≈</mo>
              <mn>{{fractionResult.value}}</mn>
            </math>
          </div>
          <div class='flex flex-wrap gap-3'>
            <NumberInput @label='Num' @value={{numerator}} @onUpdate={{updateCell}} />
            <NumberInput @label='Den' @value={{denominator}} @onUpdate={{updateCell}} />
          </div>
        </div>

        {{! Summation }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-green-400 mb-3'>Summation</h4>
          <div class='bg-white rounded p-4 mb-3 flex justify-center text-slate-900'>
            <math display='block' class='text-xl'>
              <mrow>
                <munderover>
                  <mo>∑</mo>
                  <mrow>
                    <mi>i</mi>
                    <mo>=</mo>
                    <mn>{{sumStart.value}}</mn>
                  </mrow>
                  <mn>{{sumEnd.value}}</mn>
                </munderover>
                <mi>i</mi>
                <mo>=</mo>
                <mn>{{sumResult.value}}</mn>
              </mrow>
            </math>
          </div>
          <div class='flex flex-wrap gap-3'>
            <NumberInput @label='Start' @value={{sumStart}} @onUpdate={{updateCell}} />
            <NumberInput @label='End' @value={{sumEnd}} @onUpdate={{updateCell}} />
          </div>
        </div>

        {{! Matrix }}
        <div class='bg-slate-700/50 rounded-lg p-4'>
          <h4 class='text-sm font-medium text-amber-400 mb-3'>2×2 Matrix</h4>
          <div class='bg-white rounded p-4 mb-3 flex justify-center text-slate-900'>
            <math display='block' class='text-xl'>
              <mrow>
                <mo>[</mo>
                <mtable>
                  <mtr>
                    <mtd><mn>{{m11.value}}</mn></mtd>
                    <mtd><mn>{{m12.value}}</mn></mtd>
                  </mtr>
                  <mtr>
                    <mtd><mn>{{m21.value}}</mn></mtd>
                    <mtd><mn>{{m22.value}}</mn></mtd>
                  </mtr>
                </mtable>
                <mo>]</mo>
              </mrow>
            </math>
          </div>
          <div class='grid grid-cols-2 gap-2'>
            <NumberInput @label='[1,1]' @value={{m11}} @onUpdate={{updateCell}} />
            <NumberInput @label='[1,2]' @value={{m12}} @onUpdate={{updateCell}} />
            <NumberInput @label='[2,1]' @value={{m21}} @onUpdate={{updateCell}} />
            <NumberInput @label='[2,2]' @value={{m22}} @onUpdate={{updateCell}} />
          </div>
          <p class='text-xs text-slate-400 mt-2'>
            det = {{matrixDet.value}}
          </p>
        </div>
      </div>
    </div>
  </template>;
}
