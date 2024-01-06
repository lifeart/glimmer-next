import { PluginOption, defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";
import { flags } from "./plugins/flags.ts";
import circleDependency from 'vite-plugin-circular-dependency'
import dts from 'vite-plugin-dts';

const isLibBuild = process.env['npm_lifecycle_script']?.includes("--lib");
const self = import.meta.url;

const currentPath = path.dirname(fileURLToPath(self));

const plugins: PluginOption[] = [];

if (isLibBuild) {
  plugins.push(dts({
    insertTypesEntry: true,
    exclude: [
      'src/components/**/*',
      'src/index.ts',
      'src/utils/benchmark.ts',
      'src/utils/compat.ts',
      'src/utils/data.ts',
      'src/utils/measure-render.ts'
    ]
  }));
}

export default defineConfig(({ mode }) => ({
  plugins: [...plugins, compiler(mode), circleDependency({})],
  define: {
    IS_GLIMMER_COMPAT_MODE: flags.IS_GLIMMER_COMPAT_MODE,
    RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: flags.RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES,
  },
  build: {
    lib: isLibBuild ? {
      entry: [
        path.join(currentPath, "src", "utils", "index.ts"),
        path.join(currentPath, "plugins", "compiler.ts"),
      ],
      name: "gxt",
      formats: ["es"],
      fileName: (format, entry) => `gxt.${entry}.${format}.js`,
    } : undefined,
    modulePreload: false,
    target: "esnext",
    minify: "terser",
    rollupOptions: {
      treeshake: "recommended",
      external: isLibBuild ? ['@babel/core', '@babel/preset-typescript', '@glimmer/syntax', 'content-tag'] : [],
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
        },
      },
    },
  },
  resolve: {
    alias: {
      "@/components": path.join(currentPath, "src", "components"),
      "@/utils": path.join(currentPath, "src", "utils"),
      '@lifeart/gxt': path.join(currentPath, 'src', 'utils', 'index.ts'),
    },
  },
}));
