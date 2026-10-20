#!/usr/bin/env node
/**
 * Memory / size budgets for gxt, measured in real Chromium.
 *
 *   node bench/budgets/run.mjs [options]
 *
 *   --reps N          fresh-page repetitions per row kind (default 10); every
 *                     reported number is the median over the reps
 *   --kinds a,b       row kinds (default inline,component,frames; see
 *                     app/kinds.gts)
 *   --skip-timing     memory + size only (the gated metrics)
 *   --skip-memory     timing + size only
 *   --no-build        reuse bench/budgets/out (skip the two vite builds)
 *   --update          rewrite budgets.json from this run's medians
 *   --json FILE       also write the full results as JSON
 *
 * What is measured (app/main.ts drives the page; heap numbers come from CDP
 * `HeapProfiler.collectGarbage` + `Runtime.getHeapUsage` — `usedSize` is the
 * V8 heap, `embedderHeapUsedSize` the Blink/Oilpan heap where DOM nodes live):
 *   memory.<kind>.bytesPerRow   JS heap per rendered row: 10k rows are built
 *                               and held BEFORE the baseline, so the delta is
 *                               rendering cost only (no row data)
 *   memory.<kind>.afterClear    JS heap left above that baseline after
 *                               clearing the 10k rows (data still held)
 *   memory.<kind>.leakPerCycle  JS heap growth per create-1k/clear cycle
 *                               (mean of 5 cycles, after warm-up)
 *   memory.<kind>.domBytesPerRow  Oilpan heap per row (reported, not gated)
 *   size.<app>.{raw,gzip,brotli}  JS shipped by the production build of the
 *                               bench app and a minimal hello app
 *   timing.<kind>.<op>          krausest ops, ms: write + sync flush +
 *                               drained microtasks + forced layout (reported,
 *                               not gated — machine dependent)
 *
 * Gating: budgets.json holds, per gated metric, the recorded `baseline` and a
 * `max`; the run fails (exit 1) when a median exceeds its `max`. `--update`
 * re-derives both from the current medians with the per-family tolerances in
 * budgets.json. Heap sizes depend on the Chromium build, which is pinned by
 * the Playwright version in pnpm-lock.yaml; re-run with --update after a
 * Playwright bump.
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
} from "node:fs";
import { gzipSync, brotliCompressSync, constants as zlib } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const budgetsFile = path.join(here, "budgets.json");

// ---------------------------------------------------------------- options
function parseArgs(argv) {
  const opts = {
    reps: 10,
    kinds: ["inline", "component", "frames"],
    timing: true,
    memory: true,
    build: true,
    update: false,
    json: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reps") opts.reps = Number(argv[++i]);
    else if (a === "--kinds") opts.kinds = argv[++i].split(",").filter(Boolean);
    else if (a === "--skip-timing") opts.timing = false;
    else if (a === "--skip-memory") opts.memory = false;
    else if (a === "--no-build") opts.build = false;
    else if (a === "--update") opts.update = true;
    else if (a === "--json") opts.json = argv[++i];
    else throw new Error(`budgets: unknown option ${a}`);
  }
  if (!Number.isInteger(opts.reps) || opts.reps < 1) {
    throw new Error(`budgets: --reps must be a positive integer`);
  }
  return opts;
}

// ---------------------------------------------------------------- build + size
function build(entry) {
  const vite = path.join(repo, "node_modules", ".bin", "vite");
  const res = spawnSync(
    vite,
    [
      "build",
      "--config",
      path.join(here, "vite.config.mts"),
      "--mode",
      "production",
    ],
    {
      cwd: repo,
      env: { ...process.env, GXT_BUDGET_ENTRY: entry },
      stdio: "inherit",
    },
  );
  if (res.status !== 0) {
    throw new Error(
      `budgets: vite build of "${entry}" failed (exit ${res.status})`,
    );
  }
}

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) out.push(...jsFiles(file));
    else if (name.endsWith(".js")) out.push(file);
  }
  return out;
}

function measureSize(entry) {
  const dir = path.join(here, "out", entry);
  if (!existsSync(dir)) {
    throw new Error(`budgets: ${dir} missing — run without --no-build`);
  }
  const files = jsFiles(dir);
  if (files.length === 0)
    throw new Error(`budgets: no JS emitted for ${entry}`);
  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const file of files) {
    const buf = readFileSync(file);
    raw += buf.length;
    gzip += gzipSync(buf, { level: 9 }).length;
    brotli += brotliCompressSync(buf, {
      params: { [zlib.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  }
  return { raw, gzip, brotli };
}

// ---------------------------------------------------------------- static server
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

function serve(dir) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = path.normalize(path.join(dir, rel));
    if (
      !file.startsWith(dir) ||
      !existsSync(file) ||
      statSync(file).isDirectory()
    ) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// ---------------------------------------------------------------- page helpers
async function openKind(browser, origin, kind) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await page.goto(`${origin}/?kind=${kind}`);
  await page.waitForFunction(() => window.__bench !== undefined);
  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const call = (fn, ...args) => page.evaluate(fn, args);
  const op = (name, arg) =>
    call(([n, a]) => window.__bench.op(n, a), name, arg);
  const heap = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const usage = await cdp.send("Runtime.getHeapUsage");
    return { js: usage.usedSize, dom: usage.embedderHeapUsedSize ?? 0 };
  };
  const close = async () => {
    await context.close();
    if (errors.length > 0) {
      throw new Error(
        `budgets: page errors in kind "${kind}":\n  ${errors.join("\n  ")}`,
      );
    }
  };
  return { page, call, op, heap, close };
}

function check(cond, message) {
  if (!cond) throw new Error(`budgets: sanity check failed — ${message}`);
}

/** The row kinds must actually render, update and react to clicks before any
 * of their numbers mean anything. */
async function sanity(browser, origin, kind) {
  const p = await openKind(browser, origin, kind);
  await p.op("run", 1000);
  check(
    (await p.call(() => window.__bench.rowCount())) === 1000,
    `${kind}: 1000 rows`,
  );
  await p.op("update");
  check(
    (await p.call(() => window.__bench.firstLabel())).endsWith(" !!!"),
    `${kind}: update every 10th row`,
  );
  if (kind !== "frames") {
    await p.call(() => window.__bench.click(2, "select"));
    check(
      (await p.call(() => window.__bench.selectedRowIndex())) === 2,
      `${kind}: click selects row 2`,
    );
    await p.call(() => window.__bench.click(2, "remove"));
    check(
      (await p.call(() => window.__bench.rowCount())) === 999,
      `${kind}: click removes a row`,
    );
  }
  await p.op("clear");
  check(
    (await p.call(() => window.__bench.rowCount())) === 0,
    `${kind}: clear`,
  );
  await p.close();
}

const CYCLES = 5;

async function memoryRep(browser, origin, kind) {
  const p = await openKind(browser, origin, kind);
  // warm-up: compile the row template, settle ICs and caches
  for (let i = 0; i < 2; i++) {
    await p.op("run", 1000);
    await p.op("clear");
  }
  await p.call(() => window.__bench.hold(10000));
  const base = await p.heap();
  await p.op("renderHeld");
  check(
    (await p.call(() => window.__bench.rowCount())) === 10000,
    `${kind}: 10k rows`,
  );
  const full = await p.heap();
  const census = await p.call(() => window.__bench.census());
  await p.op("clear");
  const cleared = await p.heap();
  await p.call(() => window.__bench.release());
  // one unmeasured cycle: the list/items cell may still reference the last
  // items array until the next write
  await p.op("run", 1000);
  await p.op("clear");
  const before = await p.heap();
  for (let i = 0; i < CYCLES; i++) {
    await p.op("run", 1000);
    await p.op("clear");
  }
  const after = await p.heap();
  await p.close();
  return {
    bytesPerRow: (full.js - base.js) / 10000,
    domBytesPerRow: (full.dom - base.dom) / 10000,
    afterClear: cleared.js - base.js,
    leakPerCycle: (after.js - before.js) / CYCLES,
    nodesPerRow: (census.elements + census.text + census.comments) / 10000,
    textPerRow: census.text / 10000,
    commentsPerRow: census.comments / 10000,
  };
}

const TIMED_OPS = [
  ["create1k", "run", 1000],
  ["replace1k", "run", 1000],
  ["update10th", "update"],
  ["select", "select", 1],
  ["swap", "swap"],
  ["remove", "remove", 1],
  ["clear1k", "clear"],
  ["create10k", "run", 10000],
  ["append1k", "add", 1000],
  ["clear11k", "clear"],
];

async function timingRep(browser, origin, kind) {
  const p = await openKind(browser, origin, kind);
  const result = {};
  for (let pass = 0; pass < 2; pass++) {
    for (const [name, op, arg] of TIMED_OPS) {
      const t = await p.call(([n, a]) => window.__bench.measure(n, a), op, arg);
      if (pass === 1) result[name] = t.total;
    }
  }
  await p.close();
  return result;
}

// ---------------------------------------------------------------- stats
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function aggregate(reps) {
  const out = {};
  for (const key of Object.keys(reps[0])) {
    const xs = reps.map((r) => r[key]);
    out[key] = {
      median: median(xs),
      min: Math.min(...xs),
      max: Math.max(...xs),
    };
  }
  return out;
}

// ---------------------------------------------------------------- budgets
function loadBudgets() {
  return JSON.parse(readFileSync(budgetsFile, "utf8"));
}

function familyOf(metric) {
  const leaf = metric.split(".").pop();
  return metric.startsWith("size.") ? `size.${leaf}` : `memory.${leaf}`;
}

function deriveMax(budgets, metric, baseline) {
  const tol = budgets.tolerance[familyOf(metric)];
  if (tol === undefined) {
    throw new Error(
      `budgets: no tolerance for ${familyOf(metric)} in budgets.json`,
    );
  }
  return Math.ceil(Math.max(baseline, 0) * (1 + tol.rel) + tol.abs);
}

function fmt(n, digits = 1) {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

// ---------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.build) {
    build("bench");
    build("hello");
  }
  const gated = {};
  const info = {};
  for (const entry of ["bench", "hello"]) {
    const size = measureSize(entry);
    for (const [k, v] of Object.entries(size)) gated[`size.${entry}.${k}`] = v;
  }

  const server = await serve(path.join(here, "out", "bench"));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const chromiumVersion = browser.version();
  const spread = {};
  try {
    for (const kind of opts.kinds) {
      await sanity(browser, origin, kind);
      if (opts.memory) {
        const reps = [];
        for (let r = 0; r < opts.reps; r++)
          reps.push(await memoryRep(browser, origin, kind));
        const agg = aggregate(reps);
        for (const k of ["bytesPerRow", "afterClear", "leakPerCycle"]) {
          gated[`memory.${kind}.${k}`] = agg[k].median;
          spread[`memory.${kind}.${k}`] = agg[k];
        }
        for (const k of [
          "domBytesPerRow",
          "nodesPerRow",
          "textPerRow",
          "commentsPerRow",
        ]) {
          info[`memory.${kind}.${k}`] = agg[k];
        }
      }
      if (opts.timing) {
        const reps = [];
        for (let r = 0; r < opts.reps; r++)
          reps.push(await timingRep(browser, origin, kind));
        const agg = aggregate(reps);
        for (const [k, v] of Object.entries(agg))
          info[`timing.${kind}.${k}`] = v;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  // ----- report
  const budgets = loadBudgets();
  const rows = [];
  const failures = [];
  const improved = [];
  for (const [metric, value] of Object.entries(gated)) {
    const budget = budgets.metrics[metric];
    let status = "new";
    if (budget !== undefined) {
      if (value > budget.max) {
        status = "FAIL";
        failures.push(metric);
      } else {
        status = "ok";
        const tol = budgets.tolerance[familyOf(metric)];
        if (
          value <
          budget.baseline - Math.abs(budget.baseline) * tol.rel - tol.abs
        ) {
          status = "improved";
          improved.push(metric);
        }
      }
    }
    const s = spread[metric];
    rows.push([
      metric,
      fmt(value),
      s ? `${fmt(s.min)}..${fmt(s.max)}` : "",
      budget ? fmt(budget.baseline) : "-",
      budget ? fmt(budget.max) : "-",
      status,
    ]);
  }
  const header = ["metric", "median", "range", "baseline", "max", "status"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(
    `\nChromium ${chromiumVersion}, ${opts.reps} reps per kind (medians)\n`,
  );
  console.log(line(header));
  for (const r of rows) console.log(line(r));
  if (Object.keys(info).length > 0) {
    console.log("\nreported (not gated):");
    for (const [metric, v] of Object.entries(info)) {
      console.log(
        `  ${metric.padEnd(36)} ${fmt(v.median, 2).padStart(10)}  (${fmt(v.min, 2)}..${fmt(v.max, 2)})`,
      );
    }
  }

  if (opts.json) {
    writeFileSync(
      opts.json,
      JSON.stringify(
        { chromium: chromiumVersion, reps: opts.reps, gated, spread, info },
        null,
        2,
      ) + "\n",
    );
  }

  if (opts.update) {
    const next = {
      ...budgets,
      chromium: chromiumVersion,
      metrics: { ...budgets.metrics },
    };
    for (const [metric, value] of Object.entries(gated)) {
      const baseline = Math.round(value * 10) / 10;
      next.metrics[metric] = {
        baseline,
        max: deriveMax(budgets, metric, baseline),
      };
    }
    writeFileSync(budgetsFile, JSON.stringify(next, null, 2) + "\n");
    console.log(
      `\nbudgets.json updated (${Object.keys(gated).length} metrics)`,
    );
    return;
  }
  if (improved.length > 0) {
    console.log(
      `\nimproved beyond tolerance (tighten with --update): ${improved.join(", ")}`,
    );
  }
  if (budgets.chromium !== chromiumVersion) {
    console.log(
      `\nnote: budgets were recorded on Chromium ${budgets.chromium}; heap sizes can shift across builds`,
    );
  }
  if (failures.length > 0) {
    console.error(`\nBUDGET EXCEEDED: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
