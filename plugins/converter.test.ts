import { expect, test, describe, beforeAll } from 'vitest';
import { preprocess } from '@glimmer/syntax';

import { ComplexJSType, convert } from './converter';
import { ASTv1 } from '@glimmer/syntax';
import { HBSControlExpression, HBSNode } from './utils';
import { EVENT_TYPE } from './symbols';
import { defaultFlags } from './flags';

const flags = defaultFlags();

function $glimmerCompat(str: string) {
  if (flags.IS_GLIMMER_COMPAT_MODE) {
    return `() => ` + str.replace('$:', '');
  } else {
    return str.replace('$:', '');
  }
}

function $t<T extends ASTv1.Node>(tpl: string): ComplexJSType {
  const seenNodes: Set<ASTv1.Node> = new Set();
  const { ToJSType } = convert(seenNodes, flags);
  const ast = preprocess(tpl);
  const node = ast.body[0] as T;
  return ToJSType(node);
}

function $control(
  partial: Partial<HBSControlExpression>,
): HBSControlExpression {
  return {
    type: 'if',
    isControl: true,
    condition: '',
    blockParams: [],
    isSync: false,
    children: [],
    inverse: null,
    key: null,
    ...partial,
  };
}

function $node(partial: Partial<HBSNode>): HBSNode {
  return {
    ...partial,
    events: partial.events ?? [],
    children: partial.children ?? [],
    attributes: partial.attributes ?? [],
    properties: partial.properties ?? [],
    blockParams: partial.blockParams ?? [],
    selfClosing: partial.selfClosing ?? false,
    hasStableChild: partial.hasStableChild ?? true,
    tag: partial.tag ?? '',
  };
}

describe.each([
  { glimmerCompat: true, name: 'glimmer compat mode' },
  { glimmerCompat: false, name: 'glimmer non-compat mode' },
])('$name', ({ glimmerCompat }) => {
  beforeAll(() => {
    flags.IS_GLIMMER_COMPAT_MODE = glimmerCompat;
  });
  describe('convert function builder', () => {
    describe('path expressions are optional chained', () => {
      test('works for template paths', () => {
        expect($t<ASTv1.BlockStatement>(`{{this.foo.bar.baz}}`)).toEqual(
          `$:this.foo?.bar?.baz`,
        );
        expect($t<ASTv1.BlockStatement>(`{{this.foo}}`)).toEqual(`$:this.foo`);
        expect($t<ASTv1.BlockStatement>(`{{this.foo.bar}}`)).toEqual(
          `$:this.foo?.bar`,
        );
        expect($t<ASTv1.BlockStatement>(`{{foo.bar.baz}}`)).toEqual(
          `$:foo?.bar?.baz`,
        );
        expect($t<ASTv1.BlockStatement>(`{{foo.bar}}`)).toEqual(`$:foo.bar`);
        expect($t<ASTv1.BlockStatement>(`{{@foo.bar.baz}}`)).toEqual(
          `$:this[$args].foo?.bar?.baz`,
        );
        expect($t<ASTv1.BlockStatement>(`{{@foo.bar}}`)).toEqual(
          `$:this[$args].foo.bar`,
        );
      });
      test('works for sub-expression paths', () => {
        expect(
          $t<ASTv1.BlockStatement>(`{{and (or this.foo.bar.baz)}}`),
        ).toEqual(`$:() => $:and(or($:this.foo?.bar?.baz))`);
        expect($t<ASTv1.BlockStatement>(`{{and (or this.foo)}}`)).toEqual(
          `$:() => $:and(or($:this.foo))`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or this.foo.bar)}}`)).toEqual(
          `$:() => $:and(or($:this.foo?.bar))`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or foo.bar.baz)}}`)).toEqual(
          `$:() => $:and(or($:foo?.bar?.baz))`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or foo.bar)}}`)).toEqual(
          `$:() => $:and(or($:foo.bar))`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or @foo.bar.baz)}}`)).toEqual(
          `$:() => $:and(or($:this[$args].foo?.bar?.baz))`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or @foo.bar)}}`)).toEqual(
          `$:() => $:and(or($:this[$args].foo?.bar))`,
        );
      });
      test('works as hash params', () => {
        // maybeWrapped
        const mW = (str: string) => {
          if (flags.IS_GLIMMER_COMPAT_MODE) {
            return `$:() => $:$__hash({a: () => ${str}})`;
          } else {
            return `$:() => $:$__hash({a: ${str}})`;
          }
        };
        expect($t<ASTv1.BlockStatement>(`{{hash a=this.foo.bar.baz}}`)).toEqual(
          mW('this.foo?.bar?.baz'),
        );
        expect($t<ASTv1.BlockStatement>(`{{hash a=this.foo}}`)).toEqual(
          mW('this.foo'),
        );
        expect($t<ASTv1.BlockStatement>(`{{hash a=this.foo.bar}}`)).toEqual(
          mW('this.foo?.bar'),
        );
        expect($t<ASTv1.BlockStatement>(`{{hash a=foo.bar.baz}}`)).toEqual(
          mW('foo?.bar?.baz'),
        );
        expect($t<ASTv1.BlockStatement>(`{{hash a=foo.bar}}`)).toEqual(
          mW('foo.bar'),
        );
        expect($t<ASTv1.BlockStatement>(`{{hash a=@foo.bar.baz}}`)).toEqual(
          mW('this[$args].foo?.bar?.baz'),
        );
        expect($t<ASTv1.BlockStatement>(`{{hash a=@foo.bar}}`)).toEqual(
          mW('this[$args].foo?.bar'),
        );
      });
    });
    describe('basic element helper support', () => {
      test('it return kinda valid component-like code', () => {
        expect($t<ASTv1.BlockStatement>(`{{(element "tag")}}`)).toEqual(
          `$:() => $:function(args,props){const $slots = $_GET_SLOTS(this, arguments);return{[$nodes]:[$_tag("tag",[props[$propsProp],props[$attrsProp],props[$eventsProp]],[()=>$_slot('default',()=>[],$slots)], this)], ctx: this};}`,
        );
      });
    });
    describe('Builtin helpers in MustacheStatements', () => {
      test('fn helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{fn a "b" "c"}}`)).toEqual(
          `$:() => $:$__fn(a,"b","c")`,
        );
      });
      test('if helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{if foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__if(foo,"bar","baz")`,
        );
      });
      test('unless helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{unless foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__if(foo,"baz","bar")`);
      });
      test('eq helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{eq foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__eq(foo,"bar","baz")`,
        );
      });
      test('debugger helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{debugger foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__debugger.call(this,foo,"bar","baz")`);
      });
      test('log helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{log foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__log(foo,"bar","baz")`,
        );
      });
      test('array helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{array foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__array(foo,"bar","baz")`);
      });
      test('hash helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{hash foo="bar" boo="baz"}}`),
        ).toEqual(`$:() => $:$__hash({foo: "bar", boo: "baz"})`);
      });
    });
    describe('Builtin helpers in SubExpression', () => {
      test('fn helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (fn a b (if c d))}}`)).toEqual(
          `$:() => $:q($__fn($:a,$:b,$:$__if($:c,$:d)))`,
        );
      });
      test('if helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (if a b (if c d))}}`)).toEqual(
          `$:() => $:q($__if($:a,$:b,$:$__if($:c,$:d)))`,
        );
      });
      test('unless helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (unless a b (if c d))}}`),
        ).toEqual(`$:() => $:q($__if($:a,$:$__if($:c,$:d),$:b))`);
      });
      test('eq helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (eq a b)}}`)).toEqual(
          `$:() => $:q($__eq($:a,$:b))`,
        );
      });
      test('debugger helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (debugger a)}}`)).toEqual(
          `$:() => $:q($__debugger.call($:this,$:a))`,
        );
      });
      test('log helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (log a b)}}`)).toEqual(
          `$:() => $:q($__log($:a,$:b))`,
        );
      });
      test('array helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (array foo "bar" "baz")}}`),
        ).toEqual(`$:() => $:q($__array($:foo,"bar","baz"))`);
      });
      test('hash helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (hash foo="bar" boo="baz")}}`),
        ).toEqual(`$:() => $:q($__hash({foo: "bar", boo: "baz"}))`);
      });
    });
    describe('TextNode', () => {
      test('converts a simple string', () => {
        expect($t<ASTv1.TextNode>(`"Hello World"`)).toEqual(`"Hello World"`);
      });
      test('non empty text nodes not trimmed', () => {
        expect($t<ASTv1.TextNode>(` foo`)).toEqual(` foo`);
      });
      test('empty non multiline text nodes preserved', () => {
        expect($t<ASTv1.TextNode>(` `)).toEqual(' ');
      });
      test('&nbsp; is preserved', () => {
        expect($t<ASTv1.TextNode>(`&nbsp;`)).not.toEqual(null);
      });
      test('multispace lines are removed', () => {
        expect($t<ASTv1.TextNode>(`            `)).toEqual(null);
      });
      test('empty multiline text nodes trimmed', () => {
        expect($t<ASTv1.TextNode>(` \n `)).toEqual(null);
      });
    });
    describe('MustacheStatement', () => {
      test('converts a args-less path', () => {
        expect($t<ASTv1.MustacheStatement>(`{{foo-bar}}`)).toEqual(`$:foo-bar`);
      });
      test('converts a path with args', () => {
        expect($t<ASTv1.MustacheStatement>(`{{foo-bar bas boo}}`)).toEqual(
          `$:() => $:foo-bar(bas,boo)`,
        );
      });
      test('converts sub-expression without args', () => {
        expect($t<ASTv1.MustacheStatement>(`{{(foo-bar)}}`)).toEqual(
          `$:() => $:foo-bar()`,
        );
      });
      test('supports helper composition', () => {
        expect($t<ASTv1.MustacheStatement>(`{{(foo-bar (baz-bat))}}`)).toEqual(
          `$:() => $:foo-bar($:baz-bat())`,
        );
      });
      test('support boolean literals', () => {
        expect($t<ASTv1.MustacheStatement>(`{{true}}`)).toEqual(true);
        expect($t<ASTv1.MustacheStatement>(`{{false}}`)).toEqual(false);
      });
      test('support null literals', () => {
        expect($t<ASTv1.MustacheStatement>(`{{null}}`)).toEqual(null);
      });
      test('support undefined literals', () => {
        expect($t<ASTv1.MustacheStatement>(`{{undefined}}`)).toEqual(undefined);
      });
      test('support bool,  null, undefined as helper args', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{foo true null undefined}}`),
        ).toEqual(`$:() => $:foo(true,null,undefined)`);
      });
    });
    describe('ElementNode', () => {
      test('converts a simple element', () => {
        expect($t<ASTv1.ElementNode>(`<div></div>`)).toEqual(
          $node({ tag: 'div' }),
        );
      });
      test('converts a simple element with string attribute', () => {
        expect($t<ASTv1.ElementNode>(`<div class="foo"></div>`)).toEqual(
          $node({
            tag: 'div',
            properties: [['className', 'foo']],
          }),
        );
      });
      test('converts a simple element with string child', () => {
        expect($t<ASTv1.ElementNode>(`<div> sd</div>`)).toEqual(
          $node({
            tag: 'div',
            events: [[EVENT_TYPE.TEXT_CONTENT, ' sd']],
          }),
        );
      });
      test('converts a simple element with complex child', () => {
        expect($t<ASTv1.ElementNode>(`<div> sd<span></span></div>`)).toEqual(
          $node({
            tag: 'div',
            children: [' sd', $node({ tag: 'span' })],
          }),
        );
      });
      test('converts a simple element with concat string attribute', () => {
        expect(
          $t<ASTv1.ElementNode>(`<div class="{{foo}} bar {{boo baks}}"></div>`),
        ).toEqual(
          $node({
            tag: 'div',
            properties: [
              ['className', '$:() => [$:foo," bar ",$:boo(baks)].join(\'\')'],
            ],
          }),
        );
      });
      test('converts a simple element with path attribute', () => {
        expect($t<ASTv1.ElementNode>(`<div class={{foo}}></div>`)).toEqual(
          $node({
            tag: 'div',
            properties: [['className', '$:foo']],
          }),
        );
      });
      test('converts a simple element with path attribute with string literal', () => {
        expect(
          $t<ASTv1.ElementNode>(`<div class={{foo "bar"}}></div>`),
        ).toEqual(
          $node({
            tag: 'div',
            properties: [['className', '$:() => $:foo("bar")']],
          }),
        );
      });
      test('converts a simple element with path attribute with path literal', () => {
        expect($t<ASTv1.ElementNode>(`<div class={{foo bar}}></div>`)).toEqual(
          $node({
            tag: 'div',
            properties: [['className', '$:() => $:foo(bar)']],
          }),
        );
      });
      test('converts a simple element with `on` modifier', () => {
        // @todo - likely need to return proper closure here (arrow function)
        expect($t<ASTv1.ElementNode>(`<div {{on "click" foo}}></div>`)).toEqual(
          $node({
            tag: 'div',
            events: [['click', '$:($e, $n) => $:foo($e, $n, )']],
          }),
        );
      });
      test('converts a simple element with `on` modifier, with composed args', () => {
        // @todo - likely need to return proper closure here (arrow function)
        expect(
          $t<ASTv1.ElementNode>(`<div {{on "click" (foo bar baz)}}></div>`),
        ).toEqual(
          $node({
            tag: 'div',
            events: [['click', '$:($e, $n) => $:foo($:bar,$:baz)($e, $n, )']],
          }),
        );
      });
      test('support custom modifiers', () => {
        expect($t<ASTv1.ElementNode>(`<div {{foo-bar}}></div>`)).toEqual(
          $node({
            tag: 'div',
            events: [['0', '$:($n) => $:foo-bar($n, )']],
          }),
        );
      });
    });
    describe('if condition', () => {
      test('only true part', () => {
        expect(
          $t<ASTv1.BlockStatement>(`{{#if foo}}123{{/if}}`),
        ).toEqual<HBSControlExpression>(
          $control({
            condition: $glimmerCompat('$:foo'),
            children: ['123'],
          }),
        );
      });

      test('both parts', () => {
        expect(
          $t<ASTv1.BlockStatement>(`{{#if foo}}123{{else}}456{{/if}}`),
        ).toEqual<HBSControlExpression>(
          $control({
            condition: $glimmerCompat('$:foo'),
            children: ['123'],
            inverse: ['456'],
          }),
        );
      });

      test('helper in condition', () => {
        expect(
          $t<ASTv1.BlockStatement>(`{{#if (foo bar)}}123{{else}}456{{/if}}`),
        ).toEqual<HBSControlExpression>(
          $control({
            type: 'if',
            condition: $glimmerCompat('$:foo($:bar)'),
            children: ['123'],
            inverse: ['456'],
          }),
        );

        expect(
          $t<ASTv1.BlockStatement>(
            `{{#unless (foo bar)}}123{{else}}456{{/unless}}`,
          ),
        ).toEqual<HBSControlExpression>(
          $control({
            type: 'if',
            condition: $glimmerCompat('$:foo($:bar)'),
            children: ['456'],
            inverse: ['123'],
          }),
        );
      });
    });
    describe('let condition', () => {
      test('it works', () => {
        expect(
          $t<ASTv1.BlockStatement>(
            `{{#let foo "name" as |bar k|}}p{{bar}}{{k}}{{/let}}`,
          ),
        ).toEqual(
          `$:...(() => {let bar = $:() => $:foo;let k = "name";return [$_text("p"), ${
            flags.IS_GLIMMER_COMPAT_MODE ? '() => bar' : 'bar'
          }, ${flags.IS_GLIMMER_COMPAT_MODE ? '() => k' : 'k'}]})()`,
        );
      });
    });
    describe('each condition', () => {
      test('it works', () => {
        expect(
          $t<ASTv1.BlockStatement>(`{{#each foo as |bar index|}}123{{/each}}`),
        ).toEqual<HBSControlExpression>(
          $control({
            type: 'each',
            condition: $glimmerCompat('$:foo'),
            blockParams: ['bar', 'index'],
            children: ['123'],
          }),
        );
      });
      test('it could provide keys', () => {
        expect(
          $t<ASTv1.BlockStatement>(
            `{{#each foo key="id" as |bar index|}}123{{/each}}`,
          ),
        ).toEqual<HBSControlExpression>(
          $control({
            type: 'each',
            condition: $glimmerCompat('$:foo'),
            blockParams: ['bar', 'index'],
            children: ['123'],
            key: 'id',
          }),
        );
      });
    });
    describe('stableChildDetection', () => {
      test('detects stable child', () => {
        expect($t<ASTv1.ElementNode>(`<div>foo</div>`)).toEqual(
          $node({
            tag: 'div',
            hasStableChild: true,
            events: [[EVENT_TYPE.TEXT_CONTENT, 'foo']],
          }),
        );
        expect($t<ASTv1.ElementNode>(`<div><p></p></div>`)).toEqual(
          $node({
            tag: 'div',
            hasStableChild: true,
            children: [$node({ tag: 'p' })],
          }),
        );
        expect($t<ASTv1.ElementNode>(`<div><:slot></:slot></div>`)).toEqual(
          $node({
            tag: 'div',
            hasStableChild: false,
            children: [$node({ tag: ':slot' })],
          }),
        );
        expect(
          $t<ASTv1.ElementNode>(`<div>{{#if foo}}123{{/if}}</div>`),
        ).toEqual(
          $node({
            tag: 'div',
            hasStableChild: false,
            children: [
              $control({
                condition: $glimmerCompat('$:foo'),
                children: ['123'],
              }),
            ],
          }),
        );
      });
    });

    describe('components', () => {
      test('it forwarding props', () => {
        expect($t<ASTv1.ElementNode>(`<DIV @name={{1}}></DIV>`)).toEqual(
          $node({
            tag: 'DIV',
            attributes: [['@name', 1]],
          }),
        );
      });
    });
  });
});
