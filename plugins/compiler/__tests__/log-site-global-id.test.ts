/**
 * Process-global `{{log}}` site-id allocation.
 *
 * The compat-mode `{{log}}` transform prepends a `__logSite:N` id so runtime
 * de-dup (src/core/helpers/log.ts, keyed on the id string in a SINGLE
 * process-global Map) can tell distinct call-sites apart. A per-compilation
 * counter reset to 0 for every template made two different templates both emit
 * `__logSite:0`, colliding in that global Map. The counter is now module-global
 * and monotonic across every compilation in the process, so ids from separate
 * compilations never overlap — retiring the Ember bridge's `__logSite:\d+`
 * renumber pass.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { compile } from '../compile';
import { resetLogSiteCounter } from '../serializers/value';

const compatFlags = { IS_GLIMMER_COMPAT_MODE: true, WITH_EMBER_INTEGRATION: true };

function siteIds(code: string): number[] {
  return [...code.matchAll(/__logSite:(\d+)/g)].map((m) => Number(m[1]));
}

describe('{{log}} site-id: process-global monotonic counter', () => {
  beforeEach(() => resetLogSiteCounter());

  test('two compilations in one process get DISJOINT id ranges', () => {
    const a = compile('<div>{{log this.a}}{{log this.b}}</div>', { flags: compatFlags });
    const b = compile('<div>{{log this.c}}{{log this.d}}</div>', { flags: compatFlags });

    const idsA = siteIds(a.code);
    const idsB = siteIds(b.code);

    expect(idsA).toEqual([0, 1]);
    expect(idsB).toEqual([2, 3]);
    // No overlap between the two compilations — the collision that broke dedup.
    const overlap = idsA.filter((id) => idsB.includes(id));
    expect(overlap).toEqual([]);
  });

  test('ids are strictly monotonic across many compilations', () => {
    const all: number[] = [];
    for (let i = 0; i < 5; i++) {
      all.push(...siteIds(compile('{{log this.x}}', { flags: compatFlags }).code));
    }
    // Strictly increasing => globally unique.
    for (let i = 1; i < all.length; i++) {
      expect(all[i]).toBeGreaterThan(all[i - 1]!);
    }
    expect(all).toEqual([0, 1, 2, 3, 4]);
  });

  test('resetLogSiteCounter() restores a deterministic starting point', () => {
    compile('{{log this.a}}', { flags: compatFlags });
    compile('{{log this.b}}', { flags: compatFlags });
    resetLogSiteCounter();
    const r = compile('{{log this.c}}', { flags: compatFlags });
    expect(siteIds(r.code)).toEqual([0]);
  });
});
