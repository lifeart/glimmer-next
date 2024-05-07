import {
  expect,
  test,
  describe,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { preprocess } from '@glimmer/syntax';

import { ComplexJSType, convert } from './converter';
import { ASTv1 } from '@glimmer/syntax';
import {
  HBSControlExpression,
  HBSNode,
  serializeNode,
  resetContextCounter,
} from './utils';
import { EVENT_TYPE, SYMBOLS } from './symbols';
import { defaultFlags } from './flags';

const flags = defaultFlags();

// flags.WITH_HELPER_MANAGER = false;

// Maybe modifier
function $mm(name: string, params: string = '', hash: string = '{}') {
  if (flags.WITH_MODIFIER_MANAGER) {
    return `$:($n) => $_maybeModifier($:${name},$n,[${params}],${hash})`;
  } else {
    return `$:($n) => $:${name}($n,${params.trim()})`;
  }
}
// Maybe helper
function $mh(name: string, params: string = '', hash: string = '{}') {
  const isBuiltin = ['or'].includes(name);
  if (isBuiltin) {
    name = '$__' + name;
  }
  if (!isBuiltin && flags.WITH_HELPER_MANAGER) {
    return `$:$_maybeHelper(${name},[${params}],${hash})`;
  } else {
    return `$:${name}(${params})`;
  }
}

function $args(str: string) {
  if (flags.IS_GLIMMER_COMPAT_MODE) {
    if (str === '{}') {
      return '{}';
    }
    return `${SYMBOLS.ARGS}(${str})`;
  } else {
    return str;
  }
}
function $glimmerCompat(str: string) {
  if (flags.IS_GLIMMER_COMPAT_MODE) {
    return `() => ` + str.replace('$:', '');
  } else {
    return str.replace('$:', '');
  }
}

function $s<T extends ComplexJSType>(node: T): string | null | undefined {
  return serializeNode(node);
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
  {
    helperManager: true,
    glimmerCompat: true,
    name: 'glimmer compat mode [hm]',
  },
  {
    helperManager: false,
    glimmerCompat: false,
    name: 'glimmer non-compat mode [hm]',
  },
  { modifierManager: false, name: 'without modifier manager' },
  { modifierManager: true, name: 'with modifier manager' },
])('$name', ({ glimmerCompat, helperManager, modifierManager }) => {
  beforeAll(() => {
    if (glimmerCompat !== undefined) {
      flags.IS_GLIMMER_COMPAT_MODE = glimmerCompat;
    }
    if (helperManager !== undefined) {
      flags.WITH_HELPER_MANAGER = helperManager;
    }
    if (modifierManager !== undefined) {
      flags.WITH_MODIFIER_MANAGER = modifierManager;
    }
  });
  beforeEach(() => {
    resetContextCounter();
  });
  describe('support concat expressions', () => {
    test('in attribute', () => {
      const converted = $t<ASTv1.ElementNode>(`<Panel @title='1. {{t.document}}' />`);
      expect(converted).toEqual($node({
        tag: 'Panel',
        attributes: [['@title', "$:() => [\"1. \",$:t.document].join('')"]],
        selfClosing: true,
      }));
      const result = $s(converted);
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(result).toEqual(`$_c(Panel,${$args(`{title: () => ["1. ",$:t.document].join('')},{},$_edp`)},this)`);
      } else {
        expect(result).toEqual(`$_c(Panel,${$args(`{title: () => ["1. ",$:t.document].join('')}`)},this)`);
      }
    });
  });
  describe('support dynamic components', () => {
    test('if component has path in name, it count it as dynamic', () => {
      const converted = $t<ASTv1.ElementNode>(`<this.Item />`);
      expect(converted).toEqual(
        $node({
          tag: 'this.Item',
          selfClosing: true,
        }),
      );
      const result = $s(converted);
      expect(result).toEqual('$_dc($:()=>this.Item,{},this)');
    });
  });
  describe('support ...attributes', () => {
    test('works for simple dom nodes', () => {
      const converted = $t<ASTv1.ElementNode>(`<div ...attributes></div>`);
      expect(converted).toEqual(
        $node({
          tag: 'div',
          attributes: [['...attributes', '']],
        }),
      );
      const result = $s(converted);
      expect(result).toEqual(`$_tag('div', [[],[],[],$fw], [], this)`);
    });
    test('works for dom nodes inside if', () => {
      const converted = $t<ASTv1.ElementNode>(
        `{{#if true}}<div ...attributes></div>{{/if}}`,
      );
      expect(converted).toEqual(
        $control({
          // @ts-expect-error
          condition: true,
          children: [
            $node({
              tag: 'div',
              attributes: [['...attributes', '']],
            }),
          ],
        }),
      );
      const result = $s(converted);
      expect(result).toEqual(
        `$_if(true, (ctx0) => $_ucw((ctx1) => [$_tag('div', [[],[],[],$fw], [], ctx1)], ctx0), (ctx0) => $_ucw((ctx1) => [], ctx0), this)`,
      );
    });
    test('works for component nodes inside if', () => {
      const converted = $t<ASTv1.ElementNode>(
        `{{#if true}}<Smile ...attributes />{{/if}}`,
      );
      expect(converted).toEqual(
        $control({
          // @ts-expect-error
          condition: true,
          children: [
            $node({
              tag: 'Smile',
              selfClosing: true,
              attributes: [['...attributes', '']],
            }),
          ],
        }),
      );
      const result = $s(converted);
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(result).toEqual(
          `$_if(true, (ctx0) => $_ucw((ctx1) => [$_c(Smile,$_args({},{},[[...$fw[0], ...[]],[...$fw[1], ...[]],[...$fw[2],...[]]]),ctx1)], ctx0), (ctx0) => $_ucw((ctx1) => [], ctx0), this)`,
        );
      } else {
        expect(result).toEqual(
          `$_if(true, (ctx0) => $_ucw((ctx1) => [$_c(Smile,{"$:[$PROPS_SYMBOL]": $:[[...$fw[0], ...[]],[...$fw[1], ...[]],[...$fw[2],...[]]]},ctx1)], ctx0), (ctx0) => $_ucw((ctx1) => [], ctx0), this)`,
        );
      }
    });
  });
  describe('convert function builder', () => {
    describe('mustache helper usage - optional chaining', () => {
      test('it has proper chains', () => {
        expect(
          $t<ASTv1.MustacheStatement>(
            `{{toInitials @name @initialLength @initials}}`,
          ),
        ).toEqual(
          `$:() => ` +
            $mh(
              'toInitials',
              '$:this[$args].name,$:this[$args].initialLength,$:this[$args].initials',
            ),
        );
        expect(
          $t<ASTv1.MustacheStatement>(
            `{{toInitials @name @initialLength.a @initials}}`,
          ),
        ).toEqual(
          `$:() => ` +
            $mh(
              'toInitials',
              '$:this[$args].name,$:this[$args].initialLength?.a,$:this[$args].initials',
            ),
        );
      });
    });
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
          `$:this[$args].foo?.bar`,
        );
      });
      test('it works for sub expression paths in mustache', () => {
        expect(
          $t<ASTv1.ElementNode>(
            `<div class={{maybeClass  (if @arrowProps.className @arrowProps.className)}}></div>`,
          ),
        ).toEqual(
          $node({
            tag: 'div',
            properties: [
              [
                '',
                `$:() => ${$mh(
                  'maybeClass',
                  `$:$__if($:this[$args].arrowProps?.className,$:this[$args].arrowProps?.className)`,
                )}`,
              ],
            ],
          }),
        );
      });
      test('works for sub-expression paths', () => {
        expect(
          $t<ASTv1.BlockStatement>(`{{and (or this.foo.bar.baz)}}`),
        ).toEqual(`$:() => ${$mh('and', $mh('or', `$:this.foo?.bar?.baz`))}`);
        expect($t<ASTv1.BlockStatement>(`{{and (or this.foo)}}`)).toEqual(
          `$:() => ${$mh('and', $mh('or', '$:this.foo'))}`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or this.foo.bar)}}`)).toEqual(
          `$:() => ${$mh('and', $mh('or', '$:this.foo?.bar'))}`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or foo.bar.baz)}}`)).toEqual(
          `$:() => ${$mh('and', $mh('or', '$:foo?.bar?.baz'))}`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or foo.bar)}}`)).toEqual(
          `$:() => ${$mh('and', $mh('or', `$:foo.bar`))}`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or @foo.bar.baz)}}`)).toEqual(
          `$:() => ${$mh('and', $mh('or', `$:this[$args].foo?.bar?.baz`))}`,
        );
        expect($t<ASTv1.BlockStatement>(`{{and (or @foo.bar)}}`)).toEqual(
          `$:() => ${$mh('and', $mh('or', `$:this[$args].foo?.bar`))}`,
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
          `$:() => $:function(args){const $fw = $_GET_FW(this, arguments);const $slots = $_GET_SLOTS(this, arguments);return{[$nodes]:[$_tag("tag", $fw,[()=>$_slot('default',()=>[],$slots)], this)], ctx: this};}`,
        );
      });
    });
    describe('Builtin helpers in MustacheStatements', () => {
      test('fn helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{fn a "b" "c"}}`)).toEqual(
          `$:() => $:$__fn($:a,"b","c")`,
        );
      });
      test('if helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{if foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__if($:foo,"bar","baz")`,
        );
      });
      test('unless helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{unless foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__if($:foo,"baz","bar")`);
      });
      test('eq helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{eq foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__eq($:foo,"bar","baz")`,
        );
      });
      test('debugger helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{debugger foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__debugger.call($:this,$:foo,"bar","baz")`);
      });
      test('log helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{log foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__log($:foo,"bar","baz")`,
        );
      });
      test('array helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{array foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__array($:foo,"bar","baz")`);
      });
      test('or helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{or foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__or($:foo,"bar","baz")`);
      });
      test('not helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{not foo "bar" "baz"}}`),
        ).toEqual(`$:() => $:$__not($:foo,"bar","baz")`);
      });
      test('hash helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{hash foo="bar" boo="baz"}}`),
        ).toEqual(`$:() => $:$__hash({foo: "bar", boo: "baz"})`);
      });
    });
    describe('special ember composition helpers', () => {
      test('its properly converted', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{component @cmp 123 name=hash}}`),
        ).toEqual(
          `$:() => $:${
            SYMBOLS.COMPONENT_HELPER
          }([$:this[$args].cmp,123],{name: ${$glimmerCompat('hash')}})`,
        );
        expect(
          $t<ASTv1.MustacheStatement>(`{{helper @cmp 123 name=hash}}`),
        ).toEqual(
          `$:() => $:${
            SYMBOLS.HELPER_HELPER
          }([$:this[$args].cmp,123],{name: ${$glimmerCompat('hash')}})`,
        );
        expect(
          $t<ASTv1.MustacheStatement>(`{{modifier @cmp 123 name=hash}}`),
        ).toEqual(
          `$:() => $:${
            SYMBOLS.MODIFIER_HELPER
          }([$:this[$args].cmp,123],{name: ${$glimmerCompat('hash')}})`,
        );
      });
    });
    describe('Builtin helpers in SubExpression', () => {
      test('fn helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (fn a b (if c d))}}`)).toEqual(
          `$:() => ${$mh('q', `$:$__fn($:a,$:b,$:$__if($:c,$:d))`)}`,
        );
      });
      test('if helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (if a b (if c d))}}`)).toEqual(
          `$:() => ${$mh('q', `$:$__if($:a,$:b,$:$__if($:c,$:d))`)}`,
        );
      });
      test('unless helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (unless a b (if c d))}}`),
        ).toEqual(`$:() => ${$mh('q', `$:$__if($:a,$:$__if($:c,$:d),$:b)`)}`);
      });
      test('eq helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (eq a b)}}`)).toEqual(
          `$:() => ${$mh('q', `$:$__eq($:a,$:b)`)}`,
        );
      });
      test('debugger helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (debugger a)}}`)).toEqual(
          `$:() => ${$mh('q', `$:$__debugger.call($:this,$:a)`)}`,
        );
      });
      test('log helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (log a b)}}`)).toEqual(
          `$:() => ${$mh('q', `$:$__log($:a,$:b)`)}`,
        );
      });
      test('array helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (array foo "bar" "baz")}}`),
        ).toEqual(`$:() => ${$mh('q', `$:$__array($:foo,"bar","baz")`)}`);
      });
      test('hash helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (hash foo="bar" boo="baz")}}`),
        ).toEqual(`$:() => ${$mh('q', `$:$__hash({foo: "bar", boo: "baz"})`)}`);
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
          `$:() => ${$mh('foo-bar', '$:bas,$:boo')}`,
        );
      });
      test('converts sub-expression without args', () => {
        expect($t<ASTv1.MustacheStatement>(`{{(foo-bar)}}`)).toEqual(
          `$:() => ${$mh('foo-bar')}`,
        );
      });
      test('supports helper composition', () => {
        expect($t<ASTv1.MustacheStatement>(`{{(foo-bar (baz-bat))}}`)).toEqual(
          `$:() => ${$mh('foo-bar', $mh('baz-bat'))}`,
        );
      });
      test('support boolean literals', () => {
        expect($t<ASTv1.MustacheStatement>(`{{true}}`)).toEqual(true);
        expect($t<ASTv1.MustacheStatement>(`{{false}}`)).toEqual(false);
      });
      test('support string literals', () => {
        expect($t<ASTv1.MustacheStatement>(`{{'true'}}`)).toEqual('"true"');
        expect($t<ASTv1.MustacheStatement>(`{{'false'}}`)).toEqual('"false"');
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
        ).toEqual(`$:() => ${$mh('foo', 'true,null,undefined')}`);
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
            properties: [['', 'foo']],
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
              ['', `$:() => [$:foo," bar ",${$mh('boo', '$:baks')}].join('')`],
            ],
          }),
        );
      });
      test('converts a simple element with path attribute', () => {
        expect($t<ASTv1.ElementNode>(`<div class={{foo}}></div>`)).toEqual(
          $node({
            tag: 'div',
            properties: [['', '$:foo']],
          }),
        );
      });
      test('converts a simple element with path attribute with string literal', () => {
        expect(
          $t<ASTv1.ElementNode>(`<div class={{foo "bar"}}></div>`),
        ).toEqual(
          $node({
            tag: 'div',
            properties: [['', `$:() => ${$mh('foo', '"bar"')}`]],
          }),
        );
      });
      test('converts a simple element with path attribute with path literal', () => {
        expect($t<ASTv1.ElementNode>(`<div class={{foo bar}}></div>`)).toEqual(
          $node({
            tag: 'div',
            properties: [['', `$:() => ${$mh('foo', '$:bar')}`]],
          }),
        );
      });
      test('converts a simple element with `on` modifier', () => {
        // @todo - likely need to return proper closure here (arrow function)
        expect($t<ASTv1.ElementNode>(`<div {{on "click" foo}}></div>`)).toEqual(
          $node({
            tag: 'div',
            events: [['click', '$:($e, $n) => $:foo($e, $n)']],
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
            events: [
              ['click', `$:($e, $n) => ${$mh('foo', '$:bar,$:baz')}($e, $n)`],
            ],
          }),
        );
      });
      test('support custom modifiers', () => {
        expect($t<ASTv1.ElementNode>(`<div {{foo-bar}}></div>`)).toEqual(
          $node({
            tag: 'div',
            events: [['0', $mm('foo-bar')]],
          }),
        );
      });
      test('support helper as on modifier argument', () => {
        const result = $t<ASTv1.ElementNode>(
          `<div {{on "click" (optional tab.onClick a=12)}}></div>`,
        );
        expect(result).toEqual(
          $node({
            tag: 'div',
            events: [
              [
                'click',
                `$:($e, $n) => ${$mh(
                  'optional',
                  '$:tab.onClick',
                  '{a: 12}',
                )}($e, $n)`,
              ],
            ],
          }),
        );
      });
      test('support custom modifiers with params ', () => {
        expect(
          $t<ASTv1.ElementNode>(
            `<div {{foo-bar foo 1 true null undefined}}></div>`,
          ),
        ).toEqual(
          $node({
            tag: 'div',
            events: [['0', $mm('foo-bar', '$:foo,1,true,null,undefined')]],
          }),
        );
      });
      test('support custom modifiers with hash params ', () => {
        expect(
          $t<ASTv1.ElementNode>(
            `<div {{foo-bar a=1 b=true c=null d=undefined b="a" }}></div>`,
          ),
        ).toEqual(
          $node({
            tag: 'div',
            events: [
              [
                '0',
                $mm(
                  'foo-bar',
                  '',
                  '{a: 1, b: true, c: null, d: undefined, b: "a"}',
                ),
              ],
            ],
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
            condition: $glimmerCompat($mh('foo', '$:bar')),
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
            condition: $glimmerCompat($mh('foo', '$:bar')),
            children: ['456'],
            inverse: ['123'],
          }),
        );
      });
    });
    describe('let condition', () => {
      const mathRandom = Math.random;
      beforeEach(() => {
        Math.random = () => 0.001;
      });
      afterEach(() => {
        Math.random = mathRandom;
      });
      test('it works', () => {
        expect(
          $t<ASTv1.BlockStatement>(
            `{{#let foo "name" as |bar k|}}p{{bar}}{{k}}{{/let}}`,
          ),
        ).toEqual(
          `$:...(() => {let self = this;let Let_bar_6c3gez6 = $:() => $:foo;let Let_k_6c3gez6 = "name";return [$_text("p"), ${
            flags.IS_GLIMMER_COMPAT_MODE
              ? '() => Let_bar_6c3gez6()'
              : 'Let_bar_6c3gez6()'
          }, ${
            flags.IS_GLIMMER_COMPAT_MODE
              ? '() => Let_k_6c3gez6'
              : 'Let_k_6c3gez6'
          }]})()`,
        );
      });
      test('it not override arg assign case', () => {
        const result = $t<ASTv1.BlockStatement>(
          `{{#let foo "name" as |bar k|}}<Div @bar={{bar}} bar={{if bar bar}} />{{/let}}`,
        );
        if (flags.IS_GLIMMER_COMPAT_MODE) {
          expect(result).toEqual(
            `$:...(() => {let self = this;let Let_bar_6c3gez6 = $:() => $:foo;let Let_k_6c3gez6 = "name";return [$_c(Div,$_args({bar: () => Let_bar_6c3gez6()},{},[[],[['bar', () => $:$__if($:Let_bar_6c3gez6(),$:Let_bar_6c3gez6())]],[]]),this)]})()`,
          );
        } else {
          expect(result).toEqual(
            `$:...(() => {let self = this;let Let_bar_6c3gez6 = $:() => $:foo;let Let_k_6c3gez6 = "name";return [$_c(Div,{bar: Let_bar_6c3gez6(), "$:[$PROPS_SYMBOL]": [[],[['bar', () => $:$__if($:Let_bar_6c3gez6(),$:Let_bar_6c3gez6())]],[]]},this)]})()`,
          );
        }
      });
    });
    describe('each condition', () => {
      test('it support block-less case', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each smf}}<div></div>{{/each}}`,
        );
        expect(converted).toEqual<HBSControlExpression>(
          $control({
            type: 'each',
            condition: $glimmerCompat('$:smf'),
            blockParams: [],
            children: [$node({ tag: 'div' })],
          }),
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'smf',
          )}, ($noop,$index,ctx0) => [$_tag('div', $_edp, [], ctx0)], null, this)`,
        );
      });
      test('it adds unstable child wrapper for simple multi-nodes', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each foo as |bar|}}<div></div><span></span>{{/each}}`,
        );
        expect(converted).toEqual<HBSControlExpression>(
          $control({
            type: 'each',
            condition: $glimmerCompat('$:foo'),
            blockParams: ['bar'],
            children: [$node({ tag: 'div' }), $node({ tag: 'span' })],
          }),
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'foo',
          )}, (bar,$index,ctx0) => [$_ucw((ctx1) => [$_tag('div', $_edp, [], ctx1), $_tag('span', $_edp, [], ctx1)], ctx0)], null, this)`,
        );
      });
      test('it not add unstable child wrapper for simple node', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each foo as |bar|}}<div></div>{{/each}}`,
        );
        expect(converted).toEqual<HBSControlExpression>(
          $control({
            type: 'each',
            condition: $glimmerCompat('$:foo'),
            blockParams: ['bar'],
            children: [$node({ tag: 'div' })],
          }),
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'foo',
          )}, (bar,$index,ctx0) => [$_tag('div', $_edp, [], ctx0)], null, this)`,
        );
      });
      test('it do not add UnstableChildWrapper if we have component surrounded by empty text', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each foo as |bar|}}   <Smile />   {{/each}}`,
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'foo',
          )}, (bar,$index,ctx0) => [$_c(Smile,${$args(
            '{}',
          )},ctx0)], null, this)`,
        );
      });
      test('it add UnstableChildWrapper if component surrounded my meaningful text', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each foo as |bar|}}1<Smile />{{/each}}`,
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'foo',
          )}, (bar,$index,ctx0) => [$_ucw((ctx1) => [$_text("1"), $_c(Smile,${$args(
            '{}',
          )},ctx1)], ctx0)], null, this)`,
        );
      });
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
