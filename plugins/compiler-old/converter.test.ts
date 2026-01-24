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
} from '../utils';
import { EVENT_TYPE, SYMBOLS } from '../symbols';
import { defaultFlags } from '../flags';
import { BUILTIN_HELPERS } from '../constants';

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
  const isBuiltin = (name in BUILTIN_HELPERS);
  const isFromScope = name.includes('-');
  if (isBuiltin) {
    name = '$__' + name;
  }
  if (isFromScope || (!isBuiltin && flags.WITH_HELPER_MANAGER)) {
    if (isFromScope) {
      hash = '{$_scope: ()=>this[$args]?.$_scope}';
    }
    return `$:$_maybeHelper(${
      isFromScope ? JSON.stringify(name) : name
    },[${params}],${hash})`;
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
function $t<T extends ASTv1.Node>(
  tpl: string,
  scopes: string[] = [],
): ComplexJSType {
  const seenNodes: Set<ASTv1.Node> = new Set();
  const { ToJSType } = convert(seenNodes, flags, new Set(scopes));
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
  describe('string serialization', () => {
    test('as one of child in dom (end)', () => {
      const converted = $t<ASTv1.ElementNode>(`<div><i></i>Hello World</div>`);
      expect(converted).toEqual(
        $node({
          tag: 'div',
          children: [$node({ tag: 'i' }), 'Hello World'],
        }),
      );
      const result = $s(converted);
      expect(result).toEqual(
        `$_tag('div', $_edp, [$_tag('i', $_edp, [], this), "Hello World"], this)`,
      );
    });
    test('as one of child in dom (start)', () => {
      const converted = $t<ASTv1.ElementNode>(`<div>Hello World<i></i></div>`);
      expect(converted).toEqual(
        $node({
          tag: 'div',
          children: ['Hello World', $node({ tag: 'i' })],
        }),
      );
      const result = $s(converted);
      expect(result).toEqual(
        `$_tag('div', $_edp, ["Hello World", $_tag('i', $_edp, [], this)], this)`,
      );
    });
    test('as single node', () => {
      const converted = $t<ASTv1.ElementNode>(`<div>Hello World</div>`);
      expect(converted).toEqual(
        $node({
          tag: 'div',
          events: [
            [EVENT_TYPE.TEXT_CONTENT, 'Hello World'],
          ]
        }),
      );
      const result = $s(converted);
      expect(result).toEqual(`$_tag('div', [[],[],[['1', "Hello World"]]], [], this)`);
    });
  });
  describe('support concat expressions', () => {
    test('in attribute', () => {
      const converted = $t<ASTv1.ElementNode>(
        `<Panel @title='1. {{t.document}}' />`,
        ['t', 'Panel'],
      );
      expect(converted).toEqual(
        $node({
          tag: 'Panel',
          attributes: [['@title', '$:() => ["1. ",$:t.document].join(\'\')']],
          selfClosing: true,
        }),
      );
      const result = $s(converted);
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(result).toEqual(
          `$_c(Panel,${$args(
            `{title: () => ["1. ",$:t.document].join('')},{},$_edp`,
          )},this)`,
        );
      } else {
        expect(result).toEqual(
          `$_c(Panel,${$args(
            `{title: () => ["1. ",$:t.document].join('')}`,
          )},this)`,
        );
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
        ['Smile'],
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
            ['toInitials'],
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
            ['toInitials'],
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
        expect($t<ASTv1.BlockStatement>(`{{foo.bar.baz}}`, ['foo'])).toEqual(
          `$:foo?.bar?.baz`,
        );
        expect($t<ASTv1.BlockStatement>(`{{foo.bar}}`, ['foo'])).toEqual(
          `$:foo.bar`,
        );
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
            ['maybeClass'],
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
        // TODO: fix element tag
        expect($t<ASTv1.BlockStatement>(`{{(element "tag")}}`)).toEqual(
          `$:() => $:function(args){$_GET_ARGS(this, arguments);const $fw = $_GET_FW(this, arguments);const $slots = $_GET_SLOTS(this, arguments);return $_fin([$_tag("tag", $fw,[()=>$_slot('default',()=>[],$slots,this)], this)], this)};`,
        );
      });
    });
    describe('helper paths with dots', () => {
      test('helper path with dots in subexpression uses optional chaining', () => {
        // SubExpression paths with dots should be converted
        expect(
          $t<ASTv1.MustacheStatement>(`{{call (foo.bar.baz arg)}}`, ['foo', 'call']),
        ).toEqual(`$:() => ${$mh('call', $mh('foo?.bar?.baz', '$:arg'))}`);
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
      test('unless helper with only 2 params', () => {
        const result = $t<ASTv1.MustacheStatement>(`{{unless foo "bar"}}`);
        // Debug: console.log('unless 2 params result:', result);
        expect(result).toEqual(`$:() => $:$__if($:foo,"","bar")`);
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
      test('and helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{and foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__and($:foo,"bar","baz")`,
        );
      });
      test('or helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{or foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__or($:foo,"bar","baz")`,
        );
      });
      test('not helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{not foo "bar" "baz"}}`)).toEqual(
          `$:() => $:$__not($:foo,"bar","baz")`,
        );
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
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (fn a b (if c d))}}`, ['q']),
        ).toEqual(`$:() => ${$mh('q', `$:$__fn($:a,$:b,$:$__if($:c,$:d))`)}`);
      });
      test('if helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (if a b (if c d))}}`, ['q']),
        ).toEqual(`$:() => ${$mh('q', `$:$__if($:a,$:b,$:$__if($:c,$:d))`)}`);
      });
      test('unless helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (unless a b (if c d))}}`, ['q']),
        ).toEqual(`$:() => ${$mh('q', `$:$__if($:a,$:$__if($:c,$:d),$:b)`)}`);
      });
      test('eq helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (eq a b)}}`, ['q'])).toEqual(
          `$:() => ${$mh('q', `$:$__eq($:a,$:b)`)}`,
        );
      });
      test('debugger helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (debugger a)}}`, ['q']),
        ).toEqual(`$:() => ${$mh('q', `$:$__debugger.call($:this,$:a)`)}`);
      });
      test('log helper properly mapped', () => {
        expect($t<ASTv1.MustacheStatement>(`{{q (log a b)}}`, ['q'])).toEqual(
          `$:() => ${$mh('q', `$:$__log($:a,$:b)`)}`,
        );
      });
      test('array helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (array foo "bar" "baz")}}`, ['q']),
        ).toEqual(`$:() => ${$mh('q', `$:$__array($:foo,"bar","baz")`)}`);
      });
      test('hash helper properly mapped', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{q (hash foo="bar" boo="baz")}}`, [
            'q',
          ]),
        ).toEqual(`$:() => ${$mh('q', `$:$__hash({foo: "bar", boo: "baz"})`)}`);
      });
      test('hash helper as subexpression with path check', () => {
        // Direct hash subexpression
        const result = $t<ASTv1.MustacheStatement>(`{{(hash a=1)}}`);
        expect(result).toContain('$__hash');
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
        expect($t<ASTv1.MustacheStatement>(`{{foo-bar}}`)).toEqual(
          `${$mh('foo-bar')}`,
        );
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
          $t<ASTv1.MustacheStatement>(`{{foo true null undefined}}`, ['foo']),
        ).toEqual(`$:() => ${$mh('foo', 'true,null,undefined')}`);
      });
      test('support number literals as helper args', () => {
        expect(
          $t<ASTv1.MustacheStatement>(`{{foo 42 3.14}}`, ['foo']),
        ).toEqual(`$:() => ${$mh('foo', '42,3.14')}`);
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
          $t<ASTv1.ElementNode>(
            `<div class="{{foo}} bar {{boo baks}}"></div>`,
            ['foo', 'boo'],
          ),
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
        expect(
          $t<ASTv1.ElementNode>(`<div class={{foo}}></div>`, ['foo']),
        ).toEqual(
          $node({
            tag: 'div',
            properties: [['', '$:foo']],
          }),
        );
      });
      test('converts a simple element with path attribute with string literal', () => {
        expect(
          $t<ASTv1.ElementNode>(`<div class={{foo "bar"}}></div>`, ['foo']),
        ).toEqual(
          $node({
            tag: 'div',
            properties: [['', `$:() => ${$mh('foo', '"bar"')}`]],
          }),
        );
      });
      test('converts a simple element with path attribute with path literal', () => {
        expect(
          $t<ASTv1.ElementNode>(`<div class={{foo bar}}></div>`, ['foo']),
        ).toEqual(
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
          $t<ASTv1.ElementNode>(`<div {{on "click" (foo bar baz)}}></div>`, [
            'foo',
          ]),
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
          ['optional'],
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
          $t<ASTv1.BlockStatement>(`{{#if (foo bar)}}123{{else}}456{{/if}}`, [
            'foo',
          ]),
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
            ['foo'],
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
          `$:...(() => {let self = this;let Let_bar_6c3gez6 = $:() => $:foo;let Let_k_6c3gez6 = "name";return ["p", ${
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
          ['Div'],
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
      test('it replaces this. with self. in let variable declarations', () => {
        const result = $t<ASTv1.BlockStatement>(
          `{{#let this.foo as |bar|}}{{bar}}{{/let}}`,
        );
        // this.foo in the variable declaration should become self.foo
        expect(result).toContain('let self = this;');
        expect(result).toContain('self.foo');
      });
      test('it does not replace variable names after dots', () => {
        // Testing fixChildScopes regex - should NOT replace foo.bar where bar is a let variable
        const result = $t<ASTv1.BlockStatement>(
          `{{#let "test" as |bar|}}{{foo.bar}}{{/let}}`,
          ['foo'],
        );
        // foo.bar should stay as foo.bar (not foo.Let_bar_...)
        expect(result).toContain('foo.bar');
        expect(result).not.toMatch(/foo\.Let_bar/);
      });
      test('let with null literal value', () => {
        const result = $t<ASTv1.BlockStatement>(
          `{{#let null as |bar|}}{{bar}}{{/let}}`,
        );
        expect(result).toContain('let self = this;');
        expect(result).toContain('Let_bar_');
        expect(result).toContain('= null');
      });
      test('let with boolean literal value', () => {
        const result = $t<ASTv1.BlockStatement>(
          `{{#let true as |bar|}}{{bar}}{{/let}}`,
        );
        expect(result).toContain('let self = this;');
        expect(result).toContain('= true');
      });
      test('let with undefined literal value', () => {
        const result = $t<ASTv1.BlockStatement>(
          `{{#let undefined as |bar|}}{{bar}}{{/let}}`,
        );
        expect(result).toContain('let self = this;');
        expect(result).toContain('= undefined');
      });
      test('let with number literal value', () => {
        const result = $t<ASTv1.BlockStatement>(
          `{{#let 42 as |bar|}}{{bar}}{{/let}}`,
        );
        expect(result).toContain('let self = this;');
        expect(result).toContain('= 42');
      });
    });
    describe('each condition', () => {
      test('it wraps index reference', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each smf as |el idx|}}<div>{{el}}{{idx}}</div>{{/each}}`,
        );
        expect(converted).toEqual<HBSControlExpression>(
          $control({
            type: 'each',
            condition: $glimmerCompat('$:smf'),
            blockParams: ['el', 'idx'],
            children: [
              $node({
                tag: 'div',
                children: ['$:el', '$:idx'],
                hasStableChild: false,
              }),
            ],
          }),
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'smf',
          )}, (el,idx,ctx0) => $_ucw((ctx1) => [$_tag('div', $_edp, [${$glimmerCompat(
            'el',
          )}, ${$glimmerCompat('idx.value')}], ctx1)], ctx0), null, this)`,
        );
      });
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
          )}, ($noop,$index,ctx0) => $_tag('div', $_edp, [], ctx0), null, this)`,
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
          )}, (bar,$index,ctx0) => $_ucw((ctx1) => [$_tag('div', $_edp, [], ctx1), $_tag('span', $_edp, [], ctx1)], ctx0), null, this)`,
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
          )}, (bar,$index,ctx0) => $_tag('div', $_edp, [], ctx0), null, this)`,
        );
      });
      test('it do not add UnstableChildWrapper if we have component surrounded by empty text', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each foo as |bar|}}   <Smile />   {{/each}}`,
          ['Smile'],
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'foo',
          )}, (bar,$index,ctx0) => $_c(Smile,${$args(
            '{}',
          )},ctx0), null, this)`,
        );
      });
      test('it add UnstableChildWrapper if component surrounded my meaningful text245', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#each foo as |bar|}}1<Smile />{{/each}}`,
          ['Smile'],
        );
        expect($s(converted)).toEqual(
          `$_each(${$glimmerCompat(
            'foo',
          )}, (bar,$index,ctx0) => $_ucw((ctx1) => ["1", $_c(Smile,${$args(
            '{}',
          )},ctx1)], ctx0), null, this)`,
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

    describe('SVG namespace handling', () => {
      test('wraps svg element in namespace provider', () => {
        const converted = $t<ASTv1.ElementNode>(`<svg></svg>`);
        expect(converted).toEqual(
          $node({
            tag: `$:${SYMBOLS.SVG_NAMESPACE}`,
            children: [
              $node({
                tag: 'svg',
              }),
            ],
          }),
        );
      });

      test('svg with children is properly wrapped', () => {
        const converted = $t<ASTv1.ElementNode>(`<svg><rect></rect></svg>`);
        expect(converted).toEqual(
          $node({
            tag: `$:${SYMBOLS.SVG_NAMESPACE}`,
            children: [
              $node({
                tag: 'svg',
                children: [$node({ tag: 'rect' })],
              }),
            ],
          }),
        );
      });
    });

    describe('MathML namespace handling', () => {
      test('wraps math element in namespace provider', () => {
        const converted = $t<ASTv1.ElementNode>(`<math></math>`);
        expect(converted).toEqual(
          $node({
            tag: `$:${SYMBOLS.MATH_NAMESPACE}`,
            children: [
              $node({
                tag: 'math',
              }),
            ],
          }),
        );
      });
    });

    describe('foreignObject handling', () => {
      test('wraps foreignObject children in HTML namespace', () => {
        const converted = $t<ASTv1.ElementNode>(`<foreignObject><div></div></foreignObject>`) as HBSNode;
        expect(converted.tag).toEqual('foreignObject');
        expect(converted.children).toHaveLength(1);
        const wrapper = converted.children[0] as HBSNode;
        expect(wrapper.tag).toEqual(`$:${SYMBOLS.HTML_NAMESPACE}`);
        expect(wrapper.children).toHaveLength(1);
        expect((wrapper.children[0] as HBSNode).tag).toEqual('div');
      });
    });

    describe('style.* attribute events', () => {
      test('converts style.property to event', () => {
        const converted = $t<ASTv1.ElementNode>(`<div style.color="red"></div>`);
        expect(converted).toEqual(
          $node({
            tag: 'div',
            events: [
              [EVENT_TYPE.ON_CREATED, expect.stringContaining("style.setProperty('color'")],
            ],
          }),
        );
      });

      test('converts dynamic style.property', () => {
        const converted = $t<ASTv1.ElementNode>(`<div style.color={{myColor}}></div>`, ['myColor']);
        expect(converted).toEqual(
          $node({
            tag: 'div',
            events: [
              [EVENT_TYPE.ON_CREATED, expect.stringContaining("style.setProperty('color'")],
            ],
          }),
        );
      });
    });

    describe('in-element block', () => {
      test('converts in-element block', () => {
        const converted = $t<ASTv1.BlockStatement>(`{{#in-element destination}}<div></div>{{/in-element}}`) as HBSControlExpression;
        expect(converted.type).toEqual('in-element');
        expect(converted.isControl).toBe(true);
        expect(converted.children).toHaveLength(1);
        expect((converted.children[0] as HBSNode).tag).toEqual('div');
      });
    });

    describe('yield handling', () => {
      test('converts basic yield', () => {
        const converted = $t<ASTv1.MustacheStatement>(`{{yield}}`);
        expect(converted).toEqual(
          $control({
            type: 'yield',
            condition: '',
            blockParams: [],
            children: [],
            inverse: [],
            key: 'default',
            isSync: true,
          }),
        );
      });

      test('converts yield with params', () => {
        const converted = $t<ASTv1.MustacheStatement>(`{{yield foo bar}}`, ['foo', 'bar']);
        expect(converted).toEqual(
          $control({
            type: 'yield',
            condition: '',
            blockParams: ['$:foo', '$:bar'],
            children: [],
            inverse: [],
            key: 'default',
            isSync: true,
          }),
        );
      });

      test('converts yield to named slot', () => {
        const converted = $t<ASTv1.MustacheStatement>(`{{yield to="header"}}`);
        expect(converted).toEqual(
          $control({
            type: 'yield',
            condition: '',
            blockParams: [],
            children: [],
            inverse: [],
            key: '"header"',
            isSync: true,
          }),
        );
      });
    });

    describe('boolean attributes', () => {
      test('converts empty disabled to true', () => {
        const converted = $t<ASTv1.ElementNode>(`<input disabled />`);
        expect(converted).toEqual(
          $node({
            tag: 'input',
            selfClosing: true,
            properties: [['disabled', true]],
          }),
        );
      });

      test('converts empty readonly to readOnly true', () => {
        const converted = $t<ASTv1.ElementNode>(`<input readonly />`);
        expect(converted).toEqual(
          $node({
            tag: 'input',
            selfClosing: true,
            properties: [['readOnly', true]],
          }),
        );
      });

      test('converts empty checked to true', () => {
        const converted = $t<ASTv1.ElementNode>(`<input checked />`);
        expect(converted).toEqual(
          $node({
            tag: 'input',
            selfClosing: true,
            properties: [['checked', true]],
          }),
        );
      });
    });

    describe('component slots', () => {
      test('named slots are properly parsed', () => {
        const converted = $t<ASTv1.ElementNode>(
          `<Card><:header>Title</:header><:body>Content</:body></Card>`,
          ['Card'],
        );
        expect(converted).toEqual(
          $node({
            tag: 'Card',
            hasStableChild: false,
            children: [
              $node({
                tag: ':header',
                children: ['Title'],
              }),
              $node({
                tag: ':body',
                children: ['Content'],
              }),
            ],
          }),
        );
      });

      test('slots with block params', () => {
        const converted = $t<ASTv1.ElementNode>(
          `<List as |item|><div>{{item}}</div></List>`,
          ['List'],
        ) as HBSNode;
        expect(converted.tag).toEqual('List');
        expect(converted.blockParams).toEqual(['item']);
        expect(converted.children).toHaveLength(1);
        const div = converted.children[0] as HBSNode;
        expect(div.tag).toEqual('div');
        // item reference is in children or events
        const hasItemRef = div.children.some(c =>
          typeof c === 'string' && c.includes('item')
        ) || div.events.some(e =>
          typeof e[1] === 'string' && e[1].includes('item')
        );
        expect(hasItemRef).toBe(true);
      });
    });

    describe('has-block helpers', () => {
      test('has-block is converted to helper call', () => {
        const converted = $t<ASTv1.MustacheStatement>(`{{has-block}}`);
        expect(converted).toEqual(expect.stringContaining('$_hasBlock'));
      });

      test('has-block-params is converted to helper call', () => {
        const converted = $t<ASTv1.MustacheStatement>(`{{has-block-params}}`);
        expect(converted).toEqual(expect.stringContaining('$_hasBlockParams'));
      });
    });

    describe('edge cases', () => {
      test('preserves &nbsp; character', () => {
        const converted = $t<ASTv1.ElementNode>(`<span>&nbsp;</span>`);
        expect(converted).not.toEqual(null);
        expect((converted as HBSNode).events).toBeDefined();
      });

      test('SubExpression with hash args', () => {
        const converted = $t<ASTv1.MustacheStatement>(
          `{{call (helper a=1 b="test")}}`,
          ['call', 'helper'],
        );
        // Hash args should be passed to the helper
        expect(typeof converted).toBe('string');
        expect(converted).toContain('helper');
      });

      test('let block with complex this reference', () => {
        const origRandom = Math.random;
        Math.random = () => 0.001;
        try {
          const result = $t<ASTv1.BlockStatement>(
            `{{#let this.items.first as |item|}}{{item.name}}{{/let}}`,
          );
          expect(result).toContain('self.items');
        } finally {
          Math.random = origRandom;
        }
      });

      test('unless in subexpression with 2 params', () => {
        const result = $t<ASTv1.MustacheStatement>(
          `{{call (unless foo "bar")}}`,
          ['call'],
        );
        expect(result).toContain('$__if');
        expect(result).toContain('""');
      });

      test('helper path with dots in patchNodePath', () => {
        // This should trigger the path.includes('.') branch in patchNodePath
        const result = $t<ASTv1.MustacheStatement>(
          `{{foo.bar.baz}}`,
          ['foo'],
        );
        // Should have optional chaining applied
        expect(result).toContain('foo?.bar?.baz');
      });

      test('handles empty element', () => {
        const converted = $t<ASTv1.ElementNode>(`<div></div>`);
        expect(converted).toEqual($node({ tag: 'div' }));
      });

      test('handles self-closing element', () => {
        const converted = $t<ASTv1.ElementNode>(`<br />`);
        expect(converted).toEqual($node({ tag: 'br', selfClosing: true }));
      });

      test('handles multiple modifiers', () => {
        const converted = $t<ASTv1.ElementNode>(`<div {{foo-bar}} {{baz-qux}}></div>`);
        expect(converted).toEqual(
          $node({
            tag: 'div',
            events: [
              [EVENT_TYPE.ON_CREATED, $mm('foo-bar')],
              [EVENT_TYPE.ON_CREATED, $mm('baz-qux')],
            ],
          }),
        );
      });

      test('handles nested conditionals', () => {
        const converted = $t<ASTv1.BlockStatement>(
          `{{#if foo}}{{#if bar}}nested{{/if}}{{/if}}`,
        );
        expect(converted).toEqual(
          $control({
            condition: $glimmerCompat('$:foo'),
            children: [
              $control({
                condition: $glimmerCompat('$:bar'),
                children: ['nested'],
              }),
            ],
          }),
        );
      });
    });
  });

  describe('seenNodes tracking', () => {
    test('adds processed nodes to seenNodes set', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`<div>hello</div>`);
      const node = ast.body[0] as ASTv1.ElementNode;

      expect(seenNodes.size).toBe(0);
      ToJSType(node);
      // Should have added the element node to seenNodes
      expect(seenNodes.has(node)).toBe(true);
    });

    test('adds child nodes inside #each to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each items as |item|}}<div>{{item.name}}</div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      ToJSType(blockNode);

      // BlockStatement should be in seenNodes
      expect(seenNodes.has(blockNode)).toBe(true);

      // Child ElementNode (div) should also be in seenNodes
      const divNode = blockNode.program.body[0] as ASTv1.ElementNode;
      expect(seenNodes.has(divNode)).toBe(true);

      // MustacheStatement ({{item.name}}) inside div should be in seenNodes
      const mustacheNode = divNode.children[0] as ASTv1.MustacheStatement;
      expect(seenNodes.has(mustacheNode)).toBe(true);
    });

    test('adds child nodes inside #if to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#if condition}}<span>content</span>{{/if}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      ToJSType(blockNode);

      // BlockStatement should be in seenNodes
      expect(seenNodes.has(blockNode)).toBe(true);

      // Child ElementNode (span) should also be in seenNodes
      const spanNode = blockNode.program.body[0] as ASTv1.ElementNode;
      expect(seenNodes.has(spanNode)).toBe(true);
    });

    test('adds nested block children to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each items as |item|}}{{#if item.visible}}<p>{{item.name}}</p>{{/if}}{{/each}}`);
      const eachNode = ast.body[0] as ASTv1.BlockStatement;

      ToJSType(eachNode);

      // Outer #each should be in seenNodes
      expect(seenNodes.has(eachNode)).toBe(true);

      // Inner #if should be in seenNodes
      const ifNode = eachNode.program.body[0] as ASTv1.BlockStatement;
      expect(seenNodes.has(ifNode)).toBe(true);

      // Nested p element should be in seenNodes
      const pNode = ifNode.program.body[0] as ASTv1.ElementNode;
      expect(seenNodes.has(pNode)).toBe(true);
    });

    test('block params are correctly scoped in generated output', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each this.routes as |route|}}<div>{{route.name}}</div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpression;

      // Block params should include 'route'
      expect(result.blockParams).toContain('route');

      // Children should reference route.name correctly
      const divChild = result.children[0] as HBSNode;
      expect(divChild.tag).toBe('div');

      // The text content event should reference route.name
      const textEvent = divChild.events.find(e => e[0] === '1');
      expect(textEvent).toBeDefined();
      expect(textEvent![1]).toContain('route.name');
    });

    test('adds TextNode parts in ConcatStatement to seenNodes', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`<div class="prefix-{{value}}-suffix"></div>`);
      const elementNode = ast.body[0] as ASTv1.ElementNode;

      ToJSType(elementNode);

      // Element should be in seenNodes
      expect(seenNodes.has(elementNode)).toBe(true);

      // The ConcatStatement attribute value
      const classAttr = elementNode.attributes.find(a => a.name === 'class');
      expect(classAttr).toBeDefined();

      if (classAttr && classAttr.value.type === 'ConcatStatement') {
        // TextNode parts should be in seenNodes
        const textParts = classAttr.value.parts.filter(p => p.type === 'TextNode');
        textParts.forEach(part => {
          expect(seenNodes.has(part)).toBe(true);
        });
      }
    });
  });

  describe('condition wrapping for reactivity', () => {
    test('each condition is wrapped with getter in compat mode', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each this.items as |item|}}<div></div>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpression;
      const serialized = serializeNode(result);

      // In glimmer compat mode, the condition should be wrapped in () =>
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_each(() => this.items');
      } else {
        expect(serialized).toContain('$_each(this.items');
      }
    });

    test('if condition is wrapped with getter in compat mode', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#if this.visible}}<div></div>{{/if}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpression;
      const serialized = serializeNode(result);

      // In glimmer compat mode, the condition should be wrapped in () =>
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_if(() => this.visible');
      } else {
        expect(serialized).toContain('$_if(this.visible');
      }
    });

    test('each with path expression condition is properly wrapped', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set(['myArray']));
      const ast = preprocess(`{{#each myArray as |item|}}<span></span>{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpression;
      const serialized = serializeNode(result);

      // Condition should be wrapped for reactivity
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_each(() => myArray');
      }
    });

    test('nested each blocks have wrapped conditions', () => {
      const seenNodes: Set<ASTv1.Node> = new Set();
      const { ToJSType } = convert(seenNodes, flags, new Set());
      const ast = preprocess(`{{#each this.outer as |o|}}{{#each o.inner as |i|}}<p></p>{{/each}}{{/each}}`);
      const blockNode = ast.body[0] as ASTv1.BlockStatement;

      const result = ToJSType(blockNode) as HBSControlExpression;
      const serialized = serializeNode(result);

      // Both outer and inner each should have wrapped conditions
      if (flags.IS_GLIMMER_COMPAT_MODE) {
        expect(serialized).toContain('$_each(() => this.outer');
        expect(serialized).toContain('$_each(() => o.inner');
      }
    });
  });
});
