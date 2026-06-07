import "zx/globals";
import os from "node:os";
import { join } from "node:path";

/*

  To run proper bench setup we need to do following things:

  1.) Compile control packages
  2.) Compile experiment packages
  3.) Use SAME benchmark source
      * we should be able to tweak bench
        (add more cases, and still be able to compare with control)
      * we should be able to re-run bench in CI from current branch with updated perf source

*/

const experimentBranchName =
  process.env["EXPERIMENT_BRANCH_NAME"] ||
  (await $`git rev-parse --abbrev-ref HEAD`).stdout.trim();
const controlBranchName = process.env["CONTROL_BRANCH_NAME"] || "master";

// same order as in benchmark/benchmarks/krausest/lib/index.ts
const appMarkers = [
  "render",
  "render1000Items1",
  "clearItems1",
  "render1000Items2",
  "clearItems2",
  "render5000Items1",
  "clearManyItems1",
  "render5000Items2",
  "clearManyItems2",
  "render1000Items3",
  "append1000Items1",
  "append1000Items2",
  "updateEvery10thItem1",
  "updateEvery10thItem2",
  "selectFirstRow1",
  "selectSecondRow1",
  "removeFirstRow1",
  "removeSecondRow1",
  "swapRows1",
  "swapRows2",
  "clearItems4",
].flatMap((marker) => [marker + "Start", marker + "End"]).join(",");

const markers = process.env["MARKERS"] || appMarkers;
const fidelity = process.env["FIDELITY"] || "20";
const throttleRate = process.env["THROTTLE"] || "2";
const FORK_NAME = process.env["FORK_NAME"] || "";

const tempDir = os.tmpdir();

const CONTROL_DIR = join(tempDir, "control");
const EXPERIMENT_DIR = join(tempDir, "experiment");

await $`rm -rf ${CONTROL_DIR}`;
await $`rm -rf ${EXPERIMENT_DIR}`;
await $`mkdir -p ${CONTROL_DIR}`;
await $`mkdir -p ${EXPERIMENT_DIR}`;

const CONTROL_BENCH_DIR = CONTROL_DIR;
const EXPERIMENT_BENCH_DIR = EXPERIMENT_DIR;

const rawUpstreamUrl = await $`git ls-remote --get-url upstream`;
const rawOriginUrl = await $`git ls-remote --get-url origin`;
let originUrlStr = rawOriginUrl.toString().trim();
let upstreamUrlStr = rawUpstreamUrl.toString().trim();

if (upstreamUrlStr === "upstream") {
  // if we not inside fork, falling back to origin
  upstreamUrlStr = originUrlStr;
}

if (FORK_NAME && FORK_NAME !== "lifeart/glimmer-next") {
  // if PR from fork, we need to resolve fork's commit
  originUrlStr = originUrlStr.replace("lifeart/glimmer-next", FORK_NAME);
}

const CONTROL_PORT = 4020;
const EXPERIMENT_PORT = 4021;
const CONTROL_URL = `http://localhost:${CONTROL_PORT}/benchmark`;
const EXPERIMENT_URL = `http://localhost:${EXPERIMENT_PORT}/benchmark`;

// we can't do it in parallel on CI,

// setup experiment
await within(async () => {
  await cd(EXPERIMENT_DIR);
  await $`git clone ${originUrlStr} .`;
  await $`git checkout ${experimentBranchName}`;

  console.info("installing experiment source");
  await $`pnpm install --no-frozen-lockfile`.quiet();
  console.info("building experiment source, may take a while");
  await $`pnpm build:prod`.quiet();
});

// setup control
await within(async () => {
  await cd(CONTROL_DIR);
  await $`git clone ${upstreamUrlStr} .`;
  await $`git checkout ${controlBranchName}`;

  console.info("installing control source");
  await $`pnpm install --no-frozen-lockfile`.quiet();
  console.info("building control source, may take a while");
  await $`pnpm build:prod`.quiet();
});

console.info({
  upstreamUrlStr,
  originUrlStr,
  EXPERIMENT_DIR,
  CONTROL_DIR,
});

// start build assets
const controlServer = $`cd ${CONTROL_BENCH_DIR} && pnpm vite preview --port ${CONTROL_PORT}`;
const experimentServer = $`cd ${EXPERIMENT_BENCH_DIR} && pnpm vite preview --port ${EXPERIMENT_PORT}`;

// Helper to check if server is ready
async function waitForServer(url, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        console.info(`Server ready: ${url}`);
        return true;
      }
    } catch {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Server failed to start: ${url}`);
}

// Wait for both servers to be ready
await Promise.all([
  waitForServer(CONTROL_URL),
  waitForServer(EXPERIMENT_URL),
]);

console.info("Both servers are ready");

// Warm up both servers before the measured run.
//
// The first tracerbench sample navigates to a *cold* vite-preview page: the
// lazy `/benchmark` route chunk has not been served yet and the JIT is cold.
// Under `--cpuThrottleRate 4` on CI this cold first sample can be slow enough
// that the orchestrated benchmark loop has not emitted its first user-timing
// mark (e.g. `render1000Items1Start`) before the trace window closes, which
// surfaces as a hard `Could not find mark "..." in trace` failure on sample 0
// (control: 0). Priming the served assets first makes the first *measured*
// sample behave like a warm one.
async function warmUp(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    // Pull the module entry chunks referenced by the benchmark HTML and fetch
    // them so vite-preview has them resolved/cached before measurement.
    const base = new URL(url);
    const assetPaths = new Set();
    for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|mjs|css))"/g)) {
      assetPaths.add(m[1]);
    }
    for (const m of html.matchAll(/import\(["']([^"']+)["']\)/g)) {
      assetPaths.add(m[1]);
    }
    await Promise.all(
      [...assetPaths].map((p) => {
        try {
          const assetUrl = p.startsWith("http") ? p : new URL(p, base).href;
          return fetch(assetUrl).catch(() => {});
        } catch {
          return Promise.resolve();
        }
      }),
    );
    console.info(`Warmed up: ${url} (${assetPaths.size} assets)`);
  } catch (e) {
    // Warm-up is best-effort; a failure here must not fail the run, but it
    // must be visible so a broken warm-up is not silently masked.
    console.warn(`Warm-up for ${url} did not complete: ${e?.message ?? e}`);
  }
}

await Promise.all([warmUp(CONTROL_URL), warmUp(EXPERIMENT_URL)]);

// A dropped first user-timing mark (e.g. `render1000Items1Start`) or a missing
// terminal Paint event aborts the *entire* `tracerbench compare` with a
// non-zero exit. This is a transient trace-capture flake on headless CI
// chromium, NOT a benchmark result.
//
// IMPORTANT: retrying here cannot mask a genuine performance regression.
// `tracerbench compare` does NOT exit non-zero when a regression is detected
// (it reports the regression in `msg.txt`/the PR comment and still exits 0).
// The only non-zero exits are sampling/trace-extraction failures
// ("Could not sample from provided urls", "Could not find mark ...",
// "Could not find Paint event ...", sample timeouts) — exactly the transient
// class we retry. A real regression always survives a retry and is reported.
const TRANSIENT_TRACE_ERROR =
  /Could not find mark|Could not find Paint event|Could not sample from provided urls|sample ?timeout|Navigation timed out|errored while waiting for/i;

const browserArgs =
  "--headless,--disable-gpu,--no-sandbox,--disable-dev-shm-usage,--disable-extensions";
const MAX_ATTEMPTS = 3;

async function runCompare() {
  return await $`./node_modules/.bin/tracerbench compare --debug --browserArgs ${browserArgs} --regressionThreshold 25 --sampleTimeout 240 --fidelity ${fidelity} --markers ${markers} --controlURL ${CONTROL_URL} --experimentURL ${EXPERIMENT_URL} --report --cpuThrottleRate ${throttleRate} --tbResultsFolder ./tracerbench-results`;
}

function isTransientTraceFailure(p) {
  const haystack = `${p?.stdout ?? ""}\n${p?.stderr ?? ""}\n${p?.message ?? ""}`;
  return TRANSIENT_TRACE_ERROR.test(haystack);
}

let exitCode = 1;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  try {
    const output = await runCompare();
    try {
      fs.writeFileSync(
        "tracerbench-results/msg.txt",
        output.stdout.split("Benchmark Results Summary").pop() ?? "",
      );
    } catch (e) {
      // Writing the PR-comment summary is best-effort; the run still succeeded.
      console.warn(`Could not write msg.txt: ${e?.message ?? e}`);
    }
    exitCode = 0;
    break;
  } catch (p) {
    const transient = isTransientTraceFailure(p);
    console.error(
      `tracerbench compare attempt ${attempt}/${MAX_ATTEMPTS} failed${
        transient ? " (transient trace-capture flake)" : ""
      }:`,
    );
    console.error(p);
    if (transient && attempt < MAX_ATTEMPTS) {
      console.warn(
        `Retrying measured run (attempt ${attempt + 1}/${MAX_ATTEMPTS}) — ` +
          `a dropped first mark / missing Paint is a known headless-chromium ` +
          `trace flake and does not indicate a regression.`,
      );
      // brief settle before re-sampling
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    // Either a non-transient failure (real error) or retries exhausted.
    exitCode = 1;
    break;
  }
}

// Kill server processes
controlServer.kill();
experimentServer.kill();
process.exit(exitCode);
