import { describe, test, expect } from 'vitest';
import { compile } from '../compile';

describe('Modifier resolution edge cases', () => {
  describe('1. @-prefixed modifier (argument reference)', () => {
    test('<div {{@modifier}}></div> - @modifier resolves to args property', () => {
      const result = compile('<div {{@modifier}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 1 - @modifier code:', result.code);

      // @modifier should resolve to $a.modifier
      expect(result.code).toContain('$a.');
      expect(result.code).toContain('modifier');
      // Should NOT be treated as string since @-prefix is known
      expect(result.code).not.toContain('"@modifier"');
    });

    test('<div {{@my-modifier}}></div> - hyphenated @arg with bracket notation', () => {
      const result = compile('<div {{@my-modifier}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 1b - @my-modifier code:', result.code);

      // Hyphenated args should use bracket notation
      expect(result.code).toContain('$a');
      expect(result.code).toContain('my-modifier');
      // Should use bracket notation for hyphenated
      expect(result.code).toContain('["my-modifier"]');
    });

    test('<div {{@modifier arg1 arg2}}></div> - @modifier with arguments', () => {
      const result = compile('<div {{@modifier "arg1" this.value}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 1c - @modifier with args code:', result.code);

      expect(result.code).toContain('$a');
      expect(result.code).toContain('modifier');
      expect(result.code).toContain('"arg1"');
    });
  });

  describe('2. this. prefixed modifier', () => {
    test('<div {{this.mod}}></div> - this.mod resolves correctly', () => {
      const result = compile('<div {{this.mod}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 2 - this.mod code:', result.code);

      // this.mod should be passed as identifier, not string
      expect(result.code).toContain('this.mod');
      // Should NOT be treated as unknown string
      expect(result.code).not.toContain('"this.mod"');
    });

    test('<div {{this.nested.modifier}}></div> - nested this path', () => {
      const result = compile('<div {{this.nested.modifier}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 2b - this.nested.modifier code:', result.code);

      expect(result.code).toContain('this.nested.modifier');
      expect(result.code).not.toContain('"this.nested.modifier"');
    });

    test('<div {{this.mod "arg"}}></div> - this.mod with arguments', () => {
      const result = compile('<div {{this.mod "arg"}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 2c - this.mod with arg code:', result.code);

      expect(result.code).toContain('this.mod');
      expect(result.code).toContain('"arg"');
    });
  });

  describe('3. Dotted path where root is in bindings', () => {
    test('<div {{foo.bar.mod}}></div> with foo in bindings - detects root', () => {
      const result = compile('<div {{foo.bar.mod}}></div>', {
        bindings: new Set(['foo']),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 3 - foo.bar.mod (foo bound) code:', result.code);

      // Since foo is known, foo.bar.mod should be passed as identifier
      expect(result.code).toContain('foo.bar.mod');
      expect(result.code).not.toContain('"foo.bar.mod"');
    });

    test('<div {{foo.bar.mod}}></div> without foo in bindings - unknown', () => {
      const result = compile('<div {{foo.bar.mod}}></div>', {
        bindings: new Set([]),  // foo is NOT known
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 3b - foo.bar.mod (foo NOT bound) code:', result.code);

      // Since foo is unknown, should be passed as string
      expect(result.code).toContain('"foo.bar.mod"');
    });

    test('<div {{myMod.subMod arg}}></div> with myMod in bindings', () => {
      const result = compile('<div {{myMod.subMod "test"}}></div>', {
        bindings: new Set(['myMod']),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 3c - myMod.subMod with myMod bound code:', result.code);

      expect(result.code).toContain('myMod.subMod');
      expect(result.code).not.toContain('"myMod.subMod"');
    });
  });

  describe('4. Unknown modifier passed as string', () => {
    test('<div {{unknownMod arg}}></div> without bindings - string name', () => {
      const result = compile('<div {{unknownMod "arg"}}></div>', {
        bindings: new Set([]),  // Empty bindings
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 4 - unknownMod code:', result.code);

      // unknownMod should be passed as string since not in bindings
      expect(result.code).toContain('"unknownMod"');
      expect(result.code).toContain('"arg"');
    });

    test('<div {{unknownMod named=value}}></div> - unknown with named args', () => {
      const result = compile('<div {{unknownMod named="value"}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 4b - unknownMod with named arg code:', result.code);

      expect(result.code).toContain('"unknownMod"');
      expect(result.code).toContain('named');
    });

    test('<div {{knownMod arg}}></div> WITH bindings - identifier', () => {
      const result = compile('<div {{knownMod "arg"}}></div>', {
        bindings: new Set(['knownMod']),  // knownMod IS known
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 4c - knownMod (bound) code:', result.code);

      // knownMod should be passed as identifier since in bindings
      expect(result.code).toMatch(/\$_maybeModifier\s*\(\s*knownMod\s*,/);
      expect(result.code).not.toContain('"knownMod"');
    });
  });

  describe('5. Without WITH_MODIFIER_MANAGER flag', () => {
    test('<div {{mod}}></div> without manager flag - direct call', () => {
      const result = compile('<div {{mod}}></div>', {
        bindings: new Set(['mod']),
        flags: { WITH_MODIFIER_MANAGER: false },
      });

      console.log('Test 5 - without manager flag code:', result.code);

      // Should call mod directly, no $_maybeModifier wrapper
      expect(result.code).not.toContain('$_maybeModifier');
      expect(result.code).toContain('mod(');
    });

    test('<div {{this.mod}}></div> without manager flag', () => {
      const result = compile('<div {{this.mod}}></div>', {
        bindings: new Set([]),
        flags: { WITH_MODIFIER_MANAGER: false },
      });

      console.log('Test 5b - this.mod without manager code:', result.code);

      expect(result.code).not.toContain('$_maybeModifier');
      expect(result.code).toContain('this.mod(');
    });
  });

  describe('6. Edge cases with special characters', () => {
    test('<div {{$_internal}}></div> - $_ prefix treated as known', () => {
      const result = compile('<div {{$_internal}}></div>', {
        bindings: new Set([]),  // Not in bindings but starts with $_
        flags: { WITH_MODIFIER_MANAGER: true },
      });

      console.log('Test 6 - $_internal code:', result.code);

      // $_ prefix should be treated as known (internal)
      expect(result.code).not.toContain('"$_internal"');
    });
  });
});
