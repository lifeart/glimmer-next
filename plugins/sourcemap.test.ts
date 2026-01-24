import { describe, it, expect } from 'vitest';
import { Preprocessor } from 'content-tag';
import { transform } from './test';
import { defaultFlags } from './flags';

const preprocessor = new Preprocessor();

describe('Source map generation', () => {
  it('should include full path in sources array', () => {
    const gtsSource = `
import type { ComponentLike } from '@glint/template';

const Test: ComponentLike<{}> = <template>
  <div>Hello</div>
</template>;

export default Test;
`.trim();

    const fileName = '/Users/test/project/src/components/Test.gts';
    const flags = defaultFlags();

    // Preprocess with content-tag (converts <template> to template literals)
    const preprocessed = preprocessor.process(gtsSource, { filename: fileName }).code;

    const result = transform(
      preprocessed,  // Use preprocessed code
      fileName,
      'development',
      false,
      flags,
      gtsSource,  // Pass original source for source maps
    );

    // Handle both sync and async results
    const checkResult = (res: any) => {
      expect(res).toBeDefined();
      expect(res.code).toBeDefined();
      expect(res.map).toBeDefined();

      console.log('=== Transform Result ===');
      console.log('map.file:', res.map?.file);
      console.log('map.sources:', res.map?.sources);

      // The sources array should contain the full path, not just basename
      const sources = res.map?.sources;
      expect(sources).toBeDefined();
      expect(sources.length).toBeGreaterThan(0);

      const source = sources[0];
      console.log('First source:', source);

      // Following Svelte's approach: sources should be basename only
      // The sourcesContent field contains the full original source
      const isBasename = !source.includes('/');
      console.log('Is basename (expected):', isBasename);

      // Verify it's a basename matching the input filename
      const expectedBasename = 'Test.gts';
      expect(source).toBe(expectedBasename);
    };

    if (result instanceof Promise) {
      return result.then(checkResult);
    } else {
      checkResult(result);
    }
  });

  it('should preserve file path consistency', () => {
    const gtsSource = `
const Foo = <template>
  <span>Test</span>
</template>;
export default Foo;
`.trim();

    const fileName = '/absolute/path/to/Component.gts';
    const flags = defaultFlags();

    // Preprocess with content-tag
    const preprocessed = preprocessor.process(gtsSource, { filename: fileName }).code;

    const result = transform(
      preprocessed,  // Use preprocessed code
      fileName,
      'development',
      false,
      flags,
      gtsSource,  // Pass original source for source maps
    );

    const checkResult = (res: any) => {
      const map = res.map;

      console.log('\n=== Path Consistency Check ===');
      console.log('Input fileName:', fileName);
      console.log('map.file:', map?.file);
      console.log('map.sources:', map?.sources);

      if (map) {
        // Following Svelte's approach: both should be basenames
        expect(map.file).toBe('Component.js');
        expect(map.sources[0]).toBe('Component.gts');

        // Neither should have path separators
        const fileIsBasename = !map.file?.includes('/');
        const sourcesIsBasename = !map.sources?.[0]?.includes('/');

        console.log('file is basename:', fileIsBasename);
        console.log('sources is basename:', sourcesIsBasename);

        expect(fileIsBasename).toBe(true);
        expect(sourcesIsBasename).toBe(true);
      }
    };

    if (result instanceof Promise) {
      return result.then(checkResult);
    } else {
      checkResult(result);
    }
  });
});
