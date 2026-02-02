import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Unknown modifier fix', () => {
  test('unknown modifier uses string name', () => {
    const result = compile('<div {{bar "test"}}></div>', {
      bindings: new Set([]),  // Empty - bar is unknown
      flags: { WITH_MODIFIER_MANAGER: true },
    });

    console.log('Generated code:', result.code);

    // Should have "bar" as a string, not bar as an identifier
    expect(result.code).toContain('"bar"');
    expect(result.code).not.toMatch(/\$_maybeModifier\s*\(\s*bar\s*,/);
  });

  test('known modifier uses identifier', () => {
    const result = compile('<div {{bar "test"}}></div>', {
      bindings: new Set(['bar']),  // bar is known
      flags: { WITH_MODIFIER_MANAGER: true },
    });

    console.log('Generated code:', result.code);

    // Should have bar as identifier since it's known
    expect(result.code).toMatch(/\$_maybeModifier\s*\(\s*bar\s*,/);
  });
});
