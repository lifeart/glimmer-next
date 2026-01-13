// Simulate how tracerbench captures traces and analyze the mark args
import { chromium } from '@playwright/test';
import { spawnSync } from 'child_process';
import fs from 'fs';

// Use Chrome with similar flags to tracerbench
const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-component-extensions-with-background-pages',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--disable-translate',
    '--disable-v8-idle-tasks',
    '--metrics-recording-only',
    '--no-pings',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--safebrowsing-disable-auto-update',
    '--v8-cache-options=none',
  ]
});

const context = await browser.newContext();
const page = await context.newPage();
const client = await page.context().newCDPSession(page);

// Emulate CPU throttling like tracerbench does
await client.send('Emulation.setCPUThrottlingRate', { rate: 2 });

// Start tracing with same categories as tracerbench
await client.send('Tracing.start', {
  categories: '-*,devtools.timeline,v8.execute,blink.user_timing,loading,latencyInfo,performancetimeline',
  transferMode: 'ReturnAsStream'
});

await page.goto('http://localhost:4173/benchmark', { waitUntil: 'networkidle' });

// Wait for last marker (benchmarkComplete added with delay for trace flush)
await page.waitForFunction(() => {
  const marks = performance.getEntriesByType('mark');
  return marks.some(m => m.name === 'benchmarkCompleteEnd');
}, { timeout: 120000 });

// Wait a bit more for async operations
await page.waitForTimeout(1000);

// Stop tracing
const traceComplete = new Promise(resolve => {
  client.on('Tracing.tracingComplete', resolve);
});
await client.send('Tracing.end');
const { stream } = await traceComplete;

// Read trace
let trace = '';
let eof = false;
while (!eof) {
  const { data, base64Encoded, eof: end } = await client.send('IO.read', { handle: stream });
  trace += base64Encoded ? Buffer.from(data, 'base64').toString() : data;
  eof = end;
}
await client.send('IO.close', { handle: stream });

// Parse and analyze
const parsed = JSON.parse(trace);
const events = parsed.traceEvents || parsed;

// Find user timing events
const userTimingEvents = events.filter(e =>
  e.cat && e.cat.includes('blink.user_timing')
);

console.log('\nAnalyzing trace events:\n');

// Find navigationStart
const navStart = userTimingEvents.find(e => e.name === 'navigationStart');
if (navStart) {
  console.log('navigationStart:');
  console.log('  args:', JSON.stringify(navStart.args, null, 2));
  console.log('');
}

// Check specific markers
const markersToCheck = ['renderStart', 'renderEnd', 'render1000Items1Start', 'render1000Items1End', 'benchmarkCompleteStart', 'benchmarkCompleteEnd'];
for (const name of markersToCheck) {
  const event = userTimingEvents.find(e => e.name === name);
  if (event) {
    console.log(name + ':');
    console.log('  args:', JSON.stringify(event.args, null, 2));

    // Check if it has navigationId
    const hasNavId = event.args?.data?.navigationId;
    console.log('  hasNavigationId:', !!hasNavId);

    // Check if it matches navigationStart
    if (navStart && hasNavId) {
      const matches = hasNavId === navStart.args?.data?.navigationId;
      console.log('  matchesNavigationStart:', matches);
    }
  } else {
    console.log(name + ': NOT FOUND IN TRACE');
  }
  console.log('');
}

// Count events
console.log('Total trace events:', events.length);
console.log('User timing events:', userTimingEvents.length);
console.log('Mark events (ph=R or I):', userTimingEvents.filter(e => e.ph === 'R' || e.ph === 'I').length);

// Check event order - this is how tracerbench processes them
console.log('\n\nEvent order analysis (simulating tracerbench):');
const markEvents = userTimingEvents.filter(e => e.ph === 'R' || e.ph === 'I');
console.log('Mark events in trace order:');
markEvents.forEach((e, i) => {
  console.log(`  ${i}: ${e.name} (ts: ${e.ts})`);
});

// Simulate tracerbench's navigation sample extraction
const expectedMarkers = ['renderStart', 'renderEnd', 'render1000Items1Start', 'render1000Items1End'];
console.log('\n\nSimulating tracerbench extraction:');
let eventIdx = 0;
let navigationStartArgs = null;

for (const markerName of expectedMarkers) {
  let found = false;
  for (; eventIdx < markEvents.length; eventIdx++) {
    const event = markEvents[eventIdx];

    // First find navigationStart
    if (!navigationStartArgs && event.name === 'navigationStart') {
      navigationStartArgs = event.args;
      console.log(`Found navigationStart at index ${eventIdx}`);
    }

    if (event.name === markerName) {
      // Check if it has matching navigationId
      const hasFrame = event.args?.frame;
      const hasNavId = event.args?.data?.navigationId;

      if (hasFrame && hasFrame === navigationStartArgs?.frame) {
        console.log(`Found ${markerName} at index ${eventIdx} (matched by frame)`);
        found = true;
        eventIdx++; // Move to next for next search
        break;
      } else if (hasNavId && hasNavId === navigationStartArgs?.data?.navigationId) {
        console.log(`Found ${markerName} at index ${eventIdx} (matched by navigationId)`);
        found = true;
        eventIdx++; // Move to next for next search
        break;
      } else {
        console.log(`Skipped ${markerName} at index ${eventIdx} - no matching frame/navigationId`);
      }
    }
  }
  if (!found) {
    console.log(`ERROR: Could not find mark "${markerName}" - eventIdx reached ${eventIdx}`);
    break;
  }
}

await browser.close();
