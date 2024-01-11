import { PluginOption, defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";
import circleDependency from "vite-plugin-circular-dependency";
import dts from "vite-plugin-dts";
import babel from "vite-plugin-babel";
import { processSource } from "./plugins/babel.ts";

const isLibBuild = process.env["npm_lifecycle_script"]?.includes("--lib");
const self = import.meta.url;

const currentPath = path.dirname(fileURLToPath(self));

const plugins: PluginOption[] = [];

if (isLibBuild) {
  // this section responsible for @lifeart/gxt build itself
  // @todo - move to compiler plugin
  plugins.push(
    babel({
      filter: /\.ts$/,
      babelConfig: {
        babelrc: false,
        configFile: false,
        presets: [
          [
            "@babel/preset-typescript",
            {
              allowDeclareFields: true,
            },
          ],
        ],
        plugins: [processSource],
      },
    }),
    dts({
      insertTypesEntry: true,
      exclude: [
        "src/components/**/*",
        "src/index.ts",
        "src/utils/benchmark.ts",
        "src/utils/compat.ts",
        "src/utils/data.ts",
        "src/utils/measure-render.ts",
      ],
    }),
  );
}

export default defineConfig(({ mode }) => ({
  plugins: [...plugins, compiler(mode), circleDependency({})],
  build: {
    lib: isLibBuild
      ? {
          entry: [
            path.join(currentPath, "src", "utils", "index.ts"),
            path.join(currentPath, "plugins", "compiler.ts"),
          ],
          name: "gxt",
          formats: ["es"],
          fileName: (format, entry) => `gxt.${entry}.${format}.js`,
        }
      : undefined,
    modulePreload: false,
    target: "esnext",
    minify: mode === "production" ? "terser" : false,
    rollupOptions: {
      treeshake: "recommended",
      input: !isLibBuild
        ? {
            main: "index.html",
            nested: "tests.html",
          }
        : undefined,
      external: isLibBuild
        ? [
            "@babel/core",
            "@babel/preset-typescript",
            "@glimmer/syntax",
            "content-tag",
          ]
        : [],
    },
    terserOptions:
      mode === "production"
        ? {
            module: true,
            compress: {
              hoist_funs: true,
              inline: 1,
              passes: 3,
              unsafe: true,
              unsafe_symbols: true,
              computed_props: true,
            },
            mangle: {
              module: true,
              toplevel: true,
              properties: false,
            },
          }
        : {},
  },
  resolve: {
    alias: {
      "@/components": path.join(currentPath, "src", "components"),
      "@/utils": path.join(currentPath, "src", "utils"),
      "@lifeart/gxt": path.join(currentPath, "src", "utils", "index.ts"),
      "@/tests": path.join(currentPath, "src", "tests"),
    },
  },
}));
