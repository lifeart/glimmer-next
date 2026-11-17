/**
 * Seeded template + tape generator for the differential render tests
 * (differential.test.ts). Deterministic: a seed fully determines the
 * template source and the sequence of state writes / clicks applied to it.
 *
 * Grammar (kept deliberately small — every construct here has more than one
 * runtime path that must agree):
 *   node     := element | text | if | each (each only outside another each)
 *               | <Badge @v={{e}}> node* </Badge>  (a template-only component)
 *   element  := <tag attrs* on?> node* </tag>
 *   attrs    := class="k" | class={{e}} | class="k {{e}}" | data-x={{e}}
 *               | title="t"
 *   on       := {{on "click" (fn this.hit "<site>" [item.id])}} + data-hit
 *   text     := word | {{e}} | word {{e}} word
 *   if       := {{#if c}} node* [{{else}} node*] {{/if}}
 *   each     := {{#each this.items key="id" as |item|}} <li|div …> {{else}} …
 *   e        := this.a | this.b | this.flag | this.nil | (if this.flag "T" "F")
 *               | item.label | item.id | item.n | (if (eq item.id this.sel) "sel" "")
 * Each-bodies are single-element roots, so they qualify for the static-block
 * (`$_blk`) path and — without `{{on}}`/nested control flow — frame mode.
 */

export type Rng = () => number;

/** mulberry32 — small, fast, good enough for test-case generation. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r: Rng, n: number) => Math.floor(r() * n);
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[int(r, xs.length)];

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'x', 'y'];
const TAGS = ['div', 'span', 'p', 'b', 'i', 'section', 'em'];
const ROW_TAGS = ['li', 'div'];

interface Scope {
  inEach: boolean;
  depth: number;
  sites: { n: number };
}

function expr(r: Rng, s: Scope): string {
  const top = ['this.a', 'this.b', 'this.flag', 'this.nil', '(if this.flag "T" "F")'];
  const row = ['item.label', 'item.id', 'item.n', '(if (eq item.id this.sel) "sel" "")'];
  return s.inEach && r() < 0.6 ? pick(r, row) : pick(r, top);
}

function cond(r: Rng, s: Scope): string {
  const top = ['this.flag', '(eq this.b 2)', 'this.a'];
  const row = ['(eq item.id this.sel)', 'item.n'];
  return s.inEach && r() < 0.5 ? pick(r, row) : pick(r, top);
}

function text(r: Rng, s: Scope): string {
  const k = int(r, 3);
  if (k === 0) return pick(r, WORDS);
  if (k === 1) return `{{${expr(r, s)}}}`;
  return `${pick(r, WORDS)} {{${expr(r, s)}}} ${pick(r, WORDS)}`;
}

function attrs(r: Rng, s: Scope): string {
  const out: string[] = [];
  const n = int(r, 3);
  let hasClass = false;
  for (let i = 0; i < n; i++) {
    const k = int(r, 5);
    if (k <= 2 && hasClass) continue;
    if (k === 0) {
      out.push(`class="c${int(r, 3)}"`);
      hasClass = true;
    } else if (k === 1) {
      out.push(`class={{${expr(r, s)}}}`);
      hasClass = true;
    } else if (k === 2) {
      out.push(`class="k {{${expr(r, s)}}}"`);
      hasClass = true;
    } else if (k === 3) {
      if (!out.some((a) => a.startsWith('data-x'))) out.push(`data-x={{${expr(r, s)}}}`);
    } else if (!out.some((a) => a.startsWith('title'))) {
      out.push(`title="${pick(r, WORDS)}"`);
    }
  }
  if (r() < 0.25) {
    const site = `s${s.sites.n++}`;
    out.push(`data-hit="${site}"`);
    out.push(
      s.inEach
        ? `{{on "click" (fn this.hit "${site}" item.id)}}`
        : `{{on "click" (fn this.hit "${site}")}}`,
    );
  }
  return out.length > 0 ? ' ' + out.join(' ') : '';
}

function element(r: Rng, s: Scope, tag = pick(r, TAGS)): string {
  const inner = s.depth >= 3 ? [] : children(r, { ...s, depth: s.depth + 1 }, int(r, 3));
  return `<${tag}${attrs(r, s)}>${inner.join('')}</${tag}>`;
}

function each(r: Rng, s: Scope): string {
  const rs: Scope = { ...s, inEach: true, depth: s.depth + 1 };
  const body = element(r, rs, pick(r, ROW_TAGS));
  const inverse = r() < 0.4 ? `{{else}}<p>none ${pick(r, WORDS)}</p>` : '';
  return `<ul>{{#each this.items key="id" as |item|}}${body}${inverse}{{/each}}</ul>`;
}

/** `Badge` (differential.test.ts scope): `<span class="badge">{{@v}}{{yield}}</span>`. */
function component(r: Rng, s: Scope): string {
  const inner = s.depth >= 3 ? '' : children(r, { ...s, depth: s.depth + 1 }, int(r, 2)).join('');
  return `<Badge @v={{${expr(r, s)}}}>${inner}</Badge>`;
}

function node(r: Rng, s: Scope): string {
  const k = r();
  if (k < 0.08) return component(r, s);
  if (k < 0.4) return element(r, s);
  if (k < 0.65) return text(r, s);
  if (k < 0.85 && s.depth < 3) {
    const yes = children(r, { ...s, depth: s.depth + 1 }, 1 + int(r, 2)).join('');
    const no =
      r() < 0.5 ? `{{else}}${children(r, { ...s, depth: s.depth + 1 }, 1).join('')}` : '';
    return `{{#if ${cond(r, s)}}}${yes}${no}{{/if}}`;
  }
  if (!s.inEach && s.depth < 2) return each(r, s);
  return element(r, s);
}

function children(r: Rng, s: Scope, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(node(r, s));
  return out;
}

/** A template always contains at least one each, so every seed exercises
 * the list paths the modes differ on. */
export function generateTemplate(seed: number): string {
  const r = rng(seed);
  const s: Scope = { inEach: false, depth: 0, sites: { n: 0 } };
  const parts = children(r, s, 1 + int(r, 3));
  if (!parts.some((p) => p.includes('{{#each'))) {
    parts.splice(int(r, parts.length + 1), 0, each(r, s));
  }
  return `<div id="root">${parts.join('')}</div>`;
}

// --------------------------------------------------------------------------
// Tape: state writes and clicks applied after the first render.
// --------------------------------------------------------------------------

export type Step =
  | { op: 'setA'; value: string }
  | { op: 'setB'; value: number }
  | { op: 'toggleFlag' }
  | { op: 'select'; at: number }
  | { op: 'push'; count: number }
  | { op: 'remove'; at: number }
  | { op: 'swap'; i: number; j: number }
  | { op: 'reverse' }
  | { op: 'replaceAll'; count: number }
  | { op: 'clear' }
  | { op: 'relabel'; at: number; word: string }
  | { op: 'refSwap'; at: number }
  | { op: 'click'; at: number };

/**
 * `refSwap` (a new object under an existing key) is opt-in: the non-frame
 * paths do not re-bind a reused row without a host hook, frame mode does —
 * a known divergence pinned by its own test in differential.test.ts.
 */
export function generateTape(seed: number, length = 14, withRefSwap = false): Step[] {
  // a different stream than the template's, same seed
  const r = rng(seed ^ 0x9e3779b9);
  const steps: Step[] = [{ op: 'push', count: 1 + int(r, 4) }];
  const ops: Step['op'][] = [
    'setA', 'setB', 'toggleFlag', 'select', 'push', 'remove', 'swap',
    'reverse', 'replaceAll', 'clear', 'relabel', 'click', 'click',
  ];
  if (withRefSwap) ops.push('refSwap');
  for (let i = 1; i < length; i++) {
    const op = pick(r, ops);
    switch (op) {
      case 'setA':
        steps.push({ op, value: pick(r, WORDS) });
        break;
      case 'setB':
        steps.push({ op, value: int(r, 4) });
        break;
      case 'push':
      case 'replaceAll':
        steps.push({ op, count: 1 + int(r, 4) });
        break;
      case 'swap':
        steps.push({ op, i: int(r, 8), j: int(r, 8) });
        break;
      case 'relabel':
        steps.push({ op, at: int(r, 8), word: pick(r, WORDS) });
        break;
      case 'select':
      case 'remove':
      case 'refSwap':
      case 'click':
        steps.push({ op, at: int(r, 8) });
        break;
      default:
        steps.push({ op } as Step);
    }
  }
  return steps;
}
