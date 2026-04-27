import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Helper signature tests', () => {
  describe('$_componentHelper', () => {
    test('component helper with binding compiles to dynamic component', () => {
      const result = compile('{{component MyComponent foo="bar"}}', {
        bindings: new Set(['MyComponent']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // AST-level {{component}} transform emits a dynamic component element
      // which compiles to $_dc or $_c with the binding as the tag
      expect(result.code).toContain('MyComponent');
      expect(result.code).toContain('foo');
    });

    test('component helper with positional args compiles to dynamic component', () => {
      const result = compile('{{component MyComponent "arg1"}}', {
        bindings: new Set(['MyComponent']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Positional args become @__pos0__ attributes on the component element
      expect(result.code).toContain('MyComponent');
      expect(result.code).toContain('__pos0__');
    });
  });

  describe('$_helperHelper', () => {
    test('helper helper uses array signature', () => {
      const result = compile('{{helper myHelper foo="bar"}}', {
        bindings: new Set(['myHelper']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Should use $_helperHelper([myHelper], { foo: "bar" })
      expect(result.code).toMatch(/\$_helperHelper\s*\(\s*\[/);
    });
  });

  describe('$_modifierHelper', () => {
    test('modifier helper uses array signature', () => {
      const result = compile('{{modifier myModifier foo="bar"}}', {
        bindings: new Set(['myModifier']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Should use $_modifierHelper([myModifier], { foo: "bar" })
      expect(result.code).toMatch(/\$_modifierHelper\s*\(\s*\[/);
    });
  });
});
