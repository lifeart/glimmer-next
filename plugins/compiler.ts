import { type Plugin } from 'vite';
import { Preprocessor } from 'content-tag';
import { transform } from './test';
import { MAIN_IMPORT } from './symbols';
const p = new Preprocessor();

export function compiler(mode: string): Plugin {
  return {
    enforce: 'pre',
    name: 'glimmer-next',

    transform(code: string, file: string) {
      const ext = file.split('.').pop();
      if (ext === 'gjs' || ext === 'gts') {
        const intermediate = p
          .process(code, file)
          .split('static{')
          .join('$static() {');
        return transform(
          intermediate,
          file,
          mode as 'development' | 'production',
        );
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
