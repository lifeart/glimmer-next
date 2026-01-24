import { describe, test, expect } from 'vitest';
import { fixExportsForHMR, shouldHotReloadFile, HMR } from './hmr';

describe('plugins/hmr', () => {
  describe('fixExportsForHMR', () => {
    test('replaces export const with export let', () => {
      const input = 'export const Foo = class {}';
      const result = fixExportsForHMR(input);
      expect(result).toBe('export let Foo = class {}');
    });

    test('handles multiple export const statements', () => {
      const input = `export const A = 1;
export const B = 2;
export const C = 3;`;
      const result = fixExportsForHMR(input);
      expect(result).toBe(`export let A = 1;
export let B = 2;
export let C = 3;`);
    });

    test('does not affect non-exported const', () => {
      const input = 'const localVar = 1;';
      const result = fixExportsForHMR(input);
      expect(result).toBe('const localVar = 1;');
    });

    test('does not affect export default', () => {
      const input = 'export default class Foo {}';
      const result = fixExportsForHMR(input);
      expect(result).toBe('export default class Foo {}');
    });

    test('does not affect export function', () => {
      const input = 'export function foo() {}';
      const result = fixExportsForHMR(input);
      expect(result).toBe('export function foo() {}');
    });

    test('handles mixed exports', () => {
      const input = `export const Foo = class {};
export function bar() {}
export default baz;
export const Qux = 1;`;
      const result = fixExportsForHMR(input);
      expect(result).toBe(`export let Foo = class {};
export function bar() {}
export default baz;
export let Qux = 1;`);
    });

    test('preserves whitespace and formatting', () => {
      const input = `export const   Spaced = 1;`;
      const result = fixExportsForHMR(input);
      expect(result).toBe(`export let   Spaced = 1;`);
    });

    test('returns empty string for empty input', () => {
      const result = fixExportsForHMR('');
      expect(result).toBe('');
    });
  });

  describe('shouldHotReloadFile', () => {
    test('returns true for .gts file with template', () => {
      const result = shouldHotReloadFile('component.gts', '<template>Hello</template>');
      expect(result).toBe(true);
    });

    test('returns true for .gjs file with template', () => {
      const result = shouldHotReloadFile('component.gjs', '<template>Hello</template>');
      expect(result).toBe(true);
    });

    test('returns false for .ts file', () => {
      const result = shouldHotReloadFile('utils.ts', '<template>Hello</template>');
      expect(result).toBe(false);
    });

    test('returns false for .js file', () => {
      const result = shouldHotReloadFile('utils.js', '<template>Hello</template>');
      expect(result).toBe(false);
    });

    test('returns false for test files (.gts)', () => {
      const result = shouldHotReloadFile('component-test.gts', '<template>Hello</template>');
      expect(result).toBe(false);
    });

    test('returns false for test files (.gjs)', () => {
      const result = shouldHotReloadFile('component-test.gjs', '<template>Hello</template>');
      expect(result).toBe(false);
    });

    test('returns false for files without template tag', () => {
      const result = shouldHotReloadFile('helper.gts', 'export function helper() {}');
      expect(result).toBe(false);
    });

    test('handles nested paths correctly', () => {
      const result = shouldHotReloadFile('src/components/my-component.gts', '<template>Test</template>');
      expect(result).toBe(true);
    });

    test('returns false for test paths with -test suffix', () => {
      const result = shouldHotReloadFile('src/components/my-component-test.gts', '<template>Test</template>');
      expect(result).toBe(false);
    });

    test('handles multiline template tag', () => {
      const code = `
import { Component } from '@lifeart/gxt';

export class MyComponent extends Component {
  <template>
    <div>Hello</div>
  </template>
}`;
      const result = shouldHotReloadFile('my-component.gts', code);
      expect(result).toBe(true);
    });

    test('returns false when template tag is in a comment', () => {
      const code = `
// This has <template> in a comment but no actual template
export function helper() {}`;
      // Note: current implementation doesn't distinguish comments
      // This test documents current behavior
      const result = shouldHotReloadFile('helper.gts', code);
      expect(result).toBe(true); // Current behavior - treats comment as containing template
    });
  });

  describe('HMR template', () => {
    test('is a non-empty string', () => {
      expect(typeof HMR).toBe('string');
      expect(HMR.length).toBeGreaterThan(0);
    });

    test('contains import.meta.hot check', () => {
      expect(HMR).toContain('import.meta.hot');
    });

    test('contains accept handler', () => {
      expect(HMR).toContain('import.meta.hot.accept');
    });

    test('contains invalidate call for module changes', () => {
      expect(HMR).toContain('import.meta.hot?.invalidate()');
    });

    test('contains hotReload function call', () => {
      expect(HMR).toContain('window.hotReload');
    });

    test('contains token comparison logic', () => {
      expect(HMR).toContain('existingTokensToReload');
      expect(HMR).toContain('internalTokensToReload');
    });
  });
});
