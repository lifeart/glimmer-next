import { type Plugin } from "vite";
import { Preprocessor } from 'content-tag';
import { transform } from "./test";
const p = new Preprocessor();

export function compiler(): Plugin {
  return {
    enforce: "pre",
    name: "glimmer-next",
    transform(code: string, file: string) {
      if (file.endsWith('.gts')) {
        return transform(p.process(code, file), file);
      }
      if (!code.includes("@/utils/template")) {
        return;
      }
      let result: string | undefined = undefined;
      const id = file;
      if (id.endsWith(".ts")) {
        const source = code;
        const result = transform(source, file);
        // if (file.includes('Smile')) {
        //   console.log(result);
        // }
        return result;
      }
      return result;
    },
  };
}
