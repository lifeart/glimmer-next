# Tracerbench Setup and Configuration

This document describes the tracerbench benchmark setup for the Glimmer-Next project.

## Overview

The benchmark uses [tracerbench](https://github.com/TracerBench/tracerbench) to compare performance between control (master branch) and experiment (PR branch) builds. It runs a series of operations from the Krausest benchmark suite and measures timing via Chrome DevTools Protocol trace capture.

## Running the Benchmark

```bash
pnpm run benchmark
```

This runs `bin/setup-bench.mjs` which:
1. Clones and builds both control and experiment branches to temp directories
2. Starts preview servers for each build
3. Runs tracerbench in headless Chrome mode
4. Outputs results to `tracerbench-results/`

## Benchmark Operations

The benchmark measures 21 operations:

| Operation | Description |
|-----------|-------------|
| render | Initial application render |
| render1000Items1/2/3 | Create 1000 rows |
| render5000Items1/2 | Create 5000 rows |
| clearItems1/2/4 | Clear all rows |
| clearManyItems1/2 | Clear 5000 rows |
| append1000Items1/2 | Append 1000 rows |
| updateEvery10thItem1/2 | Update every 10th row |
| selectFirstRow1 | Select first row |
| selectSecondRow1 | Select second row |
| removeFirstRow1 | Remove first row |
| removeSecondRow1 | Remove second row |
| swapRows1/2 | Swap rows |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EXPERIMENT_BRANCH_NAME` | Current branch | Branch to test |
| `CONTROL_BRANCH_NAME` | `master` | Baseline branch |
| `FIDELITY` | `20` (local) / `100` (CI) | Number of samples |
| `THROTTLE` | `2` (local) / `4` (CI) | CPU throttle rate |
| `MARKERS` | All benchmark markers | Comma-separated marker pairs |
| `FORK_NAME` | - | Fork repo name for PR builds |

### Tracerbench Flags

```bash
tracerbench compare \
  --headless \
  --debug \
  --fidelity 100 \
  --cpuThrottleRate 4 \
  --sampleTimeout 240 \
  --regressionThreshold 25 \
  --markers "renderStart,renderEnd,..." \
  --controlURL http://localhost:4020/benchmark \
  --experimentURL http://localhost:4021/benchmark \
  --tbResultsFolder ./tracerbench-results
```

### Chrome Browser Args

The benchmark uses headless Chrome with these flags:
- `--headless` - Run without GUI
- `--disable-gpu` - Disable GPU acceleration
- `--no-sandbox` - Required for CI environments
- `--disable-dev-shm-usage` - Avoid /dev/shm size issues
- `--disable-extensions` - Disable browser extensions

## Diagnostic Markers

Additional markers are created for debugging but not included in the benchmark results:

- `afterInitialRender` - After the app's initial render completes
- `benchmarkPathVerified` - After pathname check passes
- `beforeBenchmarkLoop` - Just before the benchmark operations start

These can be useful when analyzing trace files manually.

## Trace Analysis

Trace files are saved to `tracerbench-results/traces/`. To analyze marks in a trace:

```javascript
const trace = JSON.parse(fs.readFileSync('tracerbench-results/traces/control0.json'));
const userTimings = trace.traceEvents.filter(e => e.cat === 'blink.user_timing');
const markNames = [...new Set(userTimings.map(e => e.name))].sort();
console.log('Marks found:', markNames);
```

## Troubleshooting

### Node.js version issues

Use Node 18 for tracerbench compatibility. Node 20+ may have issues:

```bash
volta run --node 18.20.5 ./node_modules/.bin/tracerbench compare ...
```

### Timeout issues

Increase `--sampleTimeout` if the benchmark times out. Each sample needs to complete all 21 operations.

### Marks not found in trace

If you see "Could not find mark X in trace":

1. Verify the benchmark page is running correctly (visit `/benchmark` manually)
2. Use `--debug` flag and check the trace files manually
3. Ensure marks are created synchronously, not in callbacks
4. Check that no async boundaries exist between mark creation
