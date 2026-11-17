// Production build of the budget-harness apps (bench/budgets/app). Built the
// way a consumer app builds gxt: the published compiler plugin with default
// flags, vite's default minifier, `@lifeart/gxt` resolved to this checkout's
// sources. The entry (`bench` or `hello`) comes from GXT_BUDGET_ENTRY so each
// app is its own build and its bundle size is not mixed with the other's.
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compiler } from "../../plugins/compiler.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const entry = process.env["GXT_BUDGET_ENTRY"] === "hello" ? "hello" : "bench";

export default defineConfig(({ mode }) => ({
  root: path.join(here, "app"),
  base: "./",
  logLevel: "warn",
  plugins: [compiler(mode, { disableHMR: true })],
  build: {
    outDir: path.join(here, "out", entry),
    emptyOutDir: true,
    modulePreload: false,
    target: "es2020",
    rollupOptions: {
      input: path.join(
        here,
        "app",
        entry === "hello" ? "hello.html" : "index.html",
      ),
    },
  },
  resolve: {
    alias: {
      "@/core": path.join(repo, "src", "core"),
      "@/services": path.join(repo, "src", "services"),
      "@/components": path.join(repo, "src", "components"),
      "@/tests": path.join(repo, "src", "tests"),
      "@lifeart/gxt/recycle": path.join(repo, "src", "core", "recycle.ts"),
      "@lifeart/gxt": path.join(repo, "src", "core", "index.ts"),
    },
  },
}));
