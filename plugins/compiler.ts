import { type Plugin } from "vite";

import { transform } from "./test";

export function compiler(): Plugin {
  return {
    enforce: "pre",
    name: "glimmer-next",
    transform(code: string, file: string) {
      if (!file.includes("glimmer-next/src/") || !code.includes("hbs")) {
        return;
      }
      let result: string | undefined = undefined;
      const id = file;
      if (id.endsWith(".ts")) {
        const source = code;
        const result = transform(source, file);
        if (file.includes('App')) {
          console.log(result);
        }
        return result;
      }
      return result;
    },
  };
}
