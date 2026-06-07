import { PluginOption, defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "./plugins/compiler.ts";
// import circleDependency from "vite-plugin-circular-dependency";
import dts from "vite-plugin-dts";
import babel from "vite-plugin-babel";
import { stripGXTDebug } from "./plugins/babel.ts";

// Minimal babel plugin: remove only `console.log/warn/error/info(...)`
// expression statements from the PUBLISHED lib dist. This is the safe subset
// of stripGXTDebug — it does NOT touch cell/formula/Cell/MergedCell/debugName
// signatures (those param-popping transforms break the lib runtime).
function stripConsoleOnly() {
  return {
    name: "gxt-strip-console-only",
    visitor: {
      ExpressionStatement(path: any) {
        const expr = path.node.expression;
        if (
          expr &&
          expr.type === "CallExpression" &&
          expr.callee.type === "MemberExpression" &&
          expr.callee.object.name === "console"
        ) {
          path.remove();
        }
      },
    },
  };
}

const isLibBuild = process.env["npm_lifecycle_script"]?.includes("--lib");
const withSourcemaps =
  process.env["npm_lifecycle_script"]?.includes("--with-sourcemaps");
const self = import.meta.url;
const currentPath = path.dirname(fileURLToPath(self));

const plugins: PluginOption[] = [];

if (isLibBuild) {
  // this section responsible for @lifeart/gxt build itself
  // @todo - move to compiler plugin
  // NB: the lib babel block is constructed INSIDE the defineConfig callback
  // (below) so it can read `mode` and strip console.* from the published dist
  // in production. Only the `dts` plugin is mode-independent.
  plugins.push(
    dts({
      insertTypesEntry: true,
      exclude: [
        "src/components/**/*",
        "src/index.ts",
        "src/core/benchmark.ts",
        "src/core/compat.ts",
        "src/core/data.ts",
        "src/core/measure-render.ts",
      ],
    }),
  );
}

export default defineConfig(({ mode }) => ({
  plugins: [
    ...plugins,
    isLibBuild
      ? babel({
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
            // Strip debug info from the PUBLISHED lib dist in production.
            // NB: we deliberately do NOT reuse the full `stripGXTDebug` here.
            // Its param-popping visitors (FunctionDeclaration on cell/formula,
            // NewExpression on Cell/MergedCell, AssignmentPattern/ClassMethod
            // on debugName) BREAK the lib runtime — the GXT-on-Ember benchmark
            // vehicle boots to an empty table when the lib is built with the
            // full transform. (The non-lib app build tolerates it because of a
            // different compile/minify pipeline.) The high-value, safe part of
            // the hygiene fix is dropping console.*; we apply ONLY that here via
            // a minimal local visitor, leaving cell/formula/Cell signatures
            // untouched so the runtime is byte-behaviour-identical aside from
            // the removed console calls.
            plugins:
              mode === "production"
                ? [stripConsoleOnly]
                : [],
          },
        })
      : babel({
          filter: /\.ts$/,
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
      flags: {
        WITH_DYNAMIC_EVAL: true,
      },
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
    coverage: {
      provider: "v8",
      reporter: ["json"],
      reportsDirectory: "./coverage/vitest",
      include: ["src/**/*.ts", "plugins/**/*.ts"],
      exclude: [
        "src/components/**",
        "src/server.ts",
        "**/*.d.ts",
        "plugins/**/*.test.ts",
        // Environmental quarantine: on the Linux CI runner the v8 coverage
        // provider attempts to resolve/read the tres renderer's `./types`
        // entry as a FILE while instrumenting this tree, which throws
        // `EISDIR: illegal operation on a directory, read ./types` and fails
        // the whole tres suite to LOAD (0 tests collected). It is a tangential
        // three.js renderer test, byte-identical to master (this PR does not
        // touch it), and passes locally on macOS even under full coverage.
        // Excluding the tres tree from coverage instrumentation lets the
        // substantive suite run on CI without hitting the dir-read path.
        // NOTE: environmental coverage-instrumentation quarantine, not a
        // behavioural fix — the tres tests themselves still run and pass.
        "src/core/renderers/tres/**",
      ],
    },
  },
  build: {
    sourcemap: withSourcemaps ? "inline" : undefined,
    lib: isLibBuild
      ? {
          entry: [
            path.join(currentPath, "src", "core", "index.ts"),
            path.join(currentPath, "plugins", "compiler.ts"),
            path.join(currentPath, "plugins", "runtime-compiler.ts"),
            path.join(
              currentPath,
              "src",
              "core",
              "inspector",
              "ember-inspector.ts",
            ),
            path.join(
              currentPath,
              "src",
              "core",
              "glimmer",
              "glimmer-compat.ts",
            ),
            path.join(currentPath, "src", "tests", "utils.ts"),
            path.join(currentPath, "src", "core", "suspense.ts"),
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
            "typescript",
            "happy-dom",
            "express",
            "vite",
            "os",
            "path",
            "fs",
            "url",
            "node:os",
            "node:path",
            "node:fs",
            "node:url",
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
      "@/core": path.join(currentPath, "src", "core"),
      "@/services": path.join(currentPath, "src", "services"),
      "@/tests": path.join(currentPath, "src", "tests"),
      "@lifeart/gxt/ember-inspector": path.join(
        currentPath,
        "src",
        "core",
        "inspector",
        "ember-inspector.ts",
      ),
      "@lifeart/gxt/glimmer-compatibility": path.join(
        currentPath,
        "src",
        "core",
        "glimmer",
        "glimmer-compat.ts",
      ),
      "@lifeart/gxt/test-utils": path.join(
        currentPath,
        "src",
        "tests",
        "utils.ts",
      ),
      "@lifeart/gxt": path.join(currentPath, "src", "core", "index.ts"),
    },
  },
}));
