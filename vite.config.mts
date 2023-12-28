import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";

const self = import.meta.url;

const currentPath = path.dirname(fileURLToPath(self));

export default defineConfig({
  plugins: [compiler()],
  resolve: {
    alias: {
      "@/components": path.join(currentPath, "src", "components"),
      "@/utils": path.join(currentPath, "src", "utils"),
    },
  },
});
