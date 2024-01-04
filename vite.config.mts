import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";


const self = import.meta.url;

const currentPath = path.dirname(fileURLToPath(self));

export default defineConfig({
  plugins: [compiler()],
  build: {
    modulePreload: false,
    target: 'esnext',
    minify: 'terser',
    rollupOptions: {
      treeshake: 'recommended'
    },
    terserOptions: {
      module: true,
      compress: {
        hoist_funs: true,
        inline: 1,
        passes: 3,
        unsafe: true,
        unsafe_symbols: true,
      },
      mangle: {
        module: true,
        toplevel: true,
        properties: {
          builtins: false,
        }
      }
    }
  },
  resolve: {
    alias: {
      "@/components": path.join(currentPath, "src", "components"),
      "@/utils": path.join(currentPath, "src", "utils"),
    },
  },
});
