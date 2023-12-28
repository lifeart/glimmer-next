import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";
import legacy from '@vitejs/plugin-legacy'


const self = import.meta.url;

const currentPath = path.dirname(fileURLToPath(self));

export default defineConfig({
  plugins: [compiler(), legacy({
    targets: ['defaults', 'not IE 11']
  })],
  resolve: {
    alias: {
      "@/components": path.join(currentPath, "src", "components"),
      "@/utils": path.join(currentPath, "src", "utils"),
    },
  },
});
