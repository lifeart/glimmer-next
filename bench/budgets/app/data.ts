// Deterministic krausest-shaped row data for the budget harness. A seeded
// LCG instead of Math.random so every rep renders the same labels (heap and
// timing numbers must not depend on label lengths drawn at random).
import { cellFor } from '@lifeart/gxt';

export interface Item {
  id: number;
  label: string;
}

const ADJECTIVES = [
  'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome',
  'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful',
  'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive',
  'cheap', 'expensive', 'fancy',
];
const COLOURS = [
  'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown',
  'white', 'black', 'orange',
];
const NOUNS = [
  'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie',
  'sandwich', 'burger', 'pizza', 'mouse', 'keyboard',
];

let seed = 1;
function rand(max: number): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % max;
}

let nextId = 1;

/** Build `count` rows; `label` is a tracked (cell-backed) accessor so
 * `item.label = x` re-renders the row, as in the krausest gxt app. */
export function buildData(count: number): Item[] {
  const data: Item[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const item: Item = {
      id: nextId++,
      label: `${ADJECTIVES[rand(ADJECTIVES.length)]} ${COLOURS[rand(COLOURS.length)]} ${NOUNS[rand(NOUNS.length)]}`,
    };
    cellFor(item, 'label');
    data[i] = item;
  }
  return data;
}

export function updateData(data: Item[], mod: number): void {
  for (let i = 0; i < data.length; i += mod) {
    data[i].label = data[i].label + ' !!!';
  }
}

export function swapRows(data: Item[]): Item[] {
  const next = data.slice();
  if (next.length > 998) {
    const a = next[1];
    next[1] = next[998];
    next[998] = a;
  }
  return next;
}
