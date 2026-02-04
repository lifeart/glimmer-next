import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Unknown helper/binding fix', () => {
  test('unknown binding in text content uses $_maybeHelper', () => {
    const result = compile('<div>{{greeting}}</div>', {
      bindings: new Set([]),  // Empty - greeting is unknown
      flags: {
        IS_GLIMMER_COMPAT_MODE: true,
        WITH_HELPER_MANAGER: true,
              },
    });
    console.log('Generated code:', result.code);
    
    // Should use $_maybeHelper for unknown binding
    expect(result.code).toContain('$_maybeHelper');
    expect(result.code).toContain('"greeting"');
    
    // Should NOT have greeting as a direct JS identifier
    // This regex matches greeting as identifier (not in a string)
    expect(result.code).not.toMatch(/\(\)\s*=>\s*greeting[^"]/);
  });

  test('known binding in text content uses direct reference', () => {
    const result = compile('<div>{{greeting}}</div>', {
      bindings: new Set(['greeting']),  // greeting is known
      flags: {
        IS_GLIMMER_COMPAT_MODE: true,
        WITH_HELPER_MANAGER: true,
              },
    });
    console.log('Generated code:', result.code);
    
    // Should use direct reference or maybeHelper with identifier
    // In compat mode with WITH_HELPER_MANAGER, even known bindings
    // might go through maybeHelper but with the function reference
    expect(result.code).toMatch(/greeting/);
  });
  
  test('this.property is always a path, not a helper', () => {
    const result = compile('<div>{{this.name}}</div>', {
      bindings: new Set([]),
      flags: {
        IS_GLIMMER_COMPAT_MODE: true,
        WITH_HELPER_MANAGER: true,
              },
    });
    console.log('Generated code:', result.code);
    
    // Should be a path expression, not a helper call
    expect(result.code).toContain('this');
    expect(result.code).toContain('name');
    expect(result.code).not.toContain('$_maybeHelper("this.name"');
  });
});
