import { type Cell, cell } from '@lifeart/gxt';
import { Smile } from './page-one/Smile';
import { Table } from './page-one/Table.gts';
import { CanvasRenderer } from '@/utils/renderers/canvas';

function Controls() {
  const color = cell('red');

  const intervalId = setInterval(() => {
    color.update(Math.random() > 0.5 ? 'red' : 'blue');
  }, 1000);

  function onDestroy(_?: any) {
    return () => {
      console.log('destroying interval');
      clearInterval(intervalId);
    };
  }

  return <template>
    <h1><q {{onDestroy}} style.background-color={{color}}>Compilers are the New
        Frameworks</q>
      - Tom Dale &copy;</h1>
  </template>;
}

const tx = cell('hello');
const x = cell(10);
const y = cell(50);
const font = cell('48px serif');
const fillStyle = cell('red');
const isVisible = cell(false);
const list = cell([1, 2, 3]);

// setInterval(() => {
//   // shuffle list
//   list.update(list.value.slice().reverse());
// }, 3000);

function update(el: Cell<any>, e: InputEvent & { target: HTMLInputElement }) {
  if (e.target.type === 'number') {
    el.update(e.target.valueAsNumber);
  } else if (e.target.type === 'checkbox') {
    el.update(e.target.checked);
  } else {
    el.update(e.target.value);
  }
}

const add = (v1: number, v2: number) => {
  return v1 + v2;
};
const mult = (v1: number, v2: number) => {
  return v1 * v2;
};

export function PageOne() {
  return <template>
    <div class='text-white p-3'>
      <Controls />
      <br />
      <input
        style.color='black'
        value={{tx.value}}
        {{on 'input' (fn update tx)}}
      />
      <input
        style.color='black'
        value={{font.value}}
        {{on 'input' (fn update font)}}
      />
      <input
        style.color='black'
        value={{fillStyle.value}}
        {{on 'input' (fn update fillStyle)}}
      />
      <input
        style.color='black'
        value={{x.value}}
        type='number'
        {{on 'input' (fn update x)}}
      />
      <input
        style.color='black'
        value={{y.value}}
        type='number'
        {{on 'input' (fn update y)}}
      />
      <input
        style.color='black'
        value={{isVisible.value}}
        type='checkbox'
        {{on 'change' (fn update isVisible)}}
      />
      <CanvasRenderer>
        <text
          x={{x.value}}
          y={{y.value}}
          font={{font.value}}
          fillStyle={{fillStyle.value}}
        >{{tx.value}}</text>

        {{#if isVisible}}
          {{#each list sync=true as |n i|}}
            <text
              x={{add 40 (mult (mult n i) 8)}}
              y={{add 70 (mult (mult n i) 8)}}
            >{{n}}</text>
          {{/each}}
        {{else}}
          <text x={{30}} y={{60}}>foo</text>
        {{/if}}
      </CanvasRenderer>
      <div>Imagine a world where the robust, mature ecosystems of development
        tools meet the cutting-edge performance of modern compilers. That's what
        we're building here! Our platform takes the best of established
        technologies and infuses them with a new, state-of-the-art compiler.</div>
      <br />

      <div class='overflow-x-auto relative'>
        <Table />
      </div>
      <br />
      <h2>This means:</h2><br />
      <ul class='list-disc list-inside text-slate-900 dark:text-slate-200'>
        <li><b>Increased Performance:</b>
          Our modern compiler accelerates your code, making it run faster than
          ever.</li>
        <li><b>Optimized Memory Usage:</b>
          Experience more efficient memory management, allowing your
          applications to run smoother and more reliably.</li>
        <li><b>Seamless Integration:</b>
          Enjoy the ease of integrating with your favorite tools and frameworks
          from the mature ecosystem.</li>
        <li><b>Future-Proof Technology:</b>
          Stay ahead with a platform that evolves with the latest advancements
          in compiler technology.</li>

      </ul><br />
      <i>Join us in shaping the future of development, where power meets
        efficiency. Get ready to elevate your coding experience!</i>
      <br /><br />
      <a href='/pageTwo'>Go to page two </a></div>
  </template>;
}
