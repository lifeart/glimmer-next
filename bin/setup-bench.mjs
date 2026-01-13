import "zx/globals";
import os from "node:os";
import { join } from "node:path";

import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";

// Create log file for debugging CI failures (use absolute path since within() changes cwd)
const resultsDir = join(process.cwd(), "tracerbench-results");
const logFile = join(resultsDir, "setup.log");
try {
  mkdirSync(resultsDir, { recursive: true });
} catch (e) {
  // Directory might already exist, that's fine
}
const log = (...args) => {
  const timestamp = new Date().toISOString();
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
  const line = `[${timestamp}] ${msg}`;
  console.info(line);
  appendFileSync(logFile, line + "\n");
};

const startTime = Date.now();
const elapsed = () => `[+${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

log("=== Benchmark setup script starting ===");
log(`Node version: ${process.version}`);
log(`Working directory: ${process.cwd()}`);

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
// Note: diagnostic markers (afterInitialRender, benchmarkPathVerified, beforeBenchmarkLoop) are also created
// but not included in markers list - they're just for debugging if the trace is saved
// Note: benchmarkComplete markers are only in experiment branch, not control (master),
// so they cannot be used until merged to master
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
  log(`${elapsed()} Cloning experiment from ${originUrlStr}...`);
  await $`git clone ${originUrlStr} .`;
  log(`Checking out branch ${experimentBranchName}...`);
  await $`git checkout ${experimentBranchName}`;

  log("installing experiment source...");
  try {
    await $`pnpm install --no-frozen-lockfile`.quiet();
  } catch (e) {
    log("pnpm install failed for experiment:", e.stderr || e.message);
    throw e;
  }
  log("building experiment source, may take a while...");
  try {
    await $`pnpm build:prod`.quiet();
  } catch (e) {
    log("pnpm build:prod failed for experiment:", e.stderr || e.message);
    throw e;
  }
  log(`${elapsed()} experiment build complete`);
});

// setup control
await within(async () => {
  await cd(CONTROL_DIR);
  log(`${elapsed()} Cloning control from ${upstreamUrlStr}...`);
  await $`git clone ${upstreamUrlStr} .`;
  log(`Checking out branch ${controlBranchName}...`);
  await $`git checkout ${controlBranchName}`;

  log("installing control source...");
  try {
    await $`pnpm install --no-frozen-lockfile`.quiet();
  } catch (e) {
    log("pnpm install failed for control:", e.stderr || e.message);
    throw e;
  }
  log("building control source, may take a while...");
  try {
    await $`pnpm build:prod`.quiet();
  } catch (e) {
    log("pnpm build:prod failed for control:", e.stderr || e.message);
    throw e;
  }
  log(`${elapsed()} control build complete`);
});

log({
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
        log(`Server ready: ${url}`);
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

log(`${elapsed()} Both servers are ready`);

try {
  // Using headless Chrome for CI performance
  const browserArgs = [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
  ].join(",");
  log(`${elapsed()} Starting tracerbench...`);
  log(`browserArgs: ${browserArgs}`);
  log(`markers: ${markers.substring(0, 100)}...`);
  const output =
    await $`./node_modules/.bin/tracerbench compare --debug --browserArgs ${browserArgs} --regressionThreshold 25 --sampleTimeout 240 --fidelity ${fidelity} --markers ${markers} --controlURL ${CONTROL_URL} --experimentURL ${EXPERIMENT_URL} --report --cpuThrottleRate ${throttleRate} --tbResultsFolder ./tracerbench-results`;

  try {
    writeFileSync(
      join(resultsDir, "msg.txt"),
      output.stdout.split("Benchmark Results Summary").pop() ?? "",
    );
  } catch (e) {
    // fine
  }
} catch (p) {
  log("=== TRACERBENCH FAILED ===");
  log("Error:", p?.message || p);
  if (p?.stderr) log("Stderr:", p.stderr);
  if (p?.stdout) log("Stdout tail:", p.stdout?.slice(-2000));
  // Kill server processes
  controlServer.kill();
  experimentServer.kill();
  process.exit(1);
}

// Kill server processes
controlServer.kill();
experimentServer.kill();
process.exit(0);
