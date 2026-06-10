/**
 * Static-block fast path emission tests ({{#each}} bodies).
 *
 * Qualifying inline-element bodies must emit a `$_blk(html, slots)` block
 * definition + a positional values callback at the fixed `$_each` slots
 * (7th/8th, with nil placeholders for inverseFn/hasIndex). Every
 * disqualifier must bail SILENTLY: no `$_blk` and no extra positional args
 * (byte-identical to the pre-fast-path emission).
 *
 * See plugins/compiler/serializers/static-block.ts and
 * RESEARCH_LIST_TRACKING_OPTIMIZATION.md §2.A1/§4.
 */
import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

const wrap = (body: string, attrs = '') =>
  `{{#each this.items key="id"${attrs} as |item|}}${body}{{/each}}`;

describe('static-block fast path emission', () => {
  describe('qualifying bodies', () => {
    test('emits $_blk + values callback for an inline <tr> body', () => {
      const result = compile(
        wrap(
          '<tr class={{item.cls}}><td>{{item.id}}</td><td><a {{on "click" this.onClick}}>{{item.label}}</a></td><td><span>x</span></td></tr>'
        )
      );
      expect(result.errors).toHaveLength(0);
      const code = result.code;
      // static structure baked into one html chunk (static <span>x</span> text included)
      expect(code).toContain(
        '$_blk("<tr><td></td><td><a></a></td><td><span>x</span></td></tr>"'
      );
      // slot table: tr class, td text, a click event, a text
      expect(code).toContain('{ p: [], k: "class" }');
      expect(code).toContain('{ p: [0], k: "text" }');
      expect(code).toContain('{ p: [1, 0], k: "event", n: "click" }');
      expect(code).toContain('{ p: [1, 0], k: "text" }');
      // nil placeholders so the block lands at fixed positional slots
      expect(code).toContain('null, false, /*#__PURE__*/$_blk(');
      // values callback mirrors the body callback params
      expect(code).toContain('(item, $index, ctx0) => [');
      // the normal body callback is STILL emitted (runtime fallback)
      expect(code).toContain("$_tag('tr'");
    });

    test('bakes literal attrs/class/text into the html chunk', () => {
      const result = compile(
        wrap('<div class="static-cls" title="t" data-x="1">hello</div>')
      );
      expect(result.code).toContain(
        '$_blk("<div title=\\"t\\" data-x=\\"1\\" class=\\"static-cls\\">hello</div>", [])'
      );
    });

    test('escapes baked literals so the parse round-trips exactly', () => {
      const result = compile(wrap('<div title="he&quo<">a &amp; b <i>?</i></div>'));
      // `<` is legal inside a quoted attribute value; `&` must be re-escaped
      expect(result.code).toContain('title=\\"he&amp;quo<\\"');
      // the & the user wrote as &amp; arrives as a literal & in the AST and
      // must be re-escaped for the html chunk
      expect(result.code).toContain('a &amp; b ');
    });

    test('dynamic attribute becomes an attr slot', () => {
      const result = compile(wrap('<div title={{item.t}}></div>'));
      expect(result.code).toContain('{ p: [], k: "attr", n: "title" }');
    });

    test('dynamic property becomes a prop slot', () => {
      const result = compile(wrap('<input value={{item.v}}>'));
      expect(result.code).toContain('{ p: [], k: "prop", n: "value" }');
      // void element: no closing tag in the chunk
      expect(result.code).toContain('$_blk("<input>"');
    });

    test('index-using body emits hasIndex=true + index.value in values', () => {
      const result = compile(
        '{{#each this.items key="id" as |item i|}}<li data-i={{i}}>{{item.x}}</li>{{/each}}'
      );
      const code = result.code;
      expect(code).toContain('null, true, /*#__PURE__*/$_blk(');
      // the values callback reads the reactive index exactly like the body
      // (slot order is per-element: text/events first, then attrs)
      expect(code).toContain('(item, i, ctx0) => [() => item.x, () => i.value]');
    });

    test('{{else}} inverse keeps its positional slot before the block', () => {
      const result = compile(
        wrap('<li>{{item.x}}</li>') .replace('{{/each}}', '{{else}}<p>empty</p>{{/each}}')
      );
      const code = result.code;
      expect(code).toContain('$_blk("<li></li>"');
      // inverseFn (arrow) occupies slot 5, explicit false at slot 6
      expect(code).toMatch(/\$_ucw\(.*empty.*\n?.*false, \/\*#__PURE__\*\/\$_blk\(/s);
    });

    test('sync each ($_eachSync) gets the block too', () => {
      const result = compile(
        '{{#each this.items key="id" sync=true as |item|}}<div>{{item.x}}</div>{{/each}}'
      );
      expect(result.code).toContain('$_eachSync(');
      expect(result.code).toContain('$_blk("<div></div>"');
    });
  });

  describe('disqualifiers bail silently (no $_blk, no extra args)', () => {
    const bails: Array<[name: string, template: string]> = [
      ['component invocation', wrap('<tr><td><Foo /></td></tr>')],
      ['nested {{#if}}', wrap('<div>{{#if item.x}}<b>y</b>{{/if}}</div>')],
      // inner body uses a component so BOTH each levels bail (a qualifying
      // inner body would legitimately get its own block)
      ['nested {{#each}}', wrap('<div>{{#each item.xs as |x|}}<Foo @x={{x}} />{{/each}}</div>')],
      ['{{yield}} in body', wrap('<div>{{yield}}</div>')],
      ['modifier', wrap('<div {{this.someModifier}}>x</div>')],
      ['splattributes', wrap('<div ...attributes>x</div>')],
      ['svg subtree', wrap('<div><svg><path d="M0 0"></path></svg></div>')],
      ['multi-root body', wrap('<td>a</td><td>b</td>')],
      ['text root', wrap('plain text')],
      ['bare interpolation root', wrap('{{item.x}}')],
      ['mixed text + interpolation', wrap('<div>a {{item.x}}</div>')],
      ['interpolation + element siblings', wrap('<div>{{item.x}}<b>y</b></div>')],
      ['table root (implied tbody)', wrap('<table><tr><td>x</td></tr></table>')],
      ['select (content filtering)', wrap('<select><option>x</option></select>')],
      ['tr below root', wrap('<div><tr><td>x</td></tr></div>')],
      ['non-cell child of tr', wrap('<tr><div>x</div></tr>')],
      ['non-whitespace text directly in tr (foster parenting)', wrap('<tr>x</tr>')],
      ['p > div auto-close', wrap('<p><div>x</div></p>')],
      ['a > a adoption agency', wrap('<a><b><a>x</a></b></a>')],
      ['nested form ignored by parser', wrap('<form><div><form>x</form></div></form>')],
      ['multiple class bindings', wrap('<div class="a" class={{item.b}}>x</div>')],
      ['custom element', wrap('<my-el>{{item.x}}</my-el>')],
      ['pre (leading-newline parse drop)', wrap('<pre>x</pre>')],
      ['element block params', wrap('<div as |el|>x</div>')],
      ['key="@recycle"', '{{#each this.items key="@recycle" as |item|}}<div>{{item.x}}</div>{{/each}}'],
    ];

    test.each(bails)('%s', (_name, template) => {
      const result = compile(template);
      expect(result.errors).toHaveLength(0);
      expect(result.code).not.toContain('$_blk');
    });

    test('bail emits the exact pre-fast-path arg shape (no placeholders)', () => {
      const result = compile(
        '{{#each this.items key="id" as |item|}}<Foo @x={{item.x}} />{{/each}}'
      );
      // 4-arg $_each: cond, callback, key, ctx — nothing appended
      expect(result.code).toMatch(/"id", this\)\]$/);
    });
  });
});
