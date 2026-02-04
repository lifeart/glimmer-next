import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Helper signature tests', () => {
  describe('$_componentHelper', () => {
    test('component helper uses array signature', () => {
      const result = compile('{{component MyComponent foo="bar"}}', {
        bindings: new Set(['MyComponent']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Should use $_componentHelper([MyComponent], { foo: "bar" })
      // NOT $_componentHelper(MyComponent, { foo: "bar" })
      expect(result.code).toMatch(/\$_componentHelper\s*\(\s*\[/);
    });

    test('component helper with multiple positional args', () => {
      const result = compile('{{component MyComponent "arg1"}}', {
        bindings: new Set(['MyComponent']),
        flags: { IS_GLIMMER_COMPAT_MODE: true },
      });

      console.log('Generated code:', result.code);

      // Should wrap positional args in array
      expect(result.code).toMatch(/\$_componentHelper\s*\(\s*\[.*MyComponent.*,.*"arg1".*\]/);
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
