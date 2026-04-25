/**
 * Opt-in patch contract for `reactive-collections.ts` — commit a128135.
 *
 * Touching `Map.prototype` and `Set.prototype` is observable to vendor code
 * that subclasses Map/Set or memoizes method references. The patch is now
 * gated behind an explicit `ensureReactiveCollectionsPatched()` call (and
 * `setupGlobalScope` in the runtime compiler invokes it for hosts that
 * want GXT semantics). The bottom-of-file auto-call was removed.
 *
 * Verifying this in-process is hard: by the time any other test in this
 * suite has run `ensureReactiveCollectionsPatched()`, the prototype
 * mutation is permanent for the rest of the process. So we spawn a fresh
 * Node process that imports the published dist bundle and inspects
 * `Map.prototype.set` / `Set.prototype.add` identity around the import
 * and around `setupGlobalScope()`.
 */
import { describe, test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const RC_BUNDLE = resolve(REPO_ROOT, 'dist', 'gxt.runtime-compiler.es.js');

function runNode(script: string): { status: number | null; stdout: string; stderr: string } {
  // The runtime-compiler bundle was tree-shaken for the browser and references
  // `location.pathname`. Provide a minimal stub before importing it so the
  // module can load in plain Node.
  const stub = `globalThis.location = { pathname: '/' };`;
  const result = spawnSync('node', ['--input-type=module', '-e', stub + script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('reactive-collections opt-in patch', () => {
  // Skip these tests when the runtime-compiler bundle hasn't been built.
  const bundleAvailable = existsSync(RC_BUNDLE);

  test.runIf(bundleAvailable)(
    'importing the runtime-compiler bundle does NOT mutate Map/Set prototypes',
    () => {
      // Capture Map.prototype.set identity, dynamic-import the bundle, and
      // compare. If the patch is applied as a side-effect, the identity will
      // differ. The script intentionally does NOT call setupGlobalScope().
      const script = `
        const origMapSet = Map.prototype.set;
        const origMapDelete = Map.prototype.delete;
        const origMapEntries = Map.prototype.entries;
        const origSetAdd = Set.prototype.add;
        const origSetDelete = Set.prototype.delete;
        await import(${JSON.stringify('file://' + RC_BUNDLE)});
        const stillSameSet = Map.prototype.set === origMapSet;
        const stillSameMapDel = Map.prototype.delete === origMapDelete;
        const stillSameEntries = Map.prototype.entries === origMapEntries;
        const stillSameAdd = Set.prototype.add === origSetAdd;
        const stillSameSetDel = Set.prototype.delete === origSetDelete;
        process.stdout.write(JSON.stringify({
          stillSameSet, stillSameMapDel, stillSameEntries, stillSameAdd, stillSameSetDel,
        }));
      `;
      const r = runNode(script);
      expect(r.status, `script failed:\n${r.stderr}`).toBe(0);
      const obj = JSON.parse(r.stdout);
      expect(obj.stillSameSet).toBe(true);
      expect(obj.stillSameMapDel).toBe(true);
      expect(obj.stillSameEntries).toBe(true);
      expect(obj.stillSameAdd).toBe(true);
      expect(obj.stillSameSetDel).toBe(true);
    },
  );

  test.runIf(bundleAvailable)(
    'setupGlobalScope() patches Map.prototype.set and Set.prototype.add',
    () => {
      // Same as above, but explicitly invoke setupGlobalScope and assert the
      // identity DOES change. This pins the runtime-compiler.ts contract that
      // setupGlobalScope() is the trigger for the patch.
      const script = `
        const origMapSet = Map.prototype.set;
        const origMapDelete = Map.prototype.delete;
        const origMapEntries = Map.prototype.entries;
        const origSetAdd = Set.prototype.add;
        const origSetDelete = Set.prototype.delete;
        const origMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size');
        const m = await import(${JSON.stringify('file://' + RC_BUNDLE)});
        m.setupGlobalScope();
        const setChanged = Map.prototype.set !== origMapSet;
        const mapDelChanged = Map.prototype.delete !== origMapDelete;
        const entriesChanged = Map.prototype.entries !== origMapEntries;
        const addChanged = Set.prototype.add !== origSetAdd;
        const setDelChanged = Set.prototype.delete !== origSetDelete;
        // Sanity: native semantics still hold post-patch.
        const myMap = new Map();
        myMap.set('a', 1).set('b', 2);
        const sane =
          myMap.size === 2 &&
          myMap.get('a') === 1 &&
          Array.from(myMap.keys()).join(',') === 'a,b';
        process.stdout.write(JSON.stringify({
          setChanged, mapDelChanged, entriesChanged, addChanged, setDelChanged, sane,
        }));
      `;
      const r = runNode(script);
      expect(r.status, `script failed:\n${r.stderr}`).toBe(0);
      const obj = JSON.parse(r.stdout);
      expect(obj.setChanged).toBe(true);
      expect(obj.mapDelChanged).toBe(true);
      expect(obj.entriesChanged).toBe(true);
      expect(obj.addChanged).toBe(true);
      expect(obj.setDelChanged).toBe(true);
      expect(obj.sane).toBe(true);
    },
  );

  test.runIf(bundleAvailable)(
    'setupGlobalScope() also exposes ensureReactiveCollections-equivalent host hooks',
    () => {
      // Defense in depth: confirm the related Ember-integration globals are
      // set up alongside the patch — they're in the same setupGlobalScope()
      // body so a regression that drops the patch would likely also drop
      // these.
      const script = `
        const m = await import(${JSON.stringify('file://' + RC_BUNDLE)});
        m.setupGlobalScope();
        const g = globalThis;
        process.stdout.write(JSON.stringify({
          ready: g.__GXT_RUNTIME_INITIALIZED__ === true,
          hasCellFor: typeof g.__gxtCellFor === 'function',
          hasFormula: typeof g.__gxtFormula === 'function',
          hasCell: typeof g.__gxtCell === 'function',
          hasSyncDom: typeof g.__gxtSyncDom === 'function',
        }));
      `;
      const r = runNode(script);
      expect(r.status, `script failed:\n${r.stderr}`).toBe(0);
      const obj = JSON.parse(r.stdout);
      expect(obj.ready).toBe(true);
      expect(obj.hasCellFor).toBe(true);
      expect(obj.hasFormula).toBe(true);
      expect(obj.hasCell).toBe(true);
      expect(obj.hasSyncDom).toBe(true);
    },
  );
});
