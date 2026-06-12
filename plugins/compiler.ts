import { type Plugin, type TransformResult as ViteTransformResult } from 'vite';
import { Preprocessor } from 'content-tag';
import { transform } from './test';
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

/**
 * Detect a genuine `hbs\`...\`` tagged template in a .ts/.js module.
 *
 * The negative lookbehind excludes file-extension / inline-code PROSE in doc
 * comments — `.hbs`, 'hbs', "hbs", \`hbs — which would otherwise route the
 * whole module through the template transform and mangle its exports. A docs
 * sentence like "components were authored in paired \`.hbs\` files" hit
 * exactly this in emberjs/ember.js#21340 (the closing backtick of the
 * inline-code span follows "hbs" directly). Genuine tags are preceded by
 * whitespace, `=`, `(`, `,`, `return`, start-of-file, etc.
 */
export function hasHbsTaggedTemplate(code: string): boolean {
  return /(?<![.\w'"`])hbs\s*`/.test(code);
}

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
        // For lib builds, define IS_DEV_MODE as false so Rollup can
        // tree-shake debug-only code. Previously this was left undefined,
        // but with the single-chunk build, the core module gets loaded
        // by Node during Vite config resolution.
        //
        // NB: we must NOT inline the full `flags` object here (the
        // `{ ...flags, IS_DEV_MODE: false }` form proposed as a hygiene fix).
        // The lib build's `flags` carries `defaultFlags()` values for the
        // CONSUMER-controlled integration flags (WITH_EMBER_INTEGRATION,
        // WITH_HELPER_MANAGER, WITH_MODIFIER_MANAGER) as `false`. Inlining
        // those into the published runtime dist HARD-CODES them off, which
        // tree-shakes the Ember-integration / helper-manager / modifier-manager
        // code paths OUT of the runtime — breaking every consumer (e.g. Ember)
        // that sets them `true` at its OWN build time. Leaving them undefined
        // is correct: the consumer's `define` inlines them. (Verified: inlining
        // them produced a runtime dom chunk with zero WITH_* branches and the
        // GXT-on-Ember benchmark vehicle failed to boot — empty table.)
        defineValues = { IS_DEV_MODE: false };
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
      // Only process .ts/.js files that use hbs tagged templates.
      // Files that merely import from @lifeart/gxt don't need the babel transform
      // (which injects symbol imports that may conflict with existing declarations).
      const hasHbsTemplate = hasHbsTaggedTemplate(code);
      if (!hasHbsTemplate) {
        return;
      }
      if (scriptFileRegex.test(file)) {
        try {
          const result = transform(
            code, file,
            mode as 'development' | 'production',
            false, flags, code,
          );
          // Handle async transform (returns Promise on parse error)
          if (result && typeof (result as any).then === 'function') {
            return (result as Promise<any>).then(
              (r) => toViteResult(r),
              () => undefined, // Skip on async error
            );
          }
          return toViteResult(result as any);
        } catch {
          return; // Skip on sync error
        }
      }
      return;
    },
  };
}
