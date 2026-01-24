import { test, expect } from '@playwright/test';

/**
 * Source Map Tests
 *
 * These tests verify the source map behavior for .gts files.
 *
 * Following the same approach as @sveltejs/vite-plugin-svelte:
 * - file: basename of output file (e.g., "Button.js")
 * - sources: basename of source file (e.g., "Button.gts")
 * - sourcesContent: full original source code with <template> tags
 *
 * This is the standard pattern that browsers expect for source maps
 * when source and output files are in the same directory.
 */

interface SourceMapData {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
  sourceRoot?: string;
}

test.describe('Source Maps', () => {
  test('should have source maps attached to .gts files', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);

    // Fetch a .gts file and verify source map is present
    const result = await page.evaluate(async () => {
      const response = await fetch('/src/components/Button.gts?import');
      const text = await response.text();

      const match = text.match(
        /\/\/# sourceMappingURL=data:application\/json[^,]*,([^\s]+)/,
      );

      if (match) {
        const json = atob(match[1]);
        return JSON.parse(json);
      }
      return null;
    });

    expect(result).not.toBeNull();
    expect(result.version).toBe(3);
    expect(result.sources).toBeDefined();
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.mappings).toBeDefined();
    expect(result.sourcesContent).toBeDefined();

    console.log('\n=== Source Map Structure ===');
    console.log(`  file: ${result.file}`);
    console.log(`  sources: ${JSON.stringify(result.sources)}`);
    console.log(`  mappings length: ${result.mappings.length}`);
    console.log(`  has sourcesContent: ${!!result.sourcesContent}`);
  });

  test('verify source map source points to .gts file', async ({ page }) => {
    await page.goto('/');

    const files = [
      '/src/components/Application.gts?import',
      '/src/components/Button.gts?import',
      '/src/components/Header.gts?import',
    ];

    for (const file of files) {
      const result = await page.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          const text = await response.text();
          const match = text.match(
            /\/\/# sourceMappingURL=data:application\/json[^,]*,([^\s]+)/,
          );
          if (match) {
            return JSON.parse(atob(match[1]));
          }
        } catch {
          return null;
        }
        return null;
      }, file);

      expect(result).not.toBeNull();

      // Source should reference a .gts file
      const source = result.sources[0];
      expect(source.endsWith('.gts')).toBe(true);

      // File field should reference .js output
      expect(result.file.endsWith('.js')).toBe(true);

      console.log(`\n${file}:`);
      console.log(`  sources[0]: ${source}`);
      console.log(`  file: ${result.file}`);
    }
  });

  test('source map uses basenames (Svelte-style)', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const response = await fetch('/src/components/Button.gts?import');
      const text = await response.text();
      const match = text.match(
        /\/\/# sourceMappingURL=data:application\/json[^,]*,([^\s]+)/,
      );
      if (match) {
        return JSON.parse(atob(match[1]));
      }
      return null;
    });

    expect(result).not.toBeNull();

    const source = result.sources[0];
    const fileField = result.file;

    console.log('\n=== Source Map Structure (Svelte-style) ===');
    console.log(`  sources[0]: "${source}"`);
    console.log(`  file: "${fileField}"`);

    // Both should be basenames (following Svelte's approach)
    const sourceIsBasename = !source.includes('/');
    const fileIsBasename = !fileField?.includes('/');

    console.log(`  sources is basename: ${sourceIsBasename}`);
    console.log(`  file is basename: ${fileIsBasename}`);

    // Verify both are basenames
    expect(sourceIsBasename).toBe(true);
    expect(fileIsBasename).toBe(true);

    // Verify correct extensions
    expect(source).toBe('Button.gts');
    expect(fileField).toBe('Button.js');
  });

  test('sourcesContent should contain original .gts source', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const response = await fetch('/src/components/Button.gts?import');
      const text = await response.text();
      const match = text.match(
        /\/\/# sourceMappingURL=data:application\/json[^,]*,([^\s]+)/,
      );
      if (match) {
        return JSON.parse(atob(match[1]));
      }
      return null;
    });

    expect(result).not.toBeNull();
    expect(result.sourcesContent).toBeDefined();
    expect(result.sourcesContent.length).toBeGreaterThan(0);

    const sourceContent = result.sourcesContent[0];

    // Original source should contain <template> tags
    expect(sourceContent).toContain('<template>');
    expect(sourceContent).toContain('</template>');

    console.log('\n=== Source Content Verification ===');
    console.log(`  Contains <template>: ${sourceContent.includes('<template>')}`);
    console.log(`  Content length: ${sourceContent.length} chars`);
  });
});
