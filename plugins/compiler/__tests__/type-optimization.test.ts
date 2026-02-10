import { describe, test, expect } from 'vitest';
import { compile } from '../compile';
import type { CompileOptions, TypeHints } from '../types';

function compileWith(template: string, typeHints?: TypeHints, extraFlags?: Record<string, boolean>): string {
  const options: CompileOptions = {
    flags: {
      IS_GLIMMER_COMPAT_MODE: true,
      WITH_TYPE_OPTIMIZATION: extraFlags?.WITH_TYPE_OPTIMIZATION ?? !!typeHints,
      ...extraFlags,
    },
    typeHints,
  };
  const result = compile(template, options);
  expect(result.errors).toHaveLength(0);
  return result.code;
}

describe('type-directed optimization in compile pipeline', () => {
  test('plain (non-tracked) property skips getter wrapper', () => {
    const code = compileWith('{{this.title}}', {
      properties: { 'this.title': { kind: 'primitive' } },
    });
    // Non-tracked primitive is static — no getter wrapper
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    expect(code).toContain('this.title');
  });

  test('tracked property keeps getter wrapper', () => {
    const code = compileWith('{{this.count}}', {
      properties: { 'this.count': { kind: 'primitive', isTracked: true } },
    });
    // Tracked prop should be wrapped in () =>
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('no hint keeps getter wrapper', () => {
    const code = compileWith('{{this.unknown}}', {
      properties: {},
    });
    // Unknown prop should be wrapped in () =>
    expect(code).toMatch(/\(\)\s*=>\s*this\.unknown/);
  });

  test('optimization disabled keeps getter wrapper', () => {
    const code = compileWith('{{this.title}}', {
      properties: { 'this.title': { kind: 'primitive' } },
    }, { WITH_TYPE_OPTIMIZATION: false });
    // Should keep getter wrapper because optimization is disabled
    expect(code).toMatch(/\(\)\s*=>\s*this\.title/);
  });

  test('args keep getter wrapper even with primitive hints (conservative)', () => {
    const code = compileWith('{{@label}}', {
      args: { label: { kind: 'primitive' } },
    });
    // Arg reactivity depends on call-site values (often getter functions),
    // so getter wrapper is kept to preserve tracking.
    expect(code).toMatch(/\(\)\s*=>\s*\$a\.label/);
  });

  test('mixed tracked and untracked props in one template', () => {
    const code = compileWith('{{this.title}} {{this.count}}', {
      properties: {
        'this.title': { kind: 'primitive' },
        'this.count': { kind: 'primitive', isTracked: true },
      },
    });
    // title is plain = static, no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.title/);
    // count is tracked = reactive, keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('helper with primitive return hint still keeps getter wrapper', () => {
    const code = compileWith('{{myHelper this.x}}', {
      properties: {},
      helperReturns: { myHelper: { kind: 'primitive' } },
    });
    // Getter wrapper must be kept even with primitive return hint,
    // because the wrapper is the reactive tracking boundary for re-evaluation
    expect(code).toContain('myHelper');
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('no typeHints at all keeps getter wrapper', () => {
    const code = compileWith('{{this.title}}', undefined, { WITH_TYPE_OPTIMIZATION: false });
    // Without any hints, should keep getter wrapper
    expect(code).toMatch(/\(\)\s*=>\s*this\.title/);
  });

  test('tracked arg keeps getter wrapper', () => {
    const code = compileWith('{{@count}}', {
      args: { count: { kind: 'primitive', isTracked: true } },
    });
    // Tracked arg is reactive — keeps getter wrapper
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('object kind property keeps getter wrapper', () => {
    const code = compileWith('{{this.data}}', {
      properties: { 'this.data': { kind: 'object' } },
    });
    // Object kind → unknown reactivity → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.data/);
  });

  test('function kind property keeps getter wrapper', () => {
    const code = compileWith('{{this.handler}}', {
      properties: { 'this.handler': { kind: 'function' } },
    });
    // Function kind → unknown reactivity → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.handler/);
  });

  test('cell kind property keeps getter wrapper', () => {
    const code = compileWith('{{this.state}}', {
      properties: { 'this.state': { kind: 'cell' } },
    });
    // Cell kind in text rendering → keeps getter and accesses .value directly
    expect(code).toMatch(/\(\)\s*=>\s*this\.state\?\.value/);
  });

  test('cell kind in helper args does not force .value unwrapping', () => {
    const code = compileWith('{{myHelper this.state}}', {
      properties: { 'this.state': { kind: 'cell' } },
    });
    // Helper args must preserve Cell reference semantics
    expect(code).toContain('myHelper');
    expect(code).toContain('this.state');
    expect(code).not.toContain('this.state?.value');
  });

  test('textContent optimization path unwraps typed cell via .value', () => {
    const code = compileWith('<div>{{this.state}}</div>', {
      properties: { 'this.state': { kind: 'cell' } },
    });
    expect(code).toContain('"1"');
    expect(code).toContain('this.state?.value');
  });

  test('cell text path with compat mode off keeps cell reference', () => {
    const code = compileWith('{{this.state}}', {
      properties: { 'this.state': { kind: 'cell' } },
    }, {
      IS_GLIMMER_COMPAT_MODE: false,
    });
    expect(code).toContain('this.state');
    expect(code).not.toContain('.value');
  });

  test('tracked object kind keeps getter wrapper', () => {
    const code = compileWith('{{this.items}}', {
      properties: { 'this.items': { kind: 'object', isTracked: true } },
    });
    // Tracked object → reactive → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.items/);
  });

  test('readonly primitive skips getter wrapper', () => {
    const code = compileWith('{{this.version}}', {
      properties: { 'this.version': { kind: 'primitive', isReadonly: true } },
    });
    // Readonly primitive → static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.version/);
    expect(code).toContain('this.version');
  });

  test('readonly primitive literal is inlined', () => {
    const code = compileWith('{{this.VERSION}}', {
      properties: {
        'this.VERSION': { kind: 'primitive', isReadonly: true, literalValue: '1.2.3' },
      },
    });
    expect(code).toContain('"1.2.3"');
    expect(code).not.toContain('this.VERSION');
  });

  test('mutable primitive literal is not inlined', () => {
    const code = compileWith('{{this.value}}', {
      properties: {
        'this.value': { kind: 'primitive', literalValue: 7 },
      },
    });
    expect(code).toContain('this.value');
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.value/);
  });

  test('tracked readonly primitive literal is not inlined', () => {
    const code = compileWith('{{this.count}}', {
      properties: {
        'this.count': { kind: 'primitive', isReadonly: true, isTracked: true, literalValue: 1 },
      },
    });
    expect(code).toContain('this.count');
    expect(code).toMatch(/\(\)\s*=>\s*this\.count/);
  });

  test('subpath does not match parent hint (falls back to unknown)', () => {
    const code = compileWith('{{this.user.name}}', {
      properties: { 'this.user': { kind: 'object' } },
    });
    // this.user.name does not match this.user exactly → no hint → keeps getter
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('helper without return hint keeps getter wrapper', () => {
    const code = compileWith('{{myHelper this.x}}', {
      properties: {},
    });
    // No return hint → keeps getter wrapper
    expect(code).toContain('myHelper');
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('attribute position: static property skips getter wrapper', () => {
    const code = compileWith('<div class={{this.cls}}></div>', {
      properties: { 'this.cls': { kind: 'primitive' } },
    });
    // Static property in attribute position should skip getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.cls/);
    expect(code).toContain('this.cls');
  });

  test('attribute position: tracked property keeps getter wrapper', () => {
    const code = compileWith('<div class={{this.cls}}></div>', {
      properties: { 'this.cls': { kind: 'primitive', isTracked: true } },
    });
    // Tracked property in attribute position should keep getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.cls/);
  });

  test('concat attribute: optimization does not break concat', () => {
    const code = compileWith('<div class="prefix-{{this.cls}}"></div>', {
      properties: { 'this.cls': { kind: 'primitive' } },
    });
    // Concat parts use direct references (wrapInGetter=false), unaffected by optimization
    expect(code).toContain('this.cls');
    // Should not crash or produce invalid output
    expect(code).toBeDefined();
  });

  test('built-in if helper with static condition', () => {
    const code = compileWith('{{if this.flag "yes" "no"}}', {
      properties: { 'this.flag': { kind: 'primitive' } },
    });
    // Static flag passed to reactive helper — optimization may skip getter on the arg
    // The output should still be valid
    expect(code).toContain('this.flag');
  });

  test('built-in if helper with tracked condition keeps getter', () => {
    const code = compileWith('{{if this.flag "yes" "no"}}', {
      properties: { 'this.flag': { kind: 'primitive', isTracked: true } },
    });
    // Tracked flag → reactive → keeps getter on the condition arg
    expect(code).toMatch(/\(\)\s*=>\s*this\.flag/);
  });

  test('built-in if helper folds when condition literal is known', () => {
    const code = compileWith('{{if this.FLAG "yes" "no"}}', {
      properties: {
        'this.FLAG': { kind: 'primitive', isReadonly: true, literalValue: true },
      },
    });
    expect(code).toContain('"yes"');
    expect(code).not.toMatch(/\$__if\s*\(/);
  });

  test('built-in eq helper folds to boolean literal', () => {
    const code = compileWith('{{eq this.A 1}}', {
      properties: {
        'this.A': { kind: 'primitive', isReadonly: true, literalValue: 1 },
      },
    });
    expect(code).toContain('true');
    expect(code).not.toMatch(/\$__eq\s*\(/);
  });

  test('built-in not helper folds to boolean literal', () => {
    const code = compileWith('{{not this.FLAG}}', {
      properties: {
        'this.FLAG': { kind: 'primitive', isReadonly: true, literalValue: false },
      },
    });
    expect(code).toContain('true');
    expect(code).not.toMatch(/\$__not\s*\(/);
  });

  test('built-in and helper folds to boolean literal', () => {
    const code = compileWith('{{and this.A this.B}}', {
      properties: {
        'this.A': { kind: 'primitive', isReadonly: true, literalValue: true },
        'this.B': { kind: 'primitive', isReadonly: true, literalValue: 0 },
      },
    });
    expect(code).toContain('false');
    expect(code).not.toMatch(/\$__and\s*\(/);
  });

  test('built-in or helper folds to resulting literal value', () => {
    const code = compileWith('{{or this.A this.B}}', {
      properties: {
        'this.A': { kind: 'primitive', isReadonly: true, literalValue: '' },
        'this.B': { kind: 'primitive', isReadonly: true, literalValue: 'ok' },
      },
    });
    expect(code).toContain('"ok"');
    expect(code).not.toMatch(/\$__or\s*\(/);
  });

  test('built-in and folds to false before unknown trailing args', () => {
    const code = compileWith('{{and this.FLAG this.dynamic}}', {
      properties: {
        'this.FLAG': { kind: 'primitive', isReadonly: true, literalValue: false },
      },
    });
    expect(code).toContain('false');
    expect(code).not.toMatch(/\$__and\s*\(/);
    expect(code).not.toContain('this.dynamic');
  });

  test('built-in or folds to truthy hint before unknown trailing args', () => {
    const code = compileWith('{{or this.FLAG this.dynamic}}', {
      properties: {
        'this.FLAG': { kind: 'primitive', isReadonly: true, literalValue: 'ready' },
      },
    });
    expect(code).toContain('"ready"');
    expect(code).not.toMatch(/\$__or\s*\(/);
    expect(code).not.toContain('this.dynamic');
  });

  test('built-in eq folds to false on known mismatch even with unknown args', () => {
    const code = compileWith('{{eq this.FLAG 2 this.dynamic}}', {
      properties: {
        'this.FLAG': { kind: 'primitive', isReadonly: true, literalValue: 1 },
      },
    });
    expect(code).toContain('false');
    expect(code).not.toMatch(/\$__eq\s*\(/);
  });

  test('deeply chained path falls back to unknown', () => {
    const code = compileWith('{{this.a.b.c}}', {
      properties: { 'this.a': { kind: 'primitive' } },
    });
    // this.a.b.c does not match this.a exactly → no hint → keeps getter
    expect(code).toMatch(/\(\)\s*=>/);
  });

  test('bare this reference keeps getter wrapper', () => {
    const code = compileWith('{{this}}', {
      properties: { 'this.title': { kind: 'primitive' } },
    });
    // Bare "this" is not a property path → no hint → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this(?![.\[])/);
  });

  test('unknown kind property keeps getter wrapper', () => {
    const code = compileWith('{{this.data}}', {
      properties: { 'this.data': { kind: 'unknown' } },
    });
    // Explicit unknown kind → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.data/);
  });

  test('multiple properties: mix of static, reactive, and unknown', () => {
    const code = compileWith('{{this.a}} {{this.b}} {{this.c}} {{this.d}}', {
      properties: {
        'this.a': { kind: 'primitive' },
        'this.b': { kind: 'primitive', isTracked: true },
        'this.c': { kind: 'object' },
        // this.d has no hint
      },
    });
    // a: static → no getter
    expect(code).not.toMatch(/\(\)\s*=>\s*this\.a(?!\w)/);
    // b: tracked → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.b/);
    // c: object → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.c/);
    // d: no hint → unknown → keeps getter
    expect(code).toMatch(/\(\)\s*=>\s*this\.d/);
  });
});
