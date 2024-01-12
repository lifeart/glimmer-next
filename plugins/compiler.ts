import { type Plugin } from 'vite';
import { Preprocessor } from 'content-tag';
import { transform } from './test';
// import { MAIN_IMPORT } from './symbols';
import { type Flags, defaultFlags } from './flags.ts';
import { HMR, fixExportsForHMR, shouldHotReloadFile } from './hmr.ts';

export { stripGXTDebug } from './babel.ts';

const p = new Preprocessor();

function fixContentTagOutput(code: string): string {
  return code.split('static{').join('$static() {');
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
        defineValues = {};
      }
      defineValues['process.env.BABEL_TYPES_8_BREAKING'] = false;

      return {
        define: defineValues,
        resolve: {
          extensions: extensionsToResolve,
        },
      };
    },
    transform(code: string, file: string) {
      if (templateFileRegex.test(file)) {
        const intermediate = fixContentTagOutput(
          p.process(code, {
            filename: file,
          }),
        );

        if (mode === 'development') {
          const shouldHotReload = options.disableHMR
            ? false
            : shouldHotReloadFile(file, code);
          return transform(
            fixExportsForHMR(intermediate) + (shouldHotReload ? HMR : ''),
            file,
            mode as 'development' | 'production',
            isLibBuild,
            flags,
          );
        } else {
          return transform(
            intermediate,
            file,
            mode as 'development' | 'production',
            isLibBuild,
            flags,
          );
        }
      }
      // if (!code.includes(MAIN_IMPORT)) {
      //   return;
      // }
      let result: string | undefined = undefined;
      if (scriptFileRegex.test(file)) {
        const source = code;
        // if (code.includes('precompileTemplate')) {
        //   console.log(code);
        // }
        const result = transform(
          source,
          file,
          mode as 'development' | 'production',
          false,
          flags,
        );
        return result;
      }
      return result;
    },
  };
}
