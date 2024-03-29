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
].reduce((acc, marker) => {
  return acc + "," + marker + "Start," + marker + "End";
}, "");
const markers = (process.env["MARKERS"] || appMarkers)
  .split(",")
  .filter((el) => el.length)
  .join(",");
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
$`cd ${CONTROL_BENCH_DIR} && pnpm vite preview --port ${CONTROL_PORT}`;
$`cd ${EXPERIMENT_BENCH_DIR} && pnpm vite preview --port ${EXPERIMENT_PORT}`;

await new Promise((resolve) => {
  // giving 5 seconds for the server to start
  setTimeout(resolve, 5000);
});

try {
  const output =
    await $`./node_modules/.bin/tracerbench compare --regressionThreshold 25 --sampleTimeout 60 --fidelity ${fidelity} --markers ${markers} --controlURL ${CONTROL_URL} --experimentURL ${EXPERIMENT_URL} --report --headless --cpuThrottleRate ${throttleRate}`;

  try {
    fs.writeFileSync(
      "tracerbench-results/msg.txt",
      output.stdout.split("Benchmark Results Summary").pop() ?? "",
    );
  } catch (e) {
    // fine
  }
} catch (p) {
  console.error(p);
  process.exit(1);
}

process.exit(0);
