import { PluginOption, defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";
// import circleDependency from "vite-plugin-circular-dependency";
import dts from "vite-plugin-dts";
import babel from "vite-plugin-babel";
import { stripGXTDebug, processSource } from "./plugins/babel.ts";
import { NodeGlobalsPolyfillPlugin } from "@esbuild-plugins/node-globals-polyfill";
// import { nodeModulesPolyfillPlugin } from 'esbuild-plugins-node-modules-polyfill';

const isLibBuild = process.env["npm_lifecycle_script"]?.includes("--lib");
const withSourcemaps =
  process.env["npm_lifecycle_script"]?.includes("--with-sourcemaps");
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
              allExtensions: false,
            },
          ],
        ],
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
  plugins: [
    ...plugins,
    isLibBuild
      ? null
      : babel({
          filter: /\.(ts|js)$/,
          babelConfig: {
            babelrc: false,
            configFile: false,
            presets: [
              [
                "@babel/preset-typescript",
                {
                  allowDeclareFields: true,
                  allExtensions: true,
                },
              ],
            ],
            plugins:
              mode === "production"
                ? [stripGXTDebug, ["module:decorator-transforms"]]
                : [["module:decorator-transforms"]],
          },
        }),
    compiler(mode, {
      authorMode: true,
    }),
  ],
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/e2e/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
    ],
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        // nodeModulesPolyfillPlugin(),
        NodeGlobalsPolyfillPlugin({ buffer: true }),
      ],
    },
  },
  build: {
    sourcemap: withSourcemaps ? "inline" : undefined,
    lib: isLibBuild
      ? {
          entry: [
            path.join(currentPath, "src", "utils", "index.ts"),
            path.join(currentPath, "plugins", "compiler.ts"),
            path.join(
              currentPath,
              "src",
              "utils",
              "inspector",
              "ember-inspector.ts",
            ),
            path.join(
              currentPath,
              "src",
              "utils",
              "glimmer",
              "glimmer-compat.ts",
            ),
            path.join(currentPath, "src", "tests", "utils.ts"),
            path.join(currentPath, "src", "utils", "suspense.ts"),
          ],
          name: "gxt",
          formats: ["es"],
          fileName: (format, entry) => `gxt.${entry}.${format}.js`,
        }
      : undefined,
    modulePreload: false,
    target: isLibBuild ? "esnext" : "es2015",
    minify: mode === "production" ? "terser" : false,
    rollupOptions: {
      treeshake: "recommended",
      onwarn(warning, warn) {
        // suppress eval warnings (we use it for HMR)
        if (warning.code === "EVAL") return;
        warn(warning);
      },
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
            "happy-dom",
            "express",
            "vite",
          ]
        : ["happy-dom", "express", "vite"],
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
      "@/services": path.join(currentPath, "src", "services"),
      "@/tests": path.join(currentPath, "src", "tests"),
      "@lifeart/gxt/ember-inspector": path.join(
        currentPath,
        "src",
        "utils",
        "inspector",
        "ember-inspector.ts",
      ),
      "@lifeart/gxt/glimmer-compatibility": path.join(
        currentPath,
        "src",
        "utils",
        "glimmer",
        "glimmer-compat.ts",
      ),
      "@lifeart/gxt/test-utils": path.join(
        currentPath,
        "src",
        "tests",
        "utils.ts",
      ),
      "@lifeart/gxt": path.join(currentPath, "src", "utils", "index.ts"),
      "@glimmer/application": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__application.ts",
      ),
      "ember-svg-jar/helpers/svg-jar": path.join(
        currentPath,
        "src",
        "ember-compat",
        "svg-jar.ts",
      ),
      "@ember/utils": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__utils.ts",
      ),
      "@ember/component/helper": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__component__helper.ts",
      ),
      "@ember/template": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__template.ts",
      ),
      "@ember/debug": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__debug.ts",
      ),
      "@ember/modifier": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__modifier.ts",
      ),
      "@ember/service": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__service.ts",
      ),
      "@ember/destroyable": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__destroyable.ts",
      ),
      "@ember/array": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__array.ts",
      ),
      "@ember/component/template-only": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__component__template-only.ts",
      ),
      "@ember/template-compilation": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__template-compilation.ts",
      ),
      "@ember/object/internals": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__object__internals.ts",
      ),
      "@ember/object/computed": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__object__computed.ts",
      ),
      "@ember/application": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__application.ts",
      ),
      "@ember/component": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__component.ts",
      ),
      "@ember/helper": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__helper.ts",
      ),
      "@embroider/macros": path.join(
        currentPath,
        "src",
        "ember-compat",
        "embroider__macros.ts",
      ),
      "@glimmer/component": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__component.ts",
      ),
      "ember-modifier": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-modifier.ts",
      ),
      "@ember/render-modifiers/modifiers/will-destroy": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-render-modifiers__modifiers__will-destroy.ts",
      ),
      "@ember/render-modifiers/modifiers/did-insert": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-render-modifiers__modifiers__did-insert.ts",
      ),
      "@ember/object": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__object.ts",
      ),
      "@embroider/util": path.join(
        currentPath,
        "src",
        "ember-compat",
        "embroider__util.ts",
      ),
      "ember-style-modifier/modifiers/style": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-style-modifier__modifiers__style.ts",
      ),
      "@ember/runloop": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember__runloop.ts",
      ),
      "ember-cli-string-helpers/helpers/classify": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-cli-string-helpers__helpers__classify.ts",
      ),
      "@glimmer/tracking": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__tracking.ts",
      ),
      "ember-set-helper/helpers/set": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-set-helper__helpers__set.ts",
      ),
      "@ember/render-modifiers/modifiers/did-update": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-render-modifiers__modifiers__did-update.ts",
      ),
      "ember-composable-helpers/helpers/optional": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-composable-helpers__helpers__optional.ts",
      ),
      "ember-unique-id-helper-polyfill/helpers/unique-id": path.join(
        currentPath,
        "src",
        "ember-compat",
        "ember-unique-id-helper-polyfill.ts",
      ),
      "ember-composable-helpers": "ember-composable-helpers/addon",
      "ember-keyboard": "ember-keyboard/addon",
      "ember-math-helpers": "ember-math-helpers/addon",
      "ember-set-body-class": "ember-set-body-class/addon",
      "@html-next/vertical-collection": "@html-next/vertical-collection/addon",
      "@glimmer/tracking/primitives/storage": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__tracking__primitives__storage.ts",
      ),
      "ember-tracked-storage-polyfill": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__tracking__primitives__storage.ts",
      ),
      "@glimmer/tracking/primitives/cache": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__tracking__primitives__cache.ts",
      ),
      "ember-cache-primitive-polyfill": path.join(
        currentPath,
        "src",
        "ember-compat",
        "glimmer__tracking__primitives__cache.ts",
      ),
    },
  },
}));
