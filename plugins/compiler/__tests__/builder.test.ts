import { describe, test, expect } from 'vitest';
import {
  B,
  serializeJS,
  string,
  num,
  bool,
  nil,
  undef,
  id,
  member,
  optionalMember,
  computedMember,
  path,
  call,
  methodCall,
  arrow,
  getter,
  func,
  array,
  object,
  prop,
  shorthand,
  spread,
  emptyArray,
  emptyObject,
  tupleArray,
  binary,
  conditional,
  raw,
  runtimeRef,
  reactiveGetter,
  methodBinding,
  iife,
  formattedArray,
  styleSetter,
  elementHelperWrapper,
  varDecl,
  constDecl,
  ret,
  exprStmt,
  expr,
} from '../builder';

describe('Code Builder', () => {
  describe('Literals', () => {
    test('string literal', () => {
      expect(serializeJS(string('hello'))).toBe('"hello"');
    });

    test('string with special chars', () => {
      expect(serializeJS(string('he"llo'))).toBe('"he\\"llo"');
    });

    test('number literal', () => {
      expect(serializeJS(num(42))).toBe('42');
    });

    test('boolean literal', () => {
      expect(serializeJS(bool(true))).toBe('true');
      expect(serializeJS(bool(false))).toBe('false');
    });

    test('null', () => {
      expect(serializeJS(nil())).toBe('null');
    });

    test('undefined', () => {
      expect(serializeJS(undef())).toBe('undefined');
    });
  });

  describe('Identifiers and Paths', () => {
    test('identifier', () => {
      expect(serializeJS(id('foo'))).toBe('foo');
    });

    test('member expression', () => {
      expect(serializeJS(member(id('foo'), 'bar'))).toBe('foo.bar');
    });

    test('optional member expression', () => {
      expect(serializeJS(optionalMember(id('foo'), 'bar'))).toBe('foo?.bar');
    });

    test('computed member expression', () => {
      expect(serializeJS(computedMember(id('foo'), string('bar')))).toBe('foo["bar"]');
    });

    test('member expression with hyphenated property uses bracket notation', () => {
      // Hyphenated property names are not valid JS identifiers, so they must use bracket notation
      expect(serializeJS(member(id('obj'), 'my-component'))).toBe('obj["my-component"]');
    });

    test('optional member expression with hyphenated property uses bracket notation', () => {
      expect(serializeJS(optionalMember(id('obj'), 'my-component'))).toBe('obj?.["my-component"]');
    });

    test('path helper', () => {
      expect(serializeJS(path('this.foo.bar'))).toBe('this.foo.bar');
    });

    test('path with single part', () => {
      expect(serializeJS(path('foo'))).toBe('foo');
    });
  });

  describe('Function Calls', () => {
    test('simple call', () => {
      expect(serializeJS(call('foo', []))).toBe('foo()');
    });

    test('call with arguments', () => {
      expect(serializeJS(call('foo', [string('a'), num(1)]))).toBe('foo("a", 1)');
    });

    test('method call', () => {
      expect(serializeJS(methodCall(id('obj'), 'method', [string('arg')]))).toBe(
        'obj.method("arg")'
      );
    });

    test('call with string callee', () => {
      // $_tag is a PURE function, so it gets the /*#__PURE__*/ annotation
      expect(serializeJS(call('$_tag', [string('div')]))).toBe('/*#__PURE__*/$_tag("div")');
    });
  });

  describe('Functions', () => {
    test('arrow function', () => {
      expect(serializeJS(arrow(['x'], id('x')))).toBe('x => x');
    });

    test('arrow function with multiple params', () => {
      expect(serializeJS(arrow(['a', 'b'], binary('+', id('a'), id('b'))))).toBe(
        '(a, b) => a + b'
      );
    });

    test('getter function', () => {
      expect(serializeJS(getter(path('this.value')))).toBe('() => this.value');
    });

    test('function expression', () => {
      expect(serializeJS(func(['x'], [ret(id('x'))]))).toBe('function(x){return x;}');
    });

    test('named function expression', () => {
      expect(serializeJS(func(['x'], [ret(id('x'))], 'foo'))).toBe(
        'function foo(x){return x;}'
      );
    });

    test('formatted function with single statement', () => {
      const fn = func(['x'], [ret(id('x'))], undefined, undefined, true);
      const code = serializeJS(fn);

      // Should have newlines and indentation
      expect(code).toContain('\n');
      expect(code).toMatch(/\n\s+return x;/);
    });

    test('formatted function with multiple statements', () => {
      const fn = func(
        ['a', 'b'],
        [
          constDecl('sum', binary('+', id('a'), id('b'))),
          ret(id('sum')),
        ],
        undefined,
        undefined,
        true
      );
      const code = serializeJS(fn);

      // Should have each statement on its own line
      expect(code).toContain('\n');
      expect(code).toMatch(/\n\s+const sum/);
      expect(code).toMatch(/\n\s+return sum;/);
    });

    test('inline function when formatted is false', () => {
      const fn = func(['x'], [ret(id('x'))], undefined, undefined, false);
      const code = serializeJS(fn);

      // Should be on one line
      expect(code).not.toContain('\n');
      expect(code).toBe('function(x){return x;}');
    });

    test('formatted function with empty body', () => {
      const fn = func([], [], undefined, undefined, true);
      const code = serializeJS(fn);

      // Empty body should still be valid (has opening newline and closing newline)
      expect(code).toBe('function(){\n\n}');
    });

    test('formatted named function', () => {
      const fn = func(['x'], [ret(id('x'))], 'myFunc', undefined, true);
      const code = serializeJS(fn);

      expect(code).toContain('function myFunc');
      expect(code).toContain('\n');
    });
  });

  describe('Arrays', () => {
    test('empty array', () => {
      expect(serializeJS(emptyArray())).toBe('[]');
    });

    test('array with elements', () => {
      expect(serializeJS(array([string('a'), num(1)]))).toBe('["a", 1]');
    });

    test('nested arrays', () => {
      expect(
        serializeJS(array([array([string('a'), string('b')]), array([string('c')])]))
      ).toBe('[["a", "b"], ["c"]]');
    });

    test('tuple array helper', () => {
      expect(serializeJS(tupleArray([['a', num(1)], ['b', num(2)]]))).toBe(
        '[["a", 1], ["b", 2]]'
      );
    });
  });

  describe('Objects', () => {
    test('empty object', () => {
      expect(serializeJS(emptyObject())).toBe('{}');
    });

    test('object with properties', () => {
      expect(serializeJS(object([prop('a', num(1)), prop('b', num(2))]))).toBe(
        '{ a: 1, b: 2 }'
      );
    });

    test('shorthand property', () => {
      expect(serializeJS(object([shorthand('foo')]))).toBe('{ foo }');
    });

    test('spread in array', () => {
      expect(serializeJS(array([spread(id('items'))]))).toBe('[...items]');
    });
  });

  describe('Operators', () => {
    test('binary expression', () => {
      expect(serializeJS(binary('+', num(1), num(2)))).toBe('1 + 2');
    });

    test('conditional expression', () => {
      expect(serializeJS(conditional(id('cond'), string('a'), string('b')))).toBe(
        'cond ? "a" : "b"'
      );
    });

    test('complex binary', () => {
      expect(serializeJS(binary('&&', id('a'), binary('||', id('b'), id('c'))))).toBe(
        'a && b || c'
      );
    });
  });

  describe('Raw Code', () => {
    test('raw code passthrough', () => {
      expect(serializeJS(raw('$:() => this.value'))).toBe('$:() => this.value');
    });
  });

  describe('Runtime References', () => {
    test('runtimeRef serializes symbol as-is', () => {
      expect(serializeJS(runtimeRef('$_slot'))).toBe('$_slot');
    });

    test('runtimeRef with complex symbol', () => {
      expect(serializeJS(runtimeRef('$_inElement'))).toBe('$_inElement');
    });

    test('runtimeRef preserves sourceRange', () => {
      const ref = runtimeRef('$_if', { start: 0, end: 5 });
      expect(ref.sourceRange).toEqual({ start: 0, end: 5 });
    });
  });

  describe('Reactive Getters', () => {
    test('reactiveGetter wraps expression', () => {
      expect(serializeJS(reactiveGetter(id('this.value')))).toBe('() => this.value');
    });

    test('reactiveGetter with path', () => {
      expect(serializeJS(reactiveGetter(path('this.foo.bar')))).toBe('() => this.foo.bar');
    });

    test('reactiveGetter with call expression', () => {
      const expr = reactiveGetter(call('helper', [id('arg')]));
      expect(serializeJS(expr)).toBe('() => helper(arg)');
    });

    test('reactiveGetter preserves sourceRange', () => {
      const getter = reactiveGetter(id('x'), { start: 0, end: 10 });
      expect(getter.sourceRange).toEqual({ start: 0, end: 10 });
    });

    test('nested reactiveGetter', () => {
      const inner = reactiveGetter(id('inner'));
      const outer = reactiveGetter(inner);
      expect(serializeJS(outer)).toBe('() => () => inner');
    });
  });

  describe('Statements', () => {
    test('const declaration', () => {
      expect(serializeJS(constDecl('foo', num(42)))).toBe('const foo = 42;');
    });

    test('var declaration without init', () => {
      expect(serializeJS(varDecl('var', 'foo'))).toBe('var foo;');
    });

    test('return statement', () => {
      expect(serializeJS(ret(id('value')))).toBe('return value;');
    });

    test('expression statement', () => {
      expect(serializeJS(exprStmt(call('console.log', [string('hi')])))).toBe(
        'console.log("hi");'
      );
    });
  });

  describe('expr utility', () => {
    test('converts primitives', () => {
      expect(serializeJS(expr('hello'))).toBe('"hello"');
      expect(serializeJS(expr(42))).toBe('42');
      expect(serializeJS(expr(true))).toBe('true');
      expect(serializeJS(expr(null))).toBe('null');
      expect(serializeJS(expr(undefined))).toBe('undefined');
    });

    test('passes through expressions', () => {
      const e = id('foo');
      expect(expr(e)).toBe(e);
    });
  });

  describe('B namespace', () => {
    test('provides all builders', () => {
      expect(serializeJS(B.call('foo', [B.string('bar')]))).toBe('foo("bar")');
    });
  });

  describe('Complex compositions', () => {
    test('$_tag call', () => {
      const code = serializeJS(
        call('$_tag', [
          string('div'),
          array([array([string('class'), string('foo')])]),
          array([string('Hello')]),
          id('this'),
        ])
      );
      // $_tag is a PURE function
      expect(code).toBe('/*#__PURE__*/$_tag("div", [["class", "foo"]], ["Hello"], this)');
    });

    test('component call with slots', () => {
      const code = serializeJS(
        call('$_c', [
          id('MyComponent'),
          object([prop('title', string('Hello'))]),
          array([
            arrow(
              ['$slots'],
              call('$_slot', [string('default'), getter(emptyArray()), id('$slots'), id('this')])
            ),
          ]),
          id('this'),
        ])
      );
      // $_c gets PURE at root level; $_slot is inside arrow body so no PURE
      expect(code).toBe(
        '/*#__PURE__*/$_c(MyComponent, { title: "Hello" }, [$slots => $_slot("default", () => [], $slots, this)], this)'
      );
    });

    test('control flow', () => {
      const code = serializeJS(
        call('$_if', [
          getter(path('this.show')),
          arrow(['ctx0'], array([string('visible')])),
          arrow(['ctx0'], array([string('hidden')])),
          id('this'),
        ])
      );
      // $_if is a PURE function
      expect(code).toBe(
        '/*#__PURE__*/$_if(() => this.show, ctx0 => ["visible"], ctx0 => ["hidden"], this)'
      );
    });

    test('event handler with tail args', () => {
      const code = serializeJS(
        arrow(
          ['$e', '$n'],
          call(path('this.handleClick'), [id('$e'), id('$n'), string('extra')])
        )
      );
      expect(code).toBe('($e, $n) => this.handleClick($e, $n, "extra")');
    });
  });

  describe('Formatting', () => {
    test('formats arrays with multiple elements', () => {
      const code = serializeJS(
        array([string('a'), string('b'), string('c')]),
        { format: true }
      );
      expect(code).toContain('\n');
      expect(code).toContain('  "a"');
    });

    test('formats objects with multiple properties', () => {
      const code = serializeJS(
        object([prop('a', num(1)), prop('b', num(2)), prop('c', num(3))]),
        { format: true }
      );
      expect(code).toContain('\n');
      expect(code).toContain('  a:');
    });
  });

  describe('Advanced Builders', () => {
    describe('methodBinding', () => {
      test('simple binding with null this', () => {
        const fn = func(['x'], [ret(id('x'))]);
        const code = serializeJS(methodBinding(fn, nil(), []));
        expect(code).toBe('function(x){return x;}.bind(null)');
      });

      test('binding with bound args', () => {
        const fn = func(['a', 'b'], [ret(binary('+', id('a'), id('b')))]);
        const code = serializeJS(methodBinding(fn, nil(), [num(1)]));
        expect(code).toBe('function(a, b){return a + b;}.bind(null, 1)');
      });

      test('binding with this and multiple args', () => {
        const fn = id('callback');
        const code = serializeJS(methodBinding(fn, id('ctx'), [string('a'), num(42)]));
        expect(code).toBe('callback.bind(ctx, "a", 42)');
      });
    });

    describe('iife', () => {
      test('simple iife', () => {
        const code = serializeJS(iife(['x'], [ret(id('x'))], [num(5)]));
        expect(code).toBe('(function(x){return x;})(5)');
      });

      test('iife with multiple params and args', () => {
        const code = serializeJS(iife(['a', 'b'], [ret(binary('+', id('a'), id('b')))], [num(1), num(2)]));
        expect(code).toBe('(function(a, b){return a + b;})(1, 2)');
      });
    });

    describe('formattedArray', () => {
      test('empty formatted array', () => {
        const code = serializeJS(formattedArray([], true));
        expect(code).toBe('[]');
      });

      test('single element formatted array respects multiline flag', () => {
        const code = serializeJS(formattedArray([string('a')], true));
        // When multiline is true, format even with single element
        expect(code).toBe('[\n  "a"\n]');
      });

      test('single element formatted array stays inline when multiline is false', () => {
        const code = serializeJS(formattedArray([string('a')], false));
        expect(code).toBe('["a"]');
      });

      test('multiline formatted array with multiple elements', () => {
        const code = serializeJS(formattedArray([string('a'), string('b'), string('c')], true));
        expect(code).toContain('\n');
        expect(code).toContain('  "a"');
        expect(code).toContain('  "b"');
        expect(code).toContain('  "c"');
      });

      test('inline formatted array when multiline is false', () => {
        const code = serializeJS(formattedArray([string('a'), string('b')], false));
        expect(code).toBe('["a", "b"]');
      });
    });

    describe('styleSetter', () => {
      test('creates style setter binding', () => {
        const code = serializeJS(styleSetter('color', string('red'), {
          TO_VALUE: '$_TO_VALUE',
          LOCAL_VALUE: '$v',
          LOCAL_NODE: '$n',
        }));
        expect(code).toContain('style.setProperty');
        expect(code).toContain('"color"');
        expect(code).toContain('$_TO_VALUE("red")');
        expect(code).toContain('.bind(null');
      });

      test('style setter with reactive getter', () => {
        const code = serializeJS(styleSetter('width', reactiveGetter(path('this.width')), {
          TO_VALUE: '$_TO_VALUE',
          LOCAL_VALUE: '$v',
          LOCAL_NODE: '$n',
        }));
        expect(code).toContain('style.setProperty');
        expect(code).toContain('"width"');
        expect(code).toContain('$_TO_VALUE(() => this.width)');
      });
    });

    describe('elementHelperWrapper', () => {
      test('creates wrapper function', () => {
        const code = serializeJS(elementHelperWrapper(string('div'), {
          GET_ARGS: '$_GET_ARGS',
          GET_FW: '$_GET_FW',
          GET_SLOTS: '$_GET_SLOTS',
          FINALIZE_COMPONENT: '$_fin',
          TAG: '$_tag',
          SLOT: '$_slot',
          LOCAL_FW: '$fw',
          LOCAL_SLOTS: '$slots',
        }));
        expect(code).toContain('function(args)');
        expect(code).toContain('$_GET_ARGS(this, arguments)');
        expect(code).toContain('const $fw = $_GET_FW(this, arguments)');
        expect(code).toContain('const $slots = $_GET_SLOTS(this, arguments)');
        expect(code).toContain('$_fin');
        expect(code).toContain('$_tag("div"');
        expect(code).toContain('$_slot("default"');
      });

      test('wrapper with dynamic tag expression', () => {
        const code = serializeJS(elementHelperWrapper(path('this.tagName'), {
          GET_ARGS: '$_GET_ARGS',
          GET_FW: '$_GET_FW',
          GET_SLOTS: '$_GET_SLOTS',
          FINALIZE_COMPONENT: '$_fin',
          TAG: '$_tag',
          SLOT: '$_slot',
          LOCAL_FW: '$fw',
          LOCAL_SLOTS: '$slots',
        }));
        expect(code).toContain('$_tag(this.tagName');
      });

      test('wrapper has multiline formatting', () => {
        const code = serializeJS(elementHelperWrapper(string('div'), {
          GET_ARGS: '$_GET_ARGS',
          GET_FW: '$_GET_FW',
          GET_SLOTS: '$_GET_SLOTS',
          FINALIZE_COMPONENT: '$_fin',
          TAG: '$_tag',
          SLOT: '$_slot',
          LOCAL_FW: '$fw',
          LOCAL_SLOTS: '$slots',
        }));
        // Should be multiline
        expect(code).toContain('\n');
        // Each statement on its own line with indentation
        expect(code).toMatch(/\n\s+\$_GET_ARGS/);
        expect(code).toMatch(/\n\s+const \$fw/);
        expect(code).toMatch(/\n\s+const \$slots/);
        expect(code).toMatch(/\n\s+return/);
      });
    });
  });
});
