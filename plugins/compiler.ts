import { type Plugin } from "vite";
import { Preprocessor } from "content-tag";
import { transform } from "./test";
const p = new Preprocessor();

export function compiler(): Plugin {
  return {
    enforce: "pre",
    name: "glimmer-next",
    transform(code: string, file: string) {
      const ext = file.split(".").pop();
      if (ext === "gjs" || ext === "gts") {
        const intermediate = p
          .process(code, file)
          .split("static{")
          .join("$static() {");
        return transform(intermediate, file);
      }
      if (!code.includes("@/utils/template")) {
        return;
      }
      let result: string | undefined = undefined;
      if (ext === "ts" || ext === "js") {
        const source = code;
        const result = transform(source, file);
        return result;
      }
      return result;
    },
  };
}
