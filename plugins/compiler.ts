import { type Plugin } from 'vite';
import fs from 'node:fs';

import { transform } from './test';

export function compiler(): Plugin {
    return {
      enforce: 'pre',
      name: 'glimmer-next',
      transform(code: string, file: string) {
        if (!file.includes('glimmer-next/src/') || !code.includes('hbs')) {
          return;
        }
        let result: string | undefined = undefined;
        const id = file;
        if (id.endsWith('.ts')) {
          const source = code;
          // // const compiled = precompile(source);
          // console.log(transform(source, file));
          return transform(source, file);
        }
        return result;
      },
    };
  }