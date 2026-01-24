import { type Plugin, type TransformResult as ViteTransformResult } from 'vite';
import { Preprocessor } from 'content-tag';
import { transform } from './test';
import { MAIN_IMPORT } from './symbols';
import { type Flags, defaultFlags } from './flags.ts';
import { HMR, fixExportsForHMR, shouldHotReloadFile } from './hmr.ts';

export { stripGXTDebug } from './babel.ts';
export type { TransformResult } from './test';

// Helper to cast our TransformResult to Vite's expected type
// The types are compatible at runtime but TS is strict about sourcesContent nullability
function toViteResult(result: ReturnType<typeof transform>): ViteTransformResult | undefined {
  return result as ViteTransformResult | undefined;
}

const p = new Preprocessor();

const extensionsToResolve = [
  '.mjs',
  '.js',
  '.mts',
  '.ts',
  '.jsx',
  '.tsx',
  '.json',
  '.gts',
  '.gjs',
];

const templateFileRegex = /\.(gts|gjs)$/;
const scriptFileRegex = /\.(ts|js)$/;
type Options = {
  authorMode?: boolean;
  disableHMR?: boolean;
  flags?: Partial<Flags>;
};

export function compiler(mode: string, options: Options = {}): Plugin {
  let isLibBuild = false;
  let flags = defaultFlags();
  return {
    enforce: 'pre',
    name: 'glimmer-next',
    config(config, mode) {
      if (options.authorMode === true) {
        isLibBuild = config.build?.lib !== undefined;
      }
      flags = { ...flags, ...(options.flags ?? {}) };
      let defineValues: Record<string, boolean> = flags;
      if (!isLibBuild) {
        defineValues['IS_DEV_MODE'] = mode.mode === 'development';
      } else {
        defineValues = {};
      }

      return {
        define: defineValues,
        resolve: {
          extensions: extensionsToResolve,
        },
      };
    },
    transform(code: string, file: string) {
      if (templateFileRegex.test(file)) {
        const result = p.process(code, {
          filename: file,
        });
        const intermediate = result.code;

        if (mode === 'development') {
          const shouldHotReload = options.disableHMR
            ? false
            : shouldHotReloadFile(file, code);
          return toViteResult(transform(
            fixExportsForHMR(intermediate) + (shouldHotReload ? HMR : ''),
            file,
            mode as 'development' | 'production',
            isLibBuild,
            flags,
            code, // Pass original source for source maps
          ));
        } else {
          return toViteResult(transform(
            intermediate,
            file,
            mode as 'development' | 'production',
            isLibBuild,
            flags,
            code, // Pass original source for source maps
          ));
        }
      }
      // Check if file contains @lifeart/gxt import or uses hbs tagged templates
      const hasMainImport = code.includes(MAIN_IMPORT);
      const hasHbsTemplate = /hbs\s*`/.test(code);
      if (!hasMainImport && !hasHbsTemplate) {
        return;
      }
      if (scriptFileRegex.test(file)) {
        return toViteResult(transform(
          code,
          file,
          mode as 'development' | 'production',
          false,
          flags,
          code, // Pass original source for source maps (same as input for .ts/.js)
        ));
      }
      return;
    },
  };
}
