import { type Plugin } from 'vite';
import { Preprocessor } from 'content-tag';
import { transform } from './test';
import { MAIN_IMPORT } from './symbols';
import { flags } from './flags.ts';
import { HMR, fixExportsForHMR } from './hmr.ts';

const p = new Preprocessor();

function fixContentTagOutput(code: string): string {
  return code.split('static{').join('$static() {');
}

export function compiler(mode: string): Plugin {
  let isLibBuild = false;
  return {
    enforce: 'pre',
    name: 'glimmer-next',
    config(config, mode) {
      isLibBuild = config.build?.lib !== undefined;
      const defineValues: Record<string, boolean> = flags;
      if (!isLibBuild) {
        defineValues['IS_DEV_MODE'] = mode.mode === 'development';
      }
      return {
        define: defineValues,
      };
    },
    transform(code: string, file: string) {
      const ext = file.split('.').pop();
      if (ext === 'gjs' || ext === 'gts') {
        const intermediate = fixContentTagOutput(p.process(code, file));

        if (mode === 'development') {
          return transform(
            fixExportsForHMR(intermediate) + HMR,
            file,
            mode as 'development' | 'production', isLibBuild,
          );
        } else {
          return transform(
            intermediate,
            file,
            mode as 'development' | 'production', isLibBuild,
          );
        }
      }
      if (!code.includes(MAIN_IMPORT)) {
        return;
      }
      let result: string | undefined = undefined;
      if (ext === 'ts' || ext === 'js') {
        const source = code;
        const result = transform(
          source,
          file,
          mode as 'development' | 'production',
        );
        return result;
      }
      return result;
    },
  };
}
